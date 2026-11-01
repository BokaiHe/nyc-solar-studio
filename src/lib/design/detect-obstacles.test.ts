import { describe, expect, it } from 'vitest';
import { convexHull, detectObstacles, minAreaRectangle, type SceneImage } from './detect-obstacles';
import type { RoofFace } from './roof-faces';

// A 40 m square flat roof at 10 m, centered on the scene origin.
const roof: RoofFace = {
  triangles: [
    [[-20, 10, -20], [20, 10, -20], [20, 10, 20]],
    [[-20, 10, -20], [20, 10, 20], [-20, 10, 20]],
  ],
  normal: [0, 1, 0],
  offset: 10,
  slopeDegrees: 0,
  azimuthDegrees: 180,
  areaSquareMeters: 1600,
  boundary: [],
};

// 0.2 m pixels over ±25 m: gray membrane with faint noise, then whatever
// rectangles (in meters) are painted on top.
function image(paint: Array<{ x: [number, number]; z: [number, number]; rgb: [number, number, number] }>): SceneImage {
  const size = 250;
  const data = new Uint8ClampedArray(size * size * 4);
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 12;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const x = -25 + (column + 0.5) * 0.2;
      const z = -25 + (row + 0.5) * 0.2;
      const color = paint.find((item) => x >= item.x[0] && x <= item.x[1] && z >= item.z[0] && z <= item.z[1])?.rgb ?? [150, 146, 140];
      const at = (row * size + column) * 4;
      const jitter = noise();
      data[at] = color[0] + jitter;
      data[at + 1] = color[1] + jitter;
      data[at + 2] = color[2] + jitter;
      data[at + 3] = 255;
    }
  }
  return { width: size, height: size, data, minX: -25, maxX: 25, minZ: -25, maxZ: 25 };
}

describe('detectObstacles', () => {
  it('finds a dark unit and a light skylight on a bare roof', () => {
    const zones = detectObstacles(image([
      { x: [-10, -6], z: [-5, -2], rgb: [60, 60, 62] },
      { x: [5, 7], z: [8, 11], rgb: [120, 200, 205] },
    ]), [roof]);
    expect(zones).toHaveLength(2);
    // The larger unit first, outlined within the margin at roof height.
    const xs = zones[0].map((point) => point[0]);
    const zs = zones[0].map((point) => point[2]);
    expect(Math.min(...xs)).toBeCloseTo(-10.15, 0);
    expect(Math.max(...xs)).toBeCloseTo(-5.85, 0);
    expect(Math.min(...zs)).toBeCloseTo(-5.15, 0);
    expect(Math.max(...zs)).toBeCloseTo(-1.85, 0);
    expect(zones[0].every((point) => point[1] === 10)).toBe(true);
  });

  it('leaves a bare roof alone, and ignores the edges and things already marked', () => {
    expect(detectObstacles(image([]), [roof])).toEqual([]);
    // A dark strip hugging the parapet is its shadow, not equipment.
    expect(detectObstacles(image([{ x: [-20, 20], z: [-20, -19.6], rgb: [50, 50, 50] }]), [roof])).toEqual([]);
    const unit = image([{ x: [0, 3], z: [0, 3], rgb: [60, 60, 62] }]);
    const marked = { id: 1, points: [[-1, 10, -1], [4, 10, -1], [4, 10, 4], [-1, 10, 4]] as Array<[number, number, number]> };
    expect(detectObstacles(unit, [roof], [marked])).toEqual([]);
  });

  it('drops long dark strips cast by walls and higher roofs', () => {
    expect(detectObstacles(image([{ x: [-15, 15], z: [-6, -3], rgb: [55, 55, 58] }]), [roof])).toEqual([]);
    // A long light object, such as a row of skylights, is kept.
    expect(detectObstacles(image([{ x: [-10, 10], z: [-6, -3], rgb: [120, 200, 205] }]), [roof])).toHaveLength(1);
  });

  it('skips pitched roofs and shadows covering much of a roof', () => {
    expect(detectObstacles(image([{ x: [-4, 0], z: [-4, 0], rgb: [60, 60, 62] }]), [{ ...roof, slopeDegrees: 30 }])).toEqual([]);
    expect(detectObstacles(image([{ x: [-19, 19], z: [-19, 5], rgb: [60, 60, 62] }]), [roof])).toEqual([]);
  });
});

describe('detectObstacles with model probabilities', () => {
  // Marks a rectangle (meters) as likely on the 0.2 m grid of `image`.
  const probability = (x: [number, number], z: [number, number]) => {
    const data = new Float32Array(250 * 250);
    for (let row = 0; row < 250; row += 1) {
      for (let column = 0; column < 250; column += 1) {
        const px = -25 + (column + 0.5) * 0.2;
        const pz = -25 + (row + 0.5) * 0.2;
        data[row * 250 + column] = px >= x[0] && px <= x[1] && pz >= z[0] && pz <= z[1] ? 0.9 : 0.05;
      }
    }
    return { data, threshold: 0.4 };
  };

  it('outlines what the model marks, whatever the colors say', () => {
    const zones = detectObstacles(image([{ x: [-10, -6], z: [-5, -2], rgb: [60, 60, 62] }]), [roof], [], probability([4, 8], [6, 9]));
    expect(zones).toHaveLength(1);
    const xs = zones[0].map((point) => point[0]);
    expect(Math.min(...xs)).toBeCloseTo(3.85, 0);
    expect(Math.max(...xs)).toBeCloseTo(8.15, 0);
  });

  it('keeps larger plant than the color rule allows', () => {
    expect(detectObstacles(image([]), [roof], [], probability([-6, 6], [-5, 4]))).toHaveLength(1);
  });
});

describe('minAreaRectangle', () => {
  it('fits a rotated square tightly', () => {
    const diamond: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const rectangle = minAreaRectangle(convexHull(diamond))!;
    expect(rectangle.shortSide).toBeCloseTo(Math.SQRT2, 5);
  });
});
