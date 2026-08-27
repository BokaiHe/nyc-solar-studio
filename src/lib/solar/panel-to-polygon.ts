import type {
  LatLng,
  LatLngAltitude,
  RenderPanel,
  RoofSegmentStats,
  SolarPanel,
} from './types';

const EARTH_RADIUS_METERS = 6_378_137;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export type PanelDimensions = { widthM: number; heightM: number };
export type PositioningMode = 'RELATIVE_TO_MESH' | 'ABSOLUTE';

type LocalPoint = { eastM: number; northM: number };
type LocalVector3 = { east: number; north: number; up: number };

function localMetersToLatLng(origin: LatLng, point: LocalPoint): LatLng {
  const latitudeRadians = origin.latitude * DEG_TO_RAD;
  return {
    latitude: origin.latitude + (point.northM / EARTH_RADIUS_METERS) * RAD_TO_DEG,
    longitude:
      origin.longitude +
      (point.eastM / (EARTH_RADIUS_METERS * Math.cos(latitudeRadians))) * RAD_TO_DEG,
  };
}

function latLngToLocalMeters(origin: LatLng, point: LatLng): LocalPoint {
  const latitudeRadians = origin.latitude * DEG_TO_RAD;
  return {
    eastM:
      (point.longitude - origin.longitude) * DEG_TO_RAD * EARTH_RADIUS_METERS *
      Math.cos(latitudeRadians),
    northM: (point.latitude - origin.latitude) * DEG_TO_RAD * EARTH_RADIUS_METERS,
  };
}

function rotateOnRoof(
  downhill: LocalVector3,
  crossSlope: LocalVector3,
  angleRadians: number,
): [LocalVector3, LocalVector3] {
  const cosine = Math.cos(angleRadians);
  const sine = Math.sin(angleRadians);
  return [
    {
      east: downhill.east * cosine + crossSlope.east * sine,
      north: downhill.north * cosine + crossSlope.north * sine,
      up: downhill.up * cosine + crossSlope.up * sine,
    },
    {
      east: -downhill.east * sine + crossSlope.east * cosine,
      north: -downhill.north * sine + crossSlope.north * cosine,
      up: -downhill.up * sine + crossSlope.up * cosine,
    },
  ];
}

/** Builds a dimensionally correct panel rectangle in the roof plane. */
export function panelToPolygon(
  panel: SolarPanel,
  segment: RoofSegmentStats,
  dimensions: PanelDimensions,
  mode: PositioningMode,
  index = 0,
  surfaceOffsetM = 0.08,
  rotationOffsetDegrees = 0,
): RenderPanel {
  const pitch = segment.pitchDegrees * DEG_TO_RAD;
  const azimuth = segment.azimuthDegrees * DEG_TO_RAD;
  const downhill: LocalVector3 = {
    east: Math.cos(pitch) * Math.sin(azimuth),
    north: Math.cos(pitch) * Math.cos(azimuth),
    up: -Math.sin(pitch),
  };
  const crossSlope: LocalVector3 = {
    east: Math.cos(azimuth),
    north: -Math.sin(azimuth),
    up: 0,
  };
  const baseRotation = panel.orientation === 'PORTRAIT' ? 0 : 90;
  const [longAxis, shortAxis] = rotateOnRoof(
    downhill,
    crossSlope,
    (baseRotation + rotationOffsetDegrees) * DEG_TO_RAD,
  );

  const centerFromSegment = latLngToLocalMeters(segment.center, panel.center);
  const centerDownhillM =
    centerFromSegment.eastM * Math.sin(azimuth) +
    centerFromSegment.northM * Math.cos(azimuth);
  const centerAltitudeM =
    segment.planeHeightAtCenterMeters - centerDownhillM * Math.tan(pitch);
  const signs: Array<[number, number]> = [
    [-1, -1],
    [-1, 1],
    [1, 1],
    [1, -1],
  ];

  const vertices: LatLngAltitude[] = signs.map(([longSign, shortSign]) => {
    const longDistance = longSign * dimensions.heightM * 0.5;
    const shortDistance = shortSign * dimensions.widthM * 0.5;
    const eastM = longAxis.east * longDistance + shortAxis.east * shortDistance;
    const northM = longAxis.north * longDistance + shortAxis.north * shortDistance;
    const upM = longAxis.up * longDistance + shortAxis.up * shortDistance;
    const location = localMetersToLatLng(panel.center, { eastM, northM });
    return {
      ...location,
      altitude: mode === 'ABSOLUTE' ? centerAltitudeM + upM + surfaceOffsetM : surfaceOffsetM,
    };
  });

  return {
    index,
    vertices,
    center: panel.center,
    segmentIndex: panel.segmentIndex,
    roofPitchDegrees: segment.pitchDegrees,
    roofAzimuthDegrees: segment.azimuthDegrees,
    rotationOffsetDegrees,
    yearlyEnergyDcKwh: panel.yearlyEnergyDcKwh,
  };
}
