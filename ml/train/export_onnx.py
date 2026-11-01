"""Exports the best checkpoint for the browser (onnxruntime-web).

    python export_onnx.py --run runs/unet

Writes runs/unet/model.onnx (input: float32 [1, 3, H, W], ImageNet-normalized
RGB at 15 cm per pixel, H and W multiples of 32; output: obstacle probability
[1, 1, H, W]), model.fp16.onnx when onnxconverter-common is installed, and
model.json with everything the app needs to run it.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime
import torch

from common import MEAN, STD, build_model


class WithSigmoid(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, image):
        return torch.sigmoid(self.model(image))


def export(run: Path, *, size: int = 512) -> dict[str, str]:
    """Writes the ONNX models and model.json; returns the model files by precision."""
    run = Path(run)
    state = torch.load(run / 'best.pt', map_location='cpu')
    model = build_model(state['config']['encoder'], pretrained=False)
    model.load_state_dict(state['model'])
    wrapped = WithSigmoid(model).eval()
    example = torch.randn(1, 3, size, size)
    path = run / 'model.onnx'
    torch.onnx.export(
        wrapped, example, path, opset_version=17, input_names=['image'], output_names=['probability'],
        dynamic_axes={'image': {2: 'height', 3: 'width'}, 'probability': {2: 'height', 3: 'width'}},
        dynamo=False,
    )

    # The exported graph must agree with PyTorch.
    session = onnxruntime.InferenceSession(str(path), providers=['CPUExecutionProvider'])
    for side in (size, 384):
        sample = torch.randn(1, 3, side, side)
        expected = wrapped(sample).detach().numpy()
        actual = session.run(None, {'image': sample.numpy()})[0]
        difference = float(np.abs(expected - actual).max())
        print(f'{side}px: max difference {difference:.2e}')
        assert difference < 1e-3, difference

    files = {'fp32': path.name}
    try:
        import onnx
        from onnxconverter_common import float16
        half = float16.convert_float_to_float16(onnx.load(path), keep_io_types=True)
        onnx.save(half, run / 'model.fp16.onnx')
        files['fp16'] = 'model.fp16.onnx'
    except ImportError:
        print('onnxconverter-common not installed: skipping the fp16 model')

    metrics_path = run / 'metrics.json'
    metrics = json.loads(metrics_path.read_text()) if metrics_path.exists() else {}
    (run / 'model.json').write_text(json.dumps({
        'files': files,
        'encoder': state['config']['encoder'],
        'input': {'layout': 'NCHW', 'channels': 'RGB', 'scale': 1 / 255, 'mean': MEAN.tolist(), 'std': STD.tolist(), 'multiple_of': 32},
        'pixel_meters': 0.15,
        'imagery': 'NYS ITS orthoimagery 2014',
        'threshold': metrics.get('threshold', 0.5),
        'test': metrics.get('test'),
        'epoch': state['epoch'],
    }, indent=1))
    for name in files.values():
        print(f'{name}: {(run / name).stat().st_size / 1e6:.1f} MB')
    return files


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', default='runs/unet')
    parser.add_argument('--size', type=int, default=512, help='Example input size used for tracing')
    args = parser.parse_args()
    export(args.run, size=args.size)


if __name__ == '__main__':
    main()
