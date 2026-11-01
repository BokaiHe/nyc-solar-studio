"""Zips the dataset and the training scripts for upload to AutoDL.

    python ml/package_autodl.py --data data/ml/dataset --out data/ml/autodl-package.zip
"""
from __future__ import annotations

import argparse
import zipfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', default='data/ml/dataset')
    parser.add_argument('--out', default='data/ml/autodl-package.zip')
    args = parser.parse_args()
    data, out = Path(args.data), Path(args.out)
    scripts = Path(__file__).parent / 'train'
    files = 0
    # JPEGs and PNGs are already compressed; storing them is faster.
    with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_STORED) as archive:
        for path in sorted(scripts.glob('*')):
            if path.suffix in {'.py', '.txt', '.md'}:
                archive.write(path, f'autodl-package/train/{path.name}', compress_type=zipfile.ZIP_DEFLATED)
        for name in ('splits.json', 'meta.json'):
            archive.write(data / name, f'autodl-package/dataset/{name}', compress_type=zipfile.ZIP_DEFLATED)
        for folder in ('images', 'masks'):
            for path in sorted((data / folder).iterdir()):
                if path.suffix in {'.jpg', '.png'}:
                    archive.write(path, f'autodl-package/dataset/{folder}/{path.name}')
                    files += 1
    print(f'{out}: {files} images and masks, {out.stat().st_size / 1e6:.0f} MB')


if __name__ == '__main__':
    main()
