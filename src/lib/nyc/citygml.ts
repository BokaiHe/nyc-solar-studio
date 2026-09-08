import { XMLParser } from 'fast-xml-parser';
import type { CityBuilding, CitySurface, Point3 } from './geometry';

type XmlNode = Record<string, unknown>;
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });
const array = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const node = (value: unknown): XmlNode => value && typeof value === 'object' ? value as XmlNode : {};
const text = (value: unknown): string => typeof value === 'string' ? value : String(node(value)['#text'] ?? '');
function descendants(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value.flatMap((item) => descendants(item, key));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(node(value)).flatMap(([name, child]) => name === key ? array(child) : descendants(child, key));
}

function readRing(value: unknown): Point3[] {
  const values = text(node(value).posList).trim().split(/\s+/).map(Number);
  if (values.length < 9 || values.length % 3 || values.some((n) => !Number.isFinite(n))) throw new Error('Invalid CityGML ring');
  const points: Point3[] = [];
  for (let i = 0; i < values.length; i += 3) points.push([values[i], values[i+1], values[i+2]]);
  if (points[0].every((v, i) => v === points.at(-1)![i])) points.pop();
  return points;
}

export function parseCityBuilding(xml: string): CityBuilding {
  const building = node(node(parser.parse(xml).cityObjectMember).Building);
  const envelope = node(node(building.boundedBy).Envelope);
  const coords = (value: unknown): Point3 => text(value).trim().split(/\s+/).map(Number) as Point3;
  const attrs = Object.fromEntries(array(building.stringAttribute).map((item) => [String(node(item)['@_name']), text(node(item).value)]));
  const surfaces: CitySurface[] = [];
  for (const type of ['RoofSurface','WallSurface','GroundSurface','ClosureSurface','OuterFloorSurface','OuterCeilingSurface']) {
    for (const surface of descendants(building, type)) {
      for (const item of descendants(surface, 'Polygon')) {
        const polygon = node(item);
        const outer = node(polygon.exterior).LinearRing;
        if (!outer) continue;
        const rings = [readRing(outer), ...array(polygon.interior).map((hole) => readRing(node(hole).LinearRing))];
        surfaces.push({ type, rings });
      }
    }
  }
  // Removing XML namespace prefixes combines gml:boundedBy and bldg:boundedBy.
  const bounds = envelope.lowerCorner ? envelope : node(descendants(building.boundedBy, 'Envelope')[0]);
  return {
    id: String(building['@_id']), bin: attrs.building_identification_number || '',
    address: attrs.PLUTO_lot_address || '', geometrySource: attrs.geom_source || '',
    lower: coords(bounds.lowerCorner), upper: coords(bounds.upperCorner), surfaces,
  };
}
