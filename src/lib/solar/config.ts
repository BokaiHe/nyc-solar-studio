// Editable UI default. Replace after final Con Edison tariff verification.
export const DEFAULT_ELECTRICITY_RATE_USD_PER_KWH = 0.338;

// 2020 EIA RECS, New York, most-used refrigerator: 542 kWh/year.
export const REFRIGERATOR_KWH_PER_YEAR = 542;

export const NYC_SEARCH_BOUNDS = {
  north: 40.9176,
  south: 40.4774,
  east: -73.7004,
  west: -74.2591,
} as const;

export const DEMO_BUILDINGS = [
  {
    id: 'staten-island',
    borough: 'Staten Island',
    latitude: 40.5795,
    longitude: -74.1502,
  },
  {
    id: 'queens',
    borough: 'Queens',
    latitude: 40.7282,
    longitude: -73.7949,
  },
  {
    id: 'brooklyn',
    borough: 'Brooklyn',
    latitude: 40.6214,
    longitude: -73.9566,
  },
  {
    id: 'bronx',
    borough: 'Bronx',
    latitude: 40.8546,
    longitude: -73.8661,
  },
  {
    id: 'manhattan',
    borough: 'Manhattan',
    latitude: 40.7837,
    longitude: -73.9792,
  },
] as const;

export type DemoBuilding = (typeof DEMO_BUILDINGS)[number];
