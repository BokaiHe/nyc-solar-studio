"""Dataset, model and metrics shared by train.py, evaluate.py and export_onnx.py."""
from __future__ import annotations

import json
import random
from pathlib import Path

import numpy as np
import segmentation_models_pytorch as smp
import torch
import torch.nn.functional as F
from PIL import Image
from scipy import ndimage
from torch.utils.data import Dataset

# ImageNet statistics, matching the pretrained encoder. The app normalizes
# the same way before inference (see model.json).
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
# The app runs on 2014 imagery, so evaluation uses it too.
EVAL_YEAR = '2014'
# Objects smaller than this (0.3 m² at 15 cm pixels) are not counted.
MIN_OBJECT_PIXELS = 13


def load_splits(data: Path) -> dict[str, list[str]]:
    return json.loads((data / 'splits.json').read_text())


def load_years(data: Path) -> list[str]:
    return json.loads((data / 'meta.json').read_text())['years']


class Chips(Dataset):
    """Image chips with targets (obstacle) and valid (labeled) masks.

    Training samples a random year and applies flips, rotations, crops and
    color jitter; evaluation uses whole 2014 chips.
    """

    def __init__(self, data: Path, names: list[str], years: list[str], train: bool, crop: int = 384):
        self.data, self.names, self.years, self.train, self.crop = data, names, years, train, crop

    def __len__(self) -> int:
        return len(self.names)

    def __getitem__(self, index: int):
        name = self.names[index]
        year = random.choice(self.years) if self.train else EVAL_YEAR
        image = np.asarray(Image.open(self.data / 'images' / f'{name}_{year}.jpg').convert('RGB'), dtype=np.float32) / 255
        mask = np.asarray(Image.open(self.data / 'masks' / f'{name}.png'))
        if self.train:
            image, mask = augment(image, mask, self.crop)
        image = (image - MEAN) / STD
        return (
            torch.from_numpy(np.ascontiguousarray(image.transpose(2, 0, 1))),
            torch.from_numpy((mask == 2).astype(np.float32))[None],
            torch.from_numpy((mask > 0).astype(np.float32))[None],
        )


def augment(image: np.ndarray, mask: np.ndarray, crop: int):
    size = image.shape[0]
    top, left = random.randint(0, size - crop), random.randint(0, size - crop)
    image, mask = image[top:top + crop, left:left + crop], mask[top:top + crop, left:left + crop]
    turns = random.randint(0, 3)
    image, mask = np.rot90(image, turns), np.rot90(mask, turns)
    if random.random() < 0.5:
        image, mask = image[:, ::-1], mask[:, ::-1]
    # Lighting and color differ between flights and seasons.
    gain = np.random.uniform(0.9, 1.1, 3).astype(np.float32)
    image = image * gain * np.float32(random.uniform(0.75, 1.25))
    mean = image.mean()
    image = (image - mean) * np.float32(random.uniform(0.8, 1.2)) + mean
    image = np.clip(image, 0, 1) ** np.float32(random.uniform(0.8, 1.25))
    return image.astype(np.float32), mask


def build_model(encoder: str, pretrained: bool) -> torch.nn.Module:
    # A slim decoder keeps the exported model small for the browser.
    return smp.Unet(
        encoder_name=encoder,
        encoder_weights='imagenet' if pretrained else None,
        decoder_channels=(128, 64, 48, 32, 16),
        classes=1,
    )


def masked_loss(logits: torch.Tensor, target: torch.Tensor, valid: torch.Tensor, pos_weight: float) -> torch.Tensor:
    """BCE plus soft Dice, both over labeled pixels only."""
    weight = torch.tensor(pos_weight, device=logits.device)
    bce = F.binary_cross_entropy_with_logits(logits, target, pos_weight=weight, reduction='none')
    bce = (bce * valid).sum() / valid.sum().clamp(min=1)
    probability = torch.sigmoid(logits) * valid
    target = target * valid
    dice = 1 - (2 * (probability * target).sum() + 1) / (probability.sum() + target.sum() + 1)
    return bce + dice


class Scores:
    """Pixel and object scores over labeled pixels, accumulated per chip."""

    def __init__(self):
        self.tp = self.fp = self.fn = 0
        self.found = self.objects = self.right = self.predicted = 0

    def add(self, probability: np.ndarray, target: np.ndarray, valid: np.ndarray, threshold: float) -> None:
        prediction = (probability >= threshold) & valid
        target = target & valid
        self.tp += int((prediction & target).sum())
        self.fp += int((prediction & ~target).sum())
        self.fn += int((~prediction & target).sum())
        # Objects: a true one counts as found if any prediction touches it,
        # a predicted one as right if it touches any true one.
        truth, count = ndimage.label(target)
        sizes = np.bincount(truth.ravel(), minlength=count + 1)
        for number in range(1, count + 1):
            if sizes[number] < MIN_OBJECT_PIXELS:
                continue
            self.objects += 1
            self.found += int(prediction[truth == number].any())
        guess, count = ndimage.label(prediction)
        sizes = np.bincount(guess.ravel(), minlength=count + 1)
        for number in range(1, count + 1):
            if sizes[number] < MIN_OBJECT_PIXELS:
                continue
            self.predicted += 1
            self.right += int(target[guess == number].any())

    def summary(self) -> dict[str, float]:
        precision = self.tp / max(1, self.tp + self.fp)
        recall = self.tp / max(1, self.tp + self.fn)
        object_precision = self.right / max(1, self.predicted)
        object_recall = self.found / max(1, self.objects)
        return {
            'iou': self.tp / max(1, self.tp + self.fp + self.fn),
            'precision': precision,
            'recall': recall,
            'f1': 2 * precision * recall / max(1e-9, precision + recall),
            'object_precision': object_precision,
            'object_recall': object_recall,
            'object_f1': 2 * object_precision * object_recall / max(1e-9, object_precision + object_recall),
            'objects': self.objects,
        }


@torch.no_grad()
def predict_all(model, loader, device) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """Probabilities, targets and valid masks for every chip in a loader."""
    model.eval()
    results = []
    for image, target, valid in loader:
        with torch.autocast(device_type=device.type, enabled=device.type == 'cuda'):
            logits = model(image.to(device))
        probability = torch.sigmoid(logits.float()).cpu().numpy()
        for p, t, v in zip(probability, target.numpy(), valid.numpy()):
            results.append((p[0], t[0] > 0.5, v[0] > 0.5))
    return results


def score(results, threshold: float) -> dict[str, float]:
    scores = Scores()
    for probability, target, valid in results:
        scores.add(probability, target, valid, threshold)
    return scores.summary()
