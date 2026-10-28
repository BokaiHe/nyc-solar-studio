import type { RoofModelData } from '@/lib/solar/types';

export type Vec3 = [number, number, number];

// A planar roof region: one or more CityGML roof surfaces that share a plane.
export type RoofFace = {
  triangles: Vec3[][];
  // Unit normal pointing up; plane is normal · p = offset.
  normal: Vec3;
  offset: number;
  slopeDegrees: number;
  // Compass direction the face slopes toward; meaningless on flat faces.
  azimuthDegrees: number;
  areaSquareMeters: number;
  // Outline edges projected to the ground (x, z), used to find the building axis.
  boundary: Array<[[number, number], [number, number]]>;
};

const MAX_ROOF_SLOPE_DEGREES = 70;
const SAME_PLANE_NORMAL_DOT = 0.996;
const SAME_PLANE_OFFSET_METERS = 0.25;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function facingAzimuth(normal: Vec3): number {
  // Scene x is east and z is south, so north is -z.
  return ((Math.atan2(normal[0], -normal[2]) * 180) / Math.PI + 360) % 360;
}

export function planeHeight(face: Pick<RoofFace, 'normal' | 'offset'>, x: number, z: number): number {
  const [nx, ny, nz] = face.normal;
  return (face.offset - nx * x - nz * z) / ny;
}

type Component = { triangles: number[]; normal: Vec3; area: number; centroid: Vec3 };

export function extractRoofFaces(model: Pick<RoofModelData, 'positions' | 'indices'>): RoofFace[] {
  const { positions, indices } = model;
  const vertex = (index: number): Vec3 => [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];

  // Triangles of one CityGML surface share vertex indices; union them.
  const parent = Array.from({ length: positions.length / 3 }, (_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) index = parent[index] = parent[parent[index]];
    return index;
  };
  for (let t = 0; t < indices.length; t += 3) {
    const root = find(indices[t]);
    parent[find(indices[t + 1])] = root;
    parent[find(indices[t + 2])] = root;
  }

  const components = new Map<number, Component>();
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [vertex(indices[t]), vertex(indices[t + 1]), vertex(indices[t + 2])];
    const n = cross(sub(b, a), sub(c, a));
    const doubleArea = Math.hypot(...n);
    if (doubleArea < 1e-6) continue;
    const sign = n[1] < 0 ? -1 : 1;
    const key = find(indices[t]);
    const component = components.get(key) ?? { triangles: [], normal: [0, 0, 0], area: 0, centroid: [0, 0, 0] };
    component.triangles.push(t);
    for (let axis = 0; axis < 3; axis += 1) {
      component.normal[axis] += (sign * n[axis]) / 2;
      component.centroid[axis] += ((a[axis] + b[axis] + c[axis]) / 3) * (doubleArea / 2);
    }
    component.area += doubleArea / 2;
    components.set(key, component);
  }

  // Merge surfaces lying in the same plane so split flat roofs fill as one.
  const groups: Array<{ normal: Vec3; offset: number; members: Component[] }> = [];
  for (const component of components.values()) {
    const length = Math.hypot(...component.normal);
    const normal: Vec3 = [component.normal[0] / length, component.normal[1] / length, component.normal[2] / length];
    const centroid: Vec3 = [component.centroid[0] / component.area, component.centroid[1] / component.area, component.centroid[2] / component.area];
    const offset = dot(normal, centroid);
    const group = groups.find((candidate) =>
      dot(candidate.normal, normal) > SAME_PLANE_NORMAL_DOT
      && Math.abs(candidate.offset - offset) < SAME_PLANE_OFFSET_METERS);
    if (group) group.members.push(component);
    else groups.push({ normal, offset, members: [component] });
  }

  return groups.flatMap((group) => {
    const area = group.members.reduce((sum, member) => sum + member.area, 0);
    const normal = group.members.reduce<Vec3>((sum, member) => [
      sum[0] + member.normal[0], sum[1] + member.normal[1], sum[2] + member.normal[2],
    ], [0, 0, 0]);
    const length = Math.hypot(...normal);
    const unit: Vec3 = [normal[0] / length, normal[1] / length, normal[2] / length];
    const slopeDegrees = (Math.acos(Math.min(1, unit[1])) * 180) / Math.PI;
    if (slopeDegrees > MAX_ROOF_SLOPE_DEGREES) return [];
    const centroid = group.members.reduce<Vec3>((sum, member) => [
      sum[0] + member.centroid[0], sum[1] + member.centroid[1], sum[2] + member.centroid[2],
    ], [0, 0, 0]).map((value) => value / area) as Vec3;

    const triangles: Vec3[][] = [];
    const edgeUse = new Map<string, { count: number; edge: [[number, number], [number, number]] }>();
    for (const member of group.members) {
      for (const t of member.triangles) {
        const ids = [indices[t], indices[t + 1], indices[t + 2]];
        triangles.push(ids.map(vertex));
        for (let corner = 0; corner < 3; corner += 1) {
          const from = ids[corner];
          const to = ids[(corner + 1) % 3];
          const key = from < to ? `${from}:${to}` : `${to}:${from}`;
          const [fx, , fz] = vertex(from);
          const [tx, , tz] = vertex(to);
          const entry = edgeUse.get(key) ?? { count: 0, edge: [[fx, fz], [tx, tz]] };
          entry.count += 1;
          edgeUse.set(key, entry);
        }
      }
    }
    const boundary = [...edgeUse.values()].filter((entry) => entry.count === 1).map((entry) => entry.edge);
    return [{
      triangles,
      normal: unit,
      offset: dot(unit, centroid),
      slopeDegrees,
      azimuthDegrees: facingAzimuth(unit),
      areaSquareMeters: area,
      boundary,
    }];
  });
}

// The building's dominant edge direction in degrees within [0, 90): outline
// edge angles folded to a quarter turn, weighted by length.
export function dominantAxisDegrees(faces: RoofFace[]): number {
  const bins = new Array<number>(90).fill(0);
  for (const face of faces) {
    for (const [[ax, az], [bx, bz]] of face.boundary) {
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 0.5) continue;
      const angle = ((((Math.atan2(bz - az, bx - ax) * 180) / Math.PI) % 90) + 90) % 90;
      bins[Math.floor(angle) % 90] += length;
    }
  }
  let best = 0;
  let bestWeight = -1;
  for (let bin = 0; bin < 90; bin += 1) {
    let weight = 0;
    for (let offset = -2; offset <= 2; offset += 1) weight += bins[(bin + offset + 90) % 90];
    if (weight > bestWeight) {
      bestWeight = weight;
      best = bin;
    }
  }
  // Refine with the length-weighted mean of edges near the winning bin; a 1°
  // error drifts over a metre across a large roof.
  let sum = 0;
  let total = 0;
  for (const face of faces) {
    for (const [[ax, az], [bx, bz]] of face.boundary) {
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 0.5) continue;
      const angle = ((((Math.atan2(bz - az, bx - ax) * 180) / Math.PI) % 90) + 90) % 90;
      let delta = angle - (best + 0.5);
      if (delta > 45) delta -= 90;
      if (delta < -45) delta += 90;
      if (Math.abs(delta) > 3) continue;
      sum += delta * length;
      total += length;
    }
  }
  return (((best + 0.5 + (total ? sum / total : 0)) % 90) + 90) % 90;
}
