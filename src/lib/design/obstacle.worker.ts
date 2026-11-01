// Runs the rooftop obstacle U-Net (public/models/roof-obstacles.onnx, trained
// on 2014 orthoimagery with LiDAR-derived labels; see ml/) off the main
// thread. Large crops run as overlapping 512-pixel tiles.
import * as ort from 'onnxruntime-web/wasm';

export type ObstacleRequest = {
  id: number;
  // The site's path prefix, where /models and /ort are served.
  base: string;
  width: number;
  height: number;
  // RGBA at 15 cm per pixel, north up.
  pixels: Uint8ClampedArray;
};
export type ObstacleMessage =
  | { id: number; type: 'done'; probability: Float32Array }
  | { id: number; type: 'error'; message: string };

// ImageNet statistics, as in training (ml/train/common.py).
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const TILE = 512;
// Tile edges see less context, so neighbors overlap and each keeps its middle.
const OVERLAP = 64;

let session: Promise<ort.InferenceSession> | null = null;

function open(base: string): Promise<ort.InferenceSession> {
  // GitHub Pages is not cross-origin isolated, so threads are unavailable.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = `${base}/ort/`;
  session ??= ort.InferenceSession.create(`${base}/models/roof-obstacles.onnx`, { executionProviders: ['wasm'] });
  return session;
}

// Tile origins along one axis: the whole axis when it fits in one tile.
function starts(length: number): number[] {
  if (length <= TILE) return [0];
  const result: number[] = [];
  for (let start = 0; start + TILE < length; start += TILE - OVERLAP) result.push(start);
  result.push(length - TILE);
  return result;
}

const multipleOf32 = (value: number) => Math.ceil(value / 32) * 32;

async function predict(model: ort.InferenceSession, width: number, height: number, pixels: Uint8ClampedArray): Promise<Float32Array> {
  const probability = new Float32Array(width * height);
  const columns = starts(width);
  const rows = starts(height);
  for (const top of rows) {
    for (const left of columns) {
      const tileWidth = multipleOf32(Math.min(TILE, width));
      const tileHeight = multipleOf32(Math.min(TILE, height));
      const plane = tileWidth * tileHeight;
      // Beyond the image, the mean color normalizes to zero.
      const input = new Float32Array(3 * plane);
      for (let y = 0; y < tileHeight && top + y < height; y += 1) {
        for (let x = 0; x < tileWidth && left + x < width; x += 1) {
          const at = ((top + y) * width + left + x) * 4;
          const index = y * tileWidth + x;
          for (let channel = 0; channel < 3; channel += 1) {
            input[channel * plane + index] = (pixels[at + channel] / 255 - MEAN[channel]) / STD[channel];
          }
        }
      }
      const output = await model.run({ image: new ort.Tensor('float32', input, [1, 3, tileHeight, tileWidth]) });
      const values = output.probability.data as Float32Array;
      // Keep the tile's middle; at the image border keep out to the edge.
      const keepTop = top === 0 ? 0 : OVERLAP / 2;
      const keepLeft = left === 0 ? 0 : OVERLAP / 2;
      for (let y = keepTop; y < tileHeight && top + y < height; y += 1) {
        for (let x = keepLeft; x < tileWidth && left + x < width; x += 1) {
          probability[(top + y) * width + left + x] = values[y * tileWidth + x];
        }
      }
    }
  }
  return probability;
}

self.onmessage = async (event: MessageEvent<ObstacleRequest>) => {
  const { id, base, width, height, pixels } = event.data;
  try {
    const probability = await predict(await open(base), width, height, pixels);
    (self as unknown as Worker).postMessage({ id, type: 'done', probability } satisfies ObstacleMessage, [probability.buffer]);
  } catch (error) {
    // A failed load is retried next time.
    session = null;
    (self as unknown as Worker).postMessage({ id, type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies ObstacleMessage);
  }
};
