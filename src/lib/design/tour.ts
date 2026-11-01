import type { Vec3 } from './roof-faces';

// The guided tour's example: P.S. 321 in Park Slope, a four-story school
// with a flat roof and three stair bulkheads, low enough that the aerial
// imagery shows it without lean.
export const TOUR_BUILDING = {
  id: 'gml_5Z9WY8RP9M3BRLR7D3VW8LXSS90AH9B7GIXM',
  location: { latitude: 40.671682, longitude: -73.978344 },
};

// Its bulkheads, traced on the 2014 imagery in the scene frame (meters east
// and south of the model center) at the 11.05 m roof.
const ROOF = 11.05;
export const TOUR_ZONES: Vec3[][] = [
  [[-7.0, ROOF, -36.8], [-1.5, ROOF, -33.8], [-4.0, ROOF, -28.0], [-8.8, ROOF, -30.8]],
  [[-31.5, ROOF, 3.8], [-27.5, ROOF, 6.0], [-30.2, ROOF, 11.8], [-34.2, ROOF, 9.4]],
  [[-0.2, ROOF, 23.8], [3.8, ROOF, 26.0], [1.0, ROOF, 31.8], [-3.0, ROOF, 29.5]],
];

// Set once the tour has been offered, so it opens by itself only on a first visit.
export const TOUR_SEEN_KEY = 'nyc-solar-tour-seen';

export type TourStepId = 'welcome' | 'search' | 'building' | 'design' | 'zones' | 'generate' | 'sun' | 'optimize' | 'results' | 'done';

// `target` names a `data-tour` element to spotlight; 'scene' steps leave the
// roof undimmed and put the card beside it.
export const TOUR_STEPS: Array<{ id: TourStepId; target: string | null }> = [
  { id: 'welcome', target: null },
  { id: 'search', target: 'search' },
  { id: 'building', target: 'panel' },
  { id: 'design', target: 'toolbar' },
  { id: 'zones', target: 'scene' },
  { id: 'generate', target: 'scene' },
  { id: 'sun', target: 'sun' },
  { id: 'optimize', target: 'optimizer' },
  { id: 'results', target: 'panel' },
  { id: 'done', target: null },
];
