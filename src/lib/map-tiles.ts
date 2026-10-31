import type { LatLng } from '@/lib/solar/types';

// Satellite imagery around a building from the Google Map Tiles API (2D
// tiles), stitched into one canvas and placed in the building's scene frame:
// meters east (x) and south (z) of its center.
export type Basemap = {
  canvas: HTMLCanvasElement;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  attribution: string;
};

const TILE_API = 'https://tile.googleapis.com';
const TILE_PIXELS = 256;
const METERS_PER_DEGREE = 111320;
// At most this many tiles across, which bounds the download and canvas size.
const MAX_TILES_ACROSS = 8;
const MAX_ZOOM = 19;

type Session = { token: string; expiresAt: number };
let session: Promise<Session> | null = null;

function satelliteSession(apiKey: string): Promise<Session> {
  const reuse = session;
  if (reuse) {
    return reuse.then((current) => (current.expiresAt - Date.now() > 60_000 ? current : (session = null, satelliteSession(apiKey))));
  }
  session = fetch(`${TILE_API}/v1/createSession?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapType: 'satellite', language: 'en-US', region: 'US' }),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Map Tiles session failed (${response.status})`);
    const body = await response.json() as { session: string; expiry: string };
    return { token: body.session, expiresAt: Number(body.expiry) * 1000 };
  });
  session.catch(() => { session = null; });
  return session;
}

// Web Mercator tile coordinates.
const tileX = (longitude: number, zoom: number) => ((longitude + 180) / 360) * 2 ** zoom;
const tileY = (latitude: number, zoom: number) => {
  const phi = (latitude * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * 2 ** zoom;
};
const tileLongitude = (x: number, zoom: number) => (x / 2 ** zoom) * 360 - 180;
const tileLatitude = (y: number, zoom: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** zoom))) * 180) / Math.PI;

async function loadTile(url: string, signal: AbortSignal): Promise<ImageBitmap | null> {
  const response = await fetch(url, { signal });
  if (!response.ok) return null;
  return createImageBitmap(await response.blob());
}

// Imagery within `radiusMeters` of `center`, at the finest zoom (up to 19,
// Google's satellite limit over New York) that keeps the area within
// MAX_TILES_ACROSS tiles.
export async function loadBasemap(center: LatLng, radiusMeters: number, apiKey: string, signal: AbortSignal): Promise<Basemap> {
  const { token } = await satelliteSession(apiKey);
  const xScale = METERS_PER_DEGREE * Math.cos((center.latitude * Math.PI) / 180);
  const north = center.latitude + radiusMeters / METERS_PER_DEGREE;
  const south = center.latitude - radiusMeters / METERS_PER_DEGREE;
  const west = center.longitude - radiusMeters / xScale;
  const east = center.longitude + radiusMeters / xScale;

  let zoom = MAX_ZOOM;
  while (zoom > 15 && Math.floor(tileX(east, zoom)) - Math.floor(tileX(west, zoom)) + 1 > MAX_TILES_ACROSS) zoom -= 1;
  const x0 = Math.floor(tileX(west, zoom)), x1 = Math.floor(tileX(east, zoom));
  const y0 = Math.floor(tileY(north, zoom)), y1 = Math.floor(tileY(south, zoom));

  const query = `session=${encodeURIComponent(token)}&key=${encodeURIComponent(apiKey)}`;
  const jobs: Array<Promise<[number, number, ImageBitmap | null]>> = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      jobs.push(loadTile(`${TILE_API}/v1/2dtiles/${zoom}/${x}/${y}?${query}`, signal).then((image) => [x, y, image]));
    }
  }
  const viewport = fetch(
    `${TILE_API}/tile/v1/viewport?${query}&zoom=${zoom}&north=${north}&south=${south}&east=${east}&west=${west}`,
    { signal },
  ).then((response) => (response.ok ? response.json() : null)).catch(() => null) as Promise<{ copyright?: string } | null>;

  const canvas = document.createElement('canvas');
  canvas.width = (x1 - x0 + 1) * TILE_PIXELS;
  canvas.height = (y1 - y0 + 1) * TILE_PIXELS;
  const context = canvas.getContext('2d')!;
  for (const [x, y, image] of await Promise.all(jobs)) {
    if (!image) continue;
    context.drawImage(image, (x - x0) * TILE_PIXELS, (y - y0) * TILE_PIXELS);
    image.close();
  }
  const copyright = (await viewport)?.copyright;

  // Within a few hundred meters the Mercator grid is close to linear, so the
  // canvas maps to a rectangle in the scene frame.
  return {
    canvas,
    minX: (tileLongitude(x0, zoom) - center.longitude) * xScale,
    maxX: (tileLongitude(x1 + 1, zoom) - center.longitude) * xScale,
    minZ: -(tileLatitude(y0, zoom) - center.latitude) * METERS_PER_DEGREE,
    maxZ: -(tileLatitude(y1 + 1, zoom) - center.latitude) * METERS_PER_DEGREE,
    attribution: copyright ? `Google · ${copyright}` : 'Imagery © Google',
  };
}
