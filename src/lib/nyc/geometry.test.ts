import { describe, expect, it } from 'vitest';
import { buildNycModel, containsLocation, triangulateSurface, type CityBuilding, type Point3 } from './geometry';
import { parseCityBuilding } from './citygml';

describe('NYC CityGML geometry', () => {
  it('preserves courtyard holes during triangulation and building selection', () => {
    const rings: Point3[][] = [
      [[0,0,10],[10,0,10],[10,10,10],[0,10,10]],
      [[3,3,10],[3,7,10],[7,7,10],[7,3,10]],
    ];
    const indices = triangulateSurface(rings), vertices = rings.flat();
    let area = 0;
    for (let i=0; i<indices.length; i+=3) {
      const [a,b,c] = indices.slice(i,i+3).map((v) => vertices[v]);
      area += Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
    }
    expect(area).toBeCloseTo(84);
    const building = { surfaces: [{ type:'GroundSurface', rings }] } as CityBuilding;
    expect(containsLocation(building,1,1)).toBe(true);
    expect(containsLocation(building,5,5)).toBe(false);
    expect(containsLocation(building,11,1)).toBe(false);
  });

  it('triangulates a vertical wall without collapsing its area', () => {
    const rings: Point3[][] = [[[0,0,0],[10,0,0],[10,0,20],[0,0,20]]];
    const indices = triangulateSurface(rings);
    expect(indices).toHaveLength(6);
    let area = 0;
    for(let i=0;i<indices.length;i+=3) {
      const [a,b,c]=indices.slice(i,i+3).map(v=>rings[0][v]);
      area += Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))/2;
    }
    expect(area).toBe(200);
  });

  it('reads namespace-colliding bounds and retains a sloping source roof', () => {
    const xml = `<cityObjectMember><bldg:Building gml:id="test-id">
      <gml:boundedBy><gml:Envelope srsName="EPSG32118"><gml:lowerCorner>300000 60000 3</gml:lowerCorner><gml:upperCorner>300010 60010 18</gml:upperCorner></gml:Envelope></gml:boundedBy>
      <gen:stringAttribute name="building_identification_number"><gen:value>1000001</gen:value></gen:stringAttribute>
      <bldg:boundedBy><bldg:RoofSurface><bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList srsDimension="3">300000 60000 13 300010 60000 13 300010 60010 18 300000 60010 18 300000 60000 13</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface></bldg:RoofSurface></bldg:boundedBy>
    </bldg:Building></cityObjectMember>`;
    const building = parseCityBuilding(xml);
    expect(building.bin).toBe('1000001');
    expect(building.lower).toEqual([300000,60000,3]);
    const model = buildNycModel(building);
    expect(model.positions.filter((_,i)=>i%3===1)).toEqual([10,10,15,15]);
    expect(model.modelHeightMeters).toBe(15);
    expect(model.widthMeters).toBeCloseTo(10,0);
    expect(model.depthMeters).toBeCloseTo(10,0);
    expect(model.center.latitude).toBeGreaterThan(40);
    for(let i=0;i<model.indices.length;i+=3) {
      const [a,b,c]=model.indices.slice(i,i+3).map(v=>model.positions.slice(v*3,v*3+3));
      expect((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])).toBeGreaterThan(0);
    }
  });
});
