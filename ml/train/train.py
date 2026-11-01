"""Trains the rooftop obstacle U-Net.

    python train.py --data ../dataset --out runs/unet

Keeps the checkpoint with the best validation F1 (runs/unet/best.pt) and a
per-epoch log (log.csv). Resume an interrupted run with --resume.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import random
import time
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader

from common import Chips, build_model, load_splits, load_years, masked_loss, predict_all, score


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', default='../dataset')
    parser.add_argument('--out', default='runs/unet')
    parser.add_argument('--encoder', default='mobilenet_v2', help='Any segmentation_models_pytorch encoder, e.g. efficientnet-b0')
    parser.add_argument('--no-pretrained', action='store_true', help='Start from random weights (no download)')
    parser.add_argument('--epochs', type=int, default=60)
    parser.add_argument('--batch', type=int, default=16)
    parser.add_argument('--crop', type=int, default=384)
    parser.add_argument('--lr', type=float, default=1e-3)
    parser.add_argument('--pos-weight', type=float, default=3.0, help='Weight of obstacle pixels in the BCE term')
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--max-steps', type=int, default=0, help='Stop each epoch after this many batches (smoke tests)')
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--seed', type=int, default=0)
    args = parser.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    data, out = Path(args.data), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    splits, years = load_splits(data), load_years(data)
    print(f'device {device} · train {len(splits["train"])} · val {len(splits["val"])} chips · years {years}', flush=True)

    train_loader = DataLoader(
        Chips(data, splits['train'], years, train=True, crop=args.crop),
        batch_size=args.batch, shuffle=True, num_workers=args.workers, pin_memory=True, drop_last=True,
        persistent_workers=args.workers > 0,
    )
    val_loader = DataLoader(Chips(data, splits['val'], years, train=False), batch_size=args.batch, num_workers=args.workers)

    model = build_model(args.encoder, pretrained=not args.no_pretrained).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    steps_per_epoch = len(train_loader) if not args.max_steps else min(args.max_steps, len(train_loader))
    total = args.epochs * steps_per_epoch
    warmup = min(500, total // 10)
    schedule = torch.optim.lr_scheduler.LambdaLR(
        optimizer, lambda step: (step + 1) / warmup if step < warmup else 0.5 * (1 + math.cos(math.pi * (step - warmup) / max(1, total - warmup))),
    )
    scaler = torch.amp.GradScaler(enabled=device.type == 'cuda')

    start, best = 0, -1.0
    if args.resume and (out / 'last.pt').exists():
        state = torch.load(out / 'last.pt', map_location=device)
        model.load_state_dict(state['model'])
        optimizer.load_state_dict(state['optimizer'])
        schedule.load_state_dict(state['schedule'])
        start, best = state['epoch'] + 1, state['best']
        print(f'resumed at epoch {start}', flush=True)

    config = {'encoder': args.encoder, 'crop': args.crop, 'pos_weight': args.pos_weight, 'epochs': args.epochs}
    (out / 'config.json').write_text(json.dumps(config, indent=1))
    log_path = out / 'log.csv'
    fields = ['epoch', 'loss', 'iou', 'precision', 'recall', 'f1', 'object_precision', 'object_recall', 'object_f1', 'seconds']
    if not args.resume or not log_path.exists():
        with open(log_path, 'w', newline='') as handle:
            csv.writer(handle).writerow(fields)

    for epoch in range(start, args.epochs):
        model.train()
        began, losses = time.time(), []
        for step, (image, target, valid) in enumerate(train_loader):
            if args.max_steps and step >= args.max_steps:
                break
            image, target, valid = image.to(device, non_blocking=True), target.to(device), valid.to(device)
            with torch.autocast(device_type=device.type, enabled=device.type == 'cuda'):
                logits = model(image)
            loss = masked_loss(logits.float(), target, valid, args.pos_weight)
            optimizer.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            schedule.step()
            losses.append(loss.item())

        metrics = score(predict_all(model, val_loader, device), threshold=0.5)
        seconds = time.time() - began
        row = {'epoch': epoch, 'loss': float(np.mean(losses)), **metrics, 'seconds': seconds}
        with open(log_path, 'a', newline='') as handle:
            csv.writer(handle).writerow([round(row[field], 4) if isinstance(row[field], float) else row[field] for field in fields])
        print(f'epoch {epoch:3d} · loss {row["loss"]:.4f} · val f1 {metrics["f1"]:.3f} iou {metrics["iou"]:.3f} '
              f'· objects found {metrics["object_recall"]:.2f} right {metrics["object_precision"]:.2f} · {seconds:.0f}s', flush=True)
        if metrics['f1'] > best:
            best = metrics['f1']
            torch.save({'model': model.state_dict(), 'config': config, 'epoch': epoch, 'val': metrics}, out / 'best.pt')
        torch.save({'model': model.state_dict(), 'optimizer': optimizer.state_dict(), 'schedule': schedule.state_dict(),
                    'epoch': epoch, 'best': best}, out / 'last.pt')
    print(f'best val f1 {best:.3f}', flush=True)


if __name__ == '__main__':
    main()
