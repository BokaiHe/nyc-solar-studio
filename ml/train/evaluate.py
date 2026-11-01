"""Picks a threshold on the validation split, scores the test split on 2014
imagery, and saves overlays to look at.

    python evaluate.py --data ../dataset --run runs/unet

Writes runs/unet/metrics.json and runs/unet/previews/*.jpg (red: LiDAR
obstacles, cyan outline: predicted, gray: not labeled).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from scipy import ndimage
from torch.utils.data import DataLoader

from common import EVAL_YEAR, Chips, build_model, load_splits, load_years, predict_all, score


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', default='../dataset')
    parser.add_argument('--run', default='runs/unet')
    parser.add_argument('--previews', type=int, default=40)
    parser.add_argument('--workers', type=int, default=8)
    args = parser.parse_args()

    data, run = Path(args.data), Path(args.run)
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    state = torch.load(run / 'best.pt', map_location=device)
    model = build_model(state['config']['encoder'], pretrained=False).to(device)
    model.load_state_dict(state['model'])
    splits, years = load_splits(data), load_years(data)
    loader = lambda names: DataLoader(Chips(data, names, years, train=False), batch_size=16, num_workers=args.workers)

    validation = predict_all(model, loader(splits['val']), device)
    sweep = {round(t, 2): score(validation, t) for t in np.arange(0.3, 0.81, 0.05)}
    threshold = max(sweep, key=lambda t: sweep[t]['object_f1'] + sweep[t]['f1'])
    test = predict_all(model, loader(splits['test']), device)
    metrics = {'threshold': threshold, 'val': sweep[threshold], 'test': score(test, threshold), 'epoch': state['epoch'],
               'sweep': {str(t): {k: round(v, 4) for k, v in m.items()} for t, m in sweep.items()}}
    (run / 'metrics.json').write_text(json.dumps(metrics, indent=1))
    print(json.dumps({'threshold': threshold, 'val': metrics['val'], 'test': metrics['test']}, indent=1))

    previews = run / 'previews'
    previews.mkdir(exist_ok=True)
    for name, (probability, target, valid) in list(zip(splits['test'], test))[:args.previews]:
        image = np.asarray(Image.open(data / 'images' / f'{name}_{EVAL_YEAR}.jpg').convert('RGB'), dtype=np.float32)
        image[~valid] *= 0.5
        image[target] = image[target] * 0.4 + np.array([255, 40, 40]) * 0.6
        predicted = (probability >= threshold) & valid
        outline = predicted & ~ndimage.binary_erosion(predicted, iterations=2)
        image[outline] = [0, 230, 255]
        Image.fromarray(image.clip(0, 255).astype(np.uint8)).save(previews / f'{name}.jpg', quality=90)


if __name__ == '__main__':
    main()
