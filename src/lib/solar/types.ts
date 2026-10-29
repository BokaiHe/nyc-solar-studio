export type LatLng = {
  latitude: number;
  longitude: number;
};

export type DateValue = {
  year: number;
  month: number;
  day: number;
};

export type SolarPanel = {
  center: LatLng;
  orientation: 'PORTRAIT' | 'LANDSCAPE';
  segmentIndex: number;
  yearlyEnergyDcKwh: number;
};

export type RoofSegmentStats = {
  center: LatLng;
  pitchDegrees: number;
  azimuthDegrees: number;
  planeHeightAtCenterMeters: number;
};

export type SolarPanelConfig = {
  panelsCount: number;
  yearlyEnergyDcKwh: number;
};

export type SolarPotential = {
  panelHeightMeters: number;
  panelWidthMeters: number;
  panelCapacityWatts: number;
  maxArrayPanelsCount: number;
  carbonOffsetFactorKgPerMwh: number;
  solarPanels: SolarPanel[];
  roofSegmentStats: RoofSegmentStats[];
  solarPanelConfigs: SolarPanelConfig[];
};

export type BuildingInsights = {
  name: string;
  center: LatLng;
  boundingBox?: { sw: LatLng; ne: LatLng };
  imageryDate: DateValue;
  imageryQuality: 'HIGH' | 'MEDIUM' | 'BASE';
  solarPotential: SolarPotential;
};

// A panel placed in the isolated 3D scene. Position is the panel center in
// model-local meters (x east, y up, z south); azimuth is the compass direction
// the panel faces. Rack panels stand on posts; flush panels lie on a pitched roof.
export type ConceptPanel = {
  id: number;
  position: [number, number, number];
  azimuthDegrees: number;
  tiltDegrees: number;
  landscape: boolean;
  mount: 'rack' | 'flush';
};

export type SunSnapshot = {
  azimuthDegrees: number;
  altitudeDegrees: number;
  sunrise: Date;
  sunset: Date;
  daylight: boolean;
};

export type RoofModelData = {
  positions: number[];
  indices: number[];
  wallPositions: number[];
  wallIndices: number[];
  widthMeters: number;
  depthMeters: number;
  baseElevationMeters: number;
  center: LatLng;
  buildingSource: 'NYC_TUM_LOD2';
  nycBuildingId?: string;
  nycBin?: string;
  modelHeightMeters?: number;
  modelAddress?: string;
  modelRelease?: string;
};

// Surrounding buildings that can shade the roof, in the target's scene frame.
// `buildingStarts` holds where each building's triangles begin in `indices`.
export type NeighborMesh = {
  positions: number[];
  indices: number[];
  buildingStarts: number[];
  buildingCount: number;
  radiusMeters: number;
};
