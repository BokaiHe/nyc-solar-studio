import type { CityBuilding, Point3 } from './geometry';

// NYC buildings as static files on a latitude/longitude grid, so the app can
// run without a server: `m/{key}.bin.gz` holds the 3D models of buildings
// whose bounds center falls in a cell, `f/{key}.bin.gz` their map outlines.
// Built by scripts/build-static-tiles.mts.

export const TILE_LNG_DEGREES = 0.003;
export const TILE_LAT_DEGREES = 0.0025;

export const tileIndex = (longitude: number, latitude: number): [number, number] =>
  [Math.floor(longitude / TILE_LNG_DEGREES), Math.floor(latitude / TILE_LAT_DEGREES)];
export const tileKey = (column: number, row: number) => `${column}_${row}`;

// Surface types in the order of their one-byte codes.
const SURFACE_TYPES = ['RoofSurface', 'WallSurface', 'GroundSurface', 'ClosureSurface', 'OuterFloorSurface', 'OuterCeilingSurface'];
const MODEL_MAGIC = 0x4d43594e; // 'NYCM'
const OUTLINE_MAGIC = 0x4f43594e; // 'NYCO'

class Writer {
  private bytes = new Uint8Array(1 << 16);
  private view = new DataView(this.bytes.buffer);
  length = 0;

  private reserve(size: number) {
    if (this.length + size <= this.bytes.length) return;
    let capacity = this.bytes.length * 2;
    while (capacity < this.length + size) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(this.bytes.subarray(0, this.length));
    this.bytes = grown;
    this.view = new DataView(grown.buffer);
  }

  u8(value: number) { this.reserve(1); this.view.setUint8(this.length, value); this.length += 1; }
  u16(value: number) { this.reserve(2); this.view.setUint16(this.length, value, true); this.length += 2; }
  u32(value: number) { this.reserve(4); this.view.setUint32(this.length, value, true); this.length += 4; }
  i32(value: number) { this.reserve(4); this.view.setInt32(this.length, value, true); this.length += 4; }
  f32(value: number) { this.reserve(4); this.view.setFloat32(this.length, value, true); this.length += 4; }

  // Up to 255 bytes of UTF-8.
  text(value: string) {
    let encoded = new TextEncoder().encode(value);
    if (encoded.length > 255) encoded = encoded.subarray(0, 255);
    this.u8(encoded.length);
    this.reserve(encoded.length);
    this.bytes.set(encoded, this.length);
    this.length += encoded.length;
  }

  result() { return this.bytes.slice(0, this.length); }
}

// Plain fields (no parameter properties) so the build script runs on Node's type stripping.
class Reader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private offset = 0;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8() { const value = this.view.getUint8(this.offset); this.offset += 1; return value; }
  u16() { const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
  u32() { const value = this.view.getUint32(this.offset, true); this.offset += 4; return value; }
  i32() { const value = this.view.getInt32(this.offset, true); this.offset += 4; return value; }
  f32() { const value = this.view.getFloat32(this.offset, true); this.offset += 4; return value; }
  text() {
    const length = this.u8();
    const value = new TextDecoder().decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }
}

const cm = (meters: number) => Math.round(meters * 100);

// Models keep the CityGML coordinates (NYC state plane, meters): each point is
// stored as unsigned offsets from the building's minimum corner in units of
// 2^shift centimeters, small enough to fit 16 bits.
export function encodeModelTile(buildings: CityBuilding[]): Uint8Array {
  const out = new Writer();
  out.u32(MODEL_MAGIC);
  out.u32(buildings.length);
  for (const building of buildings) {
    out.text(building.id);
    out.text(building.bin);
    out.text(building.address);
    out.text(building.geometrySource);
    const origin = [Infinity, Infinity, Infinity];
    const top = [-Infinity, -Infinity, -Infinity];
    for (const surface of building.surfaces) {
      for (const ring of surface.rings) {
        for (const point of ring) {
          for (let axis = 0; axis < 3; axis += 1) {
            origin[axis] = Math.min(origin[axis], cm(point[axis]));
            top[axis] = Math.max(top[axis], cm(point[axis]));
          }
        }
      }
    }
    const span = Math.max(1, top[0] - origin[0], top[1] - origin[1], top[2] - origin[2]);
    let shift = 0;
    while (span >> shift > 0xffff) shift += 1;
    for (const value of [...building.lower, ...building.upper]) out.i32(cm(value));
    for (const value of origin) out.i32(value);
    out.u8(shift);
    out.u16(building.surfaces.length);
    for (const surface of building.surfaces) {
      out.u8(Math.max(0, SURFACE_TYPES.indexOf(surface.type)));
      out.u8(surface.rings.length);
      for (const ring of surface.rings) {
        out.u16(ring.length);
        for (const point of ring) for (let axis = 0; axis < 3; axis += 1) out.u16((cm(point[axis]) - origin[axis]) >> shift);
      }
    }
  }
  return out.result();
}

