import type { Basemap } from '@/lib/map-tiles';
import type { ObstacleProbability, SceneImage } from './detect-obstacles';
import { FLAT_ROOF_DEGREES } from './geometry';
import type { RoofFace } from './roof-faces';
import type { ObstacleMessage, ObstacleRequest } from './obstacle.worker';

// The model sees 15 cm pixels, as in training; the threshold was picked on
// the validation split (ml/train/evaluate.py).
const PIXEL_METERS = 0.15;
const THRESHOLD = 0.4;
// Context around the roof, so objects at its edge are seen whole.
const MARGIN_METERS = 4;
// Huge roofs are read a little coarser rather than as giant images.
const MAX_SIDE = 2400;

// The basemap around the building's flat roofs, resampled to the model's
// pixel size; null when the building has no flat roof.
export function roofCrop(basemap: Basemap, faces: RoofFace[]): SceneImage | null {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const face of faces) {
    if (face.slopeDegrees >= FLAT_ROOF_DEGREES) continue;
    for (const triangle of face.triangles) {
      for (const [x, , z] of triangle) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  minX = Math.max(basemap.minX, minX - MARGIN_METERS);
  maxX = Math.min(basemap.maxX, maxX + MARGIN_METERS);
  minZ = Math.max(basemap.minZ, minZ - MARGIN_METERS);
  maxZ = Math.min(basemap.maxZ, maxZ + MARGIN_METERS);
  const pixel = Math.max(PIXEL_METERS, Math.max(maxX - minX, maxZ - minZ) / MAX_SIDE);
  const width = Math.max(32, Math.round((maxX - minX) / pixel));
  const height = Math.max(32, Math.round((maxZ - minZ) / pixel));
  const source = basemap.canvas;
  const scaleX = source.width / (basemap.maxX - basemap.minX);
  const scaleZ = source.height / (basemap.maxZ - basemap.minZ);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, (minX - basemap.minX) * scaleX, (minZ - basemap.minZ) * scaleZ, (maxX - minX) * scaleX, (maxZ - minZ) * scaleZ, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  return { width, height, data, minX, maxX, minZ, maxZ };
}

let nextId = 0;

// The model's obstacle probability for every pixel of a crop.
export function runObstacleModel(worker: Worker, image: SceneImage, base: string): Promise<ObstacleProbability> {
  const id = (nextId += 1);
  return new Promise((resolve, reject) => {
    const settle = (event: MessageEvent<ObstacleMessage>) => {
      if (event.data.id !== id) return;
      worker.removeEventListener('message', settle);
      worker.removeEventListener('error', fail);
      if (event.data.type === 'done') resolve({ data: event.data.probability, threshold: THRESHOLD });
      else reject(new Error(event.data.message));
    };
    const fail = (event: ErrorEvent) => {
      worker.removeEventListener('message', settle);
      worker.removeEventListener('error', fail);
      reject(new Error(event.message));
    };
    worker.addEventListener('message', settle);
    worker.addEventListener('error', fail);
    const pixels = image.data.slice();
    worker.postMessage({ id, base, width: image.width, height: image.height, pixels } satisfies ObstacleRequest, [pixels.buffer]);
  });
}
