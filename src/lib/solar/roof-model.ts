import 'server-only';

import * as geotiff from 'geotiff';
import * as geokeysToProj4 from 'geotiff-geokeys-to-proj4';
import proj4 from 'proj4';
import type { LatLng, RoofModelData } from './types';

type Bounds = { north: number; south: number; east: number; west: number };
type Raster = { width: number; height: number; values: number[]; bounds: Bounds };

async function downloadRaster(url: string, apiKey: string): Promise<Raster> {
  const response = await fetch(`${url}&key=${apiKey}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Layer download failed: ${response.status}`);
  const tiff = await geotiff.fromArrayBuffer(await response.arrayBuffer());
  const image = await tiff.getImage();
  const rasters = await image.readRasters();
  const geoKeys = image.getGeoKeys();
  if (!geoKeys) throw new Error('GeoTIFF projection metadata is missing');
  const projectionDefinition = geokeysToProj4.toProj4(geoKeys);
  const projection = proj4(projectionDefinition.proj4, 'WGS84');
  const box = image.getBoundingBox();
  const sw = projection.forward({
    x: box[0] * projectionDefinition.conversionParameters.x,
    y: box[1] * projectionDefinition.conversionParameters.y,
  });
  const ne = projection.forward({
    x: box[2] * projectionDefinition.conversionParameters.x,
    y: box[3] * projectionDefinition.conversionParameters.y,
  });
  return {
    width: rasters.width,
    height: rasters.height,
    values: Array.from(rasters[0] as geotiff.TypedArray),
    bounds: { north: ne.y, south: sw.y, east: ne.x, west: sw.x },
  };
}

function pixelForLocation(raster: Raster, location: LatLng) {
  return {
    column: Math.round(((location.longitude - raster.bounds.west) / (raster.bounds.east - raster.bounds.west)) * (raster.width - 1)),
    row: Math.round(((raster.bounds.north - location.latitude) / (raster.bounds.north - raster.bounds.south)) * (raster.height - 1)),
  };
}

function nearestRoofSeed(mask: Raster, location: LatLng) {
  const target = pixelForLocation(mask, location);
  for (let radius = 0; radius <= 20; radius += 1) {
    for (let row = target.row - radius; row <= target.row + radius; row += 1) {
      for (let column = target.column - radius; column <= target.column + radius; column += 1) {
        if (row < 0 || column < 0 || row >= mask.height || column >= mask.width) continue;
        if (mask.values[row * mask.width + column] > 0) return { row, column };
      }
    }
  }
  throw new Error('Selected building was not present in the roof mask');
}

export function connectedRoofMask(mask: Raster, location: LatLng): Uint8Array {
  const seed = nearestRoofSeed(mask, location);
  const selected = new Uint8Array(mask.width * mask.height);
  const queue = [seed.row * mask.width + seed.column];
  selected[queue[0]] = 1;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    const row = Math.floor(index / mask.width);
    const column = index % mask.width;
    const neighbors = [index - 1, index + 1, index - mask.width, index + mask.width];
    for (const neighbor of neighbors) {
      if (neighbor < 0 || neighbor >= selected.length || selected[neighbor]) continue;
      const neighborRow = Math.floor(neighbor / mask.width);
      const neighborColumn = neighbor % mask.width;
      if (Math.abs(neighborRow - row) + Math.abs(neighborColumn - column) !== 1) continue;
      if (mask.values[neighbor] <= 0) continue;
      selected[neighbor] = 1;
      queue.push(neighbor);
    }
  }
  return selected;
}

