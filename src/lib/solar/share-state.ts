import type { CameraState, DateValue } from './types';

export type SharedDesign = {
  latitude: number;
  longitude: number;
  baseCount: number;
  added: number[];
  removed: number[];
  imageryDate: DateValue;
  panelCount: number;
  camera: CameraState;
};

function parseNumberList(value: string | null): number[] {
  if (!value) return [];
  return value
    .split(',')
    .map(Number)
    .filter((item) => Number.isInteger(item) && item >= 0);
}

export function parseSharedDesign(search: string): SharedDesign | null {
  const params = new URLSearchParams(search);
  const latitude = Number(params.get('lat'));
  const longitude = Number(params.get('lng'));
  const baseCount = Number(params.get('base') ?? 0);
  const panelCount = Number(params.get('count'));
  const date = params.get('date');
  const cameraParts = params.get('cam')?.split(',').map(Number) ?? [];

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isInteger(baseCount) ||
    baseCount < 0 ||
    !Number.isInteger(panelCount) ||
    panelCount < 0 ||
    baseCount > panelCount ||
    !date?.match(/^\d{8}$/) ||
    cameraParts.length !== 3 ||
    cameraParts.some((value) => !Number.isFinite(value))
  ) {
    return null;
  }

  return {
    latitude,
    longitude,
    baseCount,
    added: parseNumberList(params.get('on')),
    removed: parseNumberList(params.get('off')),
    imageryDate: {
      year: Number(date.slice(0, 4)),
      month: Number(date.slice(4, 6)),
      day: Number(date.slice(6, 8)),
    },
    panelCount,
    camera: {
      heading: cameraParts[0],
      tilt: cameraParts[1],
      range: cameraParts[2],
    },
  };
}

export function encodeSharedDesign(design: SharedDesign): string {
  const params = new URLSearchParams({
    lat: design.latitude.toFixed(6),
    lng: design.longitude.toFixed(6),
    base: design.baseCount.toString(),
    date: `${design.imageryDate.year}${String(design.imageryDate.month).padStart(2, '0')}${String(design.imageryDate.day).padStart(2, '0')}`,
    count: design.panelCount.toString(),
    cam: [design.camera.heading, design.camera.tilt, design.camera.range]
      .map((value) => Math.round(value))
      .join(','),
  });

  if (design.removed.length) params.set('off', design.removed.join(','));
  if (design.added.length) params.set('on', design.added.join(','));
  return `/b?${params}`;
}

export function selectedIndicesFromSharedDesign(design: SharedDesign): Set<number> {
  const selected = new Set(Array.from({ length: design.baseCount }, (_, index) => index));
  for (const index of design.removed) selected.delete(index);
  for (const index of design.added) selected.add(index);
  return selected;
}
