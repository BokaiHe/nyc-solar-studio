import type { ConceptPanel, LatLng } from '@/lib/solar/types';
import type { KeepOutZone } from './keep-out';

export type SharedDesign = {
  location: LatLng;
  buildingId: string;
  panels: ConceptPanel[];
  keepOut: KeepOutZone[];
};

// Each panel: x_y_z (centimeters) _azimuth_tilt (degrees) _landscape _flush, joined by '*'.
function encodePanels(panels: ConceptPanel[]): string {
  return panels.map((panel) => [
    ...panel.position.map((value) => Math.round(value * 100)),
    Math.round(panel.azimuthDegrees),
    Math.round(panel.tiltDegrees),
    panel.landscape ? 1 : 0,
    panel.mount === 'flush' ? 1 : 0,
  ].join('_')).join('*');
}

function parsePanels(value: string | null): ConceptPanel[] {
  if (!value) return [];
  const panels: ConceptPanel[] = [];
  for (const item of value.split('*')) {
    const parts = item.split('_').map(Number);
    if (parts.length !== 7 || parts.some((part) => !Number.isFinite(part))) continue;
    const [x, y, z, azimuth, tilt, landscape, flush] = parts;
    if (tilt < 0 || tilt > 90) continue;
    panels.push({
      id: panels.length + 1,
      position: [x / 100, y / 100, z / 100],
      azimuthDegrees: ((azimuth % 360) + 360) % 360,
      tiltDegrees: tilt,
      landscape: landscape === 1,
      mount: flush === 1 ? 'flush' : 'rack',
    });
  }
  return panels;
}

// Each zone: its points as x_y_z (centimeters) joined by '_', zones joined by '*'.
function encodeZones(zones: KeepOutZone[]): string {
  return zones.map((zone) => zone.points.flatMap((point) => point.map((value) => Math.round(value * 100))).join('_')).join('*');
}

function parseZones(value: string | null): KeepOutZone[] {
  if (!value) return [];
  const zones: KeepOutZone[] = [];
  for (const item of value.split('*')) {
    const parts = item.split('_').map(Number);
    if (parts.length < 9 || parts.length % 3 !== 0 || parts.some((part) => !Number.isFinite(part))) continue;
    const points: KeepOutZone['points'] = [];
    for (let i = 0; i < parts.length; i += 3) points.push([parts[i] / 100, parts[i + 1] / 100, parts[i + 2] / 100]);
    zones.push({ id: zones.length + 1, points });
  }
  return zones;
}

export function encodeSharedDesign(design: SharedDesign): string {
  const params = new URLSearchParams({
    lat: design.location.latitude.toFixed(6),
    lng: design.location.longitude.toFixed(6),
    bid: design.buildingId,
  });
  if (design.panels.length) params.set('p3', encodePanels(design.panels));
  if (design.keepOut.length) params.set('k', encodeZones(design.keepOut));
  // The trailing slash matches the static export's page folders.
  return `/b/?${params}`;
}

export function parseSharedDesign(search: string): SharedDesign | null {
  const params = new URLSearchParams(search);
  const latitude = Number(params.get('lat'));
  const longitude = Number(params.get('lng'));
  const buildingId = params.get('bid');
  if (
    !params.has('lat') || !params.has('lng') || !buildingId
    || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180
  ) {
    return null;
  }
  return { location: { latitude, longitude }, buildingId, panels: parsePanels(params.get('p3')), keepOut: parseZones(params.get('k')) };
}
