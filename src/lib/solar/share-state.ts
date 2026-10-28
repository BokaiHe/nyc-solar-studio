import type { CameraState, ConceptPanel, DateValue } from './types';

export type SharedDesign = {
  latitude: number;
  longitude: number;
  baseCount: number;
  added: number[];
  removed: number[];
  imageryDate: DateValue;
  panelCount: number;
  camera: CameraState;
  concept?: SharedConcept;
};

export type SharedConcept = {
  buildingId: string;
  panels: ConceptPanel[];
};

// Each 3D panel: x_y_z (centimeters) _azimuth_tilt (degrees) _landscape, joined by '*'.
function encodeConceptPanels(panels: ConceptPanel[]): string {
  return panels.map((panel) => [
    ...panel.position.map((value) => Math.round(value * 100)),
    Math.round(panel.azimuthDegrees),
    Math.round(panel.tiltDegrees),
    panel.landscape ? 1 : 0,
  ].join('_')).join('*');
}

function parseConceptPanels(value: string | null): ConceptPanel[] {
  if (!value) return [];
  const panels: ConceptPanel[] = [];
  for (const item of value.split('*')) {
    const parts = item.split('_').map(Number);
    if (parts.length !== 6 || parts.some((part) => !Number.isFinite(part))) continue;
    const [x, y, z, azimuth, tilt, landscape] = parts;
    if (tilt < 0 || tilt > 90) continue;
    panels.push({
      id: panels.length + 1,
      position: [x / 100, y / 100, z / 100],
      azimuthDegrees: ((azimuth % 360) + 360) % 360,
      tiltDegrees: tilt,
      landscape: landscape === 1,
    });
  }
  return panels;
}

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

  const buildingId = params.get('bid');
  const conceptPanels = parseConceptPanels(params.get('p3'));

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
    ...(params.get('view') === '3d' && buildingId
      ? { concept: { buildingId, panels: conceptPanels } }
      : {}),
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
  if (design.concept) {
    params.set('view', '3d');
    params.set('bid', design.concept.buildingId);
    if (design.concept.panels.length) params.set('p3', encodeConceptPanels(design.concept.panels));
  }
  return `/b?${params}`;
}

export function selectedIndicesFromSharedDesign(design: SharedDesign): Set<number> {
  const selected = new Set(
    Array.from({ length: Math.min(design.baseCount, design.panelCount) }, (_, index) => index),
  );
  for (const index of design.removed) selected.delete(index);
  for (const index of design.added) {
    if (index < design.panelCount) selected.add(index);
  }
  return selected;
}
