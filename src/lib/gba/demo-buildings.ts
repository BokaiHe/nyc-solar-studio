import type { LatLng } from '@/lib/solar/types';

export type GbaBuildingMatch = {
  id: string;
  address: string;
  footprint: LatLng[];
  heightMeters: number;
  heightVariance: number;
};

const DEMO_BUILDINGS: GbaBuildingMatch[] = [
  {
    id: 'osm248172169USA',
    address: '74-26 175th Street, Queens, NY 11366',
    heightMeters: 3.9198966026306152,
    heightVariance: 0.7440271377563477,
    footprint: [
      { latitude: 40.7281237, longitude: -73.7951418 },
      { latitude: 40.728177, longitude: -73.7951519 },
      { latitude: 40.7281911, longitude: -73.7950225 },
      { latitude: 40.7281377, longitude: -73.7950125 },
    ],
  },
];

function pointInPolygon(location: LatLng, polygon: LatLng[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index];
    const prior = polygon[previous];
    if (
      (current.latitude > location.latitude) !== (prior.latitude > location.latitude)
      && location.longitude < (prior.longitude - current.longitude)
        * (location.latitude - current.latitude)
        / (prior.latitude - current.latitude)
        + current.longitude
    ) inside = !inside;
  }
  return inside;
}

export function findGbaDemoBuilding(location: LatLng) {
  return DEMO_BUILDINGS.find((building) => pointInPolygon(location, building.footprint)) ?? null;
}