function median(values: number[]) {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function quantile(sortedValues: number[], fraction: number) {
  if (!sortedValues.length) return 0;
  return sortedValues[Math.min(sortedValues.length - 1, Math.floor((sortedValues.length - 1) * fraction))];
}

function convexHull(points: Array<[number, number]>) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length <= 2) return sorted;
  const cross = (origin: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
  const lower: Array<[number, number]> = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Array<[number, number]> = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export async function buildRoofModel(
  urls: { dsmUrl: string; maskUrl: string; imageryQuality: string; imageryDate?: { year: number; month: number; day: number } },
  apiKey: string,
  location: LatLng,
): Promise<RoofModelData> {
  const [dsm, mask] = await Promise.all([
    downloadRaster(urls.dsmUrl, apiKey),
    downloadRaster(urls.maskUrl, apiKey),
  ]);
  if (dsm.width !== mask.width || dsm.height !== mask.height) {
    throw new Error('DSM and roof mask dimensions differ');
  }
  const selected = connectedRoofMask(mask, location);
  const roofValues: number[] = [];
  const groundValues: number[] = [];
  for (let index = 0; index < dsm.values.length; index += 1) {
    const value = dsm.values[index];
    if (!Number.isFinite(value) || value <= -1000) continue;
    if (selected[index]) roofValues.push(value);
    else if (mask.values[index] <= 0) groundValues.push(value);
  }
  if (roofValues.length < 4) throw new Error('Roof mask contains too few pixels');
  const sortedRoofValues = [...roofValues].sort((a, b) => a - b);
  const roofMedian = quantile(sortedRoofValues, 0.5);
  const roofLow = quantile(sortedRoofValues, 0.04);
  const roofHigh = quantile(sortedRoofValues, 0.96);
  const groundMedian = median(groundValues);
  const baseElevation = Math.min(roofMedian - 3, groundMedian || roofMedian - 8);
  const centerLatitude = (dsm.bounds.north + dsm.bounds.south) / 2;
  const fullWidthMeters = (dsm.bounds.east - dsm.bounds.west) * 111_320 * Math.cos(centerLatitude * Math.PI / 180);
  const fullDepthMeters = (dsm.bounds.north - dsm.bounds.south) * 111_320;
  let minRow = dsm.height - 1;
  let maxRow = 0;
  let minColumn = dsm.width - 1;
  let maxColumn = 0;
  for (let index = 0; index < selected.length; index += 1) {
    if (!selected[index]) continue;
    const row = Math.floor(index / dsm.width);
    const column = index % dsm.width;
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
    minColumn = Math.min(minColumn, column);
    maxColumn = Math.max(maxColumn, column);
  }
  minRow = Math.max(0, minRow - 2);
  maxRow = Math.min(dsm.height - 1, maxRow + 2);
  minColumn = Math.max(0, minColumn - 2);
  maxColumn = Math.min(dsm.width - 1, maxColumn + 2);
  const metersPerColumn = fullWidthMeters / Math.max(1, dsm.width - 1);
  const metersPerRow = fullDepthMeters / Math.max(1, dsm.height - 1);
  const widthMeters = (maxColumn - minColumn) * metersPerColumn;
  const depthMeters = (maxRow - minRow) * metersPerRow;
  const centerColumn = (minColumn + maxColumn) / 2;
  const centerRow = (minRow + maxRow) / 2;
  const positions: number[] = [];
  const indices: number[] = [];
  const wallPositions: number[] = [];
  const wallIndices: number[] = [];
  const vertexByPixel = new Int32Array(dsm.width * dsm.height).fill(-1);
  const cleanedElevation = new Float32Array(dsm.width * dsm.height);
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const pixelIndex = row * dsm.width + column;
      if (!selected[pixelIndex]) continue;
      const elevation = dsm.values[pixelIndex];
      if (!Number.isFinite(elevation) || elevation <= -1000) continue;
      const cleanElevation = Math.min(roofHigh + 0.2, Math.max(roofLow - 0.2, elevation));
      cleanedElevation[pixelIndex] = cleanElevation;
      vertexByPixel[pixelIndex] = positions.length / 3;
      positions.push(
        (column - centerColumn) * metersPerColumn,
        Math.max(0, cleanElevation - baseElevation),
        (row - centerRow) * metersPerRow,
      );
    }
  }
  for (let row = minRow; row < maxRow; row += 1) {
    for (let column = minColumn; column < maxColumn; column += 1) {
      const a = vertexByPixel[row * dsm.width + column];
      const b = vertexByPixel[row * dsm.width + column + 1];
      const c = vertexByPixel[(row + 1) * dsm.width + column];
      const d = vertexByPixel[(row + 1) * dsm.width + column + 1];
      if (a >= 0 && b >= 0 && c >= 0) indices.push(a, c, b);
      if (b >= 0 && c >= 0 && d >= 0) indices.push(b, c, d);
    }
  }
  const addWall = (x1: number, z1: number, x2: number, z2: number, top: number) => {
    const start = wallPositions.length / 3;
    wallPositions.push(x1, 0, z1, x2, 0, z2, x1, top, z1, x2, top, z2);
    wallIndices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
  };
  const footprintPoints: Array<[number, number]> = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const pixelIndex = row * dsm.width + column;
      if (!selected[pixelIndex] || vertexByPixel[pixelIndex] < 0) continue;
      footprintPoints.push([
        (column - centerColumn) * metersPerColumn,
        (row - centerRow) * metersPerRow,
      ]);
    }
  }
  const hull = convexHull(footprintPoints);
  const wallTop = Math.max(2.5, roofMedian - baseElevation - 0.35);
  for (let index = 0; index < hull.length; index += 1) {
    const current = hull[index];
    const next = hull[(index + 1) % hull.length];
    addWall(current[0], current[1], next[0], next[1], wallTop);
  }
  const deckPositions = hull.flatMap(([x, z]) => [x, wallTop, z]);
  const deckIndices: number[] = [];
  for (let index = 1; index < hull.length - 1; index += 1) deckIndices.push(0, index, index + 1);
  return {
    positions,
    indices,
    wallPositions,
    wallIndices,
    deckPositions,
    deckIndices,
    widthMeters,
    depthMeters,
    baseElevationMeters: baseElevation,
    center: location,
    imageryQuality: urls.imageryQuality,
    imageryDate: urls.imageryDate,
  };
}
