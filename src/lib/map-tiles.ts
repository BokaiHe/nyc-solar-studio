import type { LatLng } from '@/lib/solar/types';

// New York State orthoimagery (NYS ITS Geospatial Services): free, keyless and
// served with CORS, so the static site can use it both as the map's satellite
// layer and under the 3D scene. The 2014 flight matches the 2014 survey behind
// the NYC LoD2 models, so buildings built or torn down since then agree with
// the imagery; it is also leaf-on with short shadows, unlike the winter
// flights of later years.
export const ORTHO_SERVICE = 'https://orthos.its.ny.gov/arcgis/rest/services/wms/2014/MapServer';
export const ORTHO_ATTRIBUTION = 'Imagery © NYS ITS Geospatial Services (2014)';

// The map's raster source: MapLibre fills in each tile's Web Mercator bounds.
export const ORTHO_TILE_URL = `${ORTHO_SERVICE}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=jpg&f=image`;

// Imagery around a building, placed in its scene frame: meters east (x) and
// south (z) of its center.
export type Basemap = {
  canvas: HTMLCanvasElement;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  attribution: string;
};

const EARTH_RADIUS = 6378137;
// Aim for about 15 cm per pixel, within the service's image size limit.
const METERS_PER_PIXEL = 0.15;
const MAX_PIXELS = 2048;

// One image covering `radiusMeters` around `center`.
export async function loadBasemap(center: LatLng, radiusMeters: number, signal: AbortSignal): Promise<Basemap> {
  const x = (center.longitude * Math.PI * EARTH_RADIUS) / 180;
  const y = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (center.latitude * Math.PI) / 360));
  // Mercator stretches ground distances by 1 / cos(latitude).
  const half = radiusMeters / Math.cos((center.latitude * Math.PI) / 180);
  const pixels = Math.min(MAX_PIXELS, Math.ceil((2 * radiusMeters) / METERS_PER_PIXEL));
  const url = `${ORTHO_SERVICE}/export?bbox=${x - half},${y - half},${x + half},${y + half}&bboxSR=3857&imageSR=3857&size=${pixels},${pixels}&format=jpg&f=image`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Orthoimagery unavailable (${response.status})`);
  const image = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  image.close();
  return { canvas, minX: -radiusMeters, maxX: radiusMeters, minZ: -radiusMeters, maxZ: radiusMeters, attribution: ORTHO_ATTRIBUTION };
}
