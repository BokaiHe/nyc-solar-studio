import type { LatLng } from '@/lib/solar/types';
import { COVERAGE } from './coverage';

export const STUDY_AREA_RINGS = COVERAGE.rings;
export const STUDY_AREA_BUILDINGS = COVERAGE.buildingCount;

// Even-odd point-in-polygon over the study-area rings ([lng, lat] points).
export function insideStudyArea({ latitude, longitude }: LatLng): boolean {
  return STUDY_AREA_RINGS.some((ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > latitude) !== (yj > latitude) && longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}
