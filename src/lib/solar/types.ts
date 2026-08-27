export type LatLng = {
  latitude: number;
  longitude: number;
};

export type LatLngAltitude = LatLng & {
  altitude: number;
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
  imageryDate: DateValue;
  imageryQuality: 'HIGH' | 'MEDIUM' | 'BASE';
  solarPotential: SolarPotential;
};

export type RenderPanel = {
  index: number;
  vertices: LatLngAltitude[];
  center: LatLng;
  segmentIndex: number;
  roofPitchDegrees: number;
  roofAzimuthDegrees: number;
  rotationOffsetDegrees: number;
  yearlyEnergyDcKwh: number;
};

export type PanelOverride = {
  center: LatLng;
  rotationOffsetDegrees: number;
};

export type SunSnapshot = {
  azimuthDegrees: number;
  altitudeDegrees: number;
  sunrise: Date;
  sunset: Date;
  daylight: boolean;
};

export type CameraState = {
  heading: number;
  tilt: number;
  range: number;
};