export function decodeModelTile(bytes: Uint8Array): CityBuilding[] {
  const input = new Reader(bytes);
  if (input.u32() !== MODEL_MAGIC) throw new Error('Not a model tile');
  const buildings: CityBuilding[] = [];
  for (let count = input.u32(); count > 0; count -= 1) {
    const id = input.text();
    const bin = input.text();
    const address = input.text();
    const geometrySource = input.text();
    const corners = Array.from({ length: 6 }, () => input.i32() / 100);
    const origin = [input.i32(), input.i32(), input.i32()];
    const unit = 2 ** input.u8();
    const surfaces: CityBuilding['surfaces'] = [];
    for (let surfaceCount = input.u16(); surfaceCount > 0; surfaceCount -= 1) {
      const type = SURFACE_TYPES[input.u8()] ?? 'WallSurface';
      const rings: Point3[][] = [];
      for (let ringCount = input.u8(); ringCount > 0; ringCount -= 1) {
        const ring: Point3[] = [];
        for (let pointCount = input.u16(); pointCount > 0; pointCount -= 1) {
          ring.push([
            (origin[0] + input.u16() * unit) / 100,
            (origin[1] + input.u16() * unit) / 100,
            (origin[2] + input.u16() * unit) / 100,
          ]);
        }
        rings.push(ring);
      }
      surfaces.push({ type, rings });
    }
    buildings.push({
      id, bin, address, geometrySource,
      lower: corners.slice(0, 3) as Point3,
      upper: corners.slice(3) as Point3,
      surfaces,
    });
  }
  return buildings;
}

export type Outline = {
  id: string;
  height: number | null;
  address: string | null;
  // Rings as flat [lng, lat, lng, lat, …] arrays.
  rings: number[][];
};

// Outlines in WGS84 at 1e-7 degrees (about 1 cm): the first point of each ring
// absolute, the rest as 32-bit deltas.
export function encodeOutlineTile(outlines: Outline[]): Uint8Array {
  const out = new Writer();
  out.u32(OUTLINE_MAGIC);
  out.u32(outlines.length);
  for (const outline of outlines) {
    out.text(outline.id);
    out.text(outline.address ?? '');
    out.f32(outline.height ?? -1);
    out.u16(outline.rings.length);
    for (const ring of outline.rings) {
      out.u16(ring.length / 2);
      let previous = [0, 0];
      for (let index = 0; index < ring.length; index += 2) {
        const point = [Math.round(ring[index] * 1e7), Math.round(ring[index + 1] * 1e7)];
        out.i32(point[0] - previous[0]);
        out.i32(point[1] - previous[1]);
        previous = point;
      }
    }
  }
  return out.result();
}

export function decodeOutlineTile(bytes: Uint8Array): Outline[] {
  const input = new Reader(bytes);
  if (input.u32() !== OUTLINE_MAGIC) throw new Error('Not an outline tile');
  const outlines: Outline[] = [];
  for (let count = input.u32(); count > 0; count -= 1) {
    const id = input.text();
    const address = input.text() || null;
    const height = input.f32();
    const rings: number[][] = [];
    for (let ringCount = input.u16(); ringCount > 0; ringCount -= 1) {
      const flat: number[] = [];
      let x = 0, y = 0;
      for (let pointCount = input.u16(); pointCount > 0; pointCount -= 1) {
        x += input.i32();
        y += input.i32();
        flat.push(x / 1e7, y / 1e7);
      }
      rings.push(flat);
    }
    outlines.push({ id, address, height: height < 0 ? null : Math.round(height * 10) / 10, rings });
  }
  return outlines;
}
