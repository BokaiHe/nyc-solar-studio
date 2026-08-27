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

function localMetersToLatLng(origin: LatLng, point: LocalPoint): LatLng {
  const latitudeRadians = origin.latitude * DEG_TO_RAD;
  return {
    latitude:
      origin.latitude + (point.northM / EARTH_RADIUS_METERS) * RAD_TO_DEG,
    longitude:
      origin.longitude +
      (point.eastM / (EARTH_RADIUS_METERS * Math.cos(latitudeRadians))) *
        RAD_TO_DEG,
  };
}

function latLngToLocalMeters(origin: LatLng, point: LatLng): LocalPoint {
  const latitudeRadians = origin.latitude * DEG_TO_RAD;
  return {
    eastM:
      (point.longitude - origin.longitude) *
      DEG_TO_RAD *
      EARTH_RADIUS_METERS *
      Math.cos(latitudeRadians),
    northM:
      (point.latitude - origin.latitude) * DEG_TO_RAD * EARTH_RADIUS_METERS,
  };
}

/**
 * Builds a panel rectangle on its roof plane.
 *
 * Roof azimuth is treated as the downhill direction. PORTRAIT provisionally
 * maps the panel height to that direction; the five-building visual gate will
 * verify this convention against Google's candidate layout.
 */
export function panelToPolygon(
  panel: SolarPanel,
  segment: RoofSegmentStats,
  dimensions: PanelDimensions,
  mode: PositioningMode,
  index = 0,
  surfaceOffsetM = 0.08,
): RenderPanel {
  const pitch = segment.pitchDegrees * DEG_TO_RAD;
  const azimuth = segment.azimuthDegrees * DEG_TO_RAD;
  const alongSlopeM =
    panel.orientation === 'PORTRAIT' ? dimensions.heightM : dimensions.widthM;
  const crossSlopeM =
    panel.orientation === 'PORTRAIT' ? dimensions.widthM : dimensions.heightM;
  const halfDownhillProjectionM = (alongSlopeM * Math.cos(pitch)) / 2;
  const halfCrossSlopeM = crossSlopeM / 2;

  const downhill = { east: Math.sin(azimuth), north: Math.cos(azimuth) };
  const crossSlope = { east: Math.cos(azimuth), north: -Math.sin(azimuth) };

  const centerFromSegment = latLngToLocalMeters(segment.center, panel.center);
  const centerDownhillM =
    centerFromSegment.eastM * downhill.east +
    centerFromSegment.northM * downhill.north;
  const centerAltitudeM =
    segment.planeHeightAtCenterMeters - centerDownhillM * Math.tan(pitch);

  const signs: Array<[number, number]> = [
    [-1, -1],
    [-1, 1],
    [1, 1],
    [1, -1],
  ];

  const vertices: LatLngAltitude[] = signs.map(([downSign, crossSign]) => {
    const downM = downSign * halfDownhillProjectionM;
    const crossM = crossSign * halfCrossSlopeM;
    const location = localMetersToLatLng(panel.center, {
      eastM: downM * downhill.east + crossM * crossSlope.east,
      northM: downM * downhill.north + crossM * crossSlope.north,
    });
    const altitude =
      mode === 'ABSOLUTE'
        ? centerAltitudeM - downM * Math.tan(pitch) + surfaceOffsetM
        : surfaceOffsetM;
    return { ...location, altitude };
  });

  return { index, vertices, yearlyEnergyDcKwh: panel.yearlyEnergyDcKwh };
}
