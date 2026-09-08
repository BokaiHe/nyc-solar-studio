import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { inflateSync } from 'node:zlib';
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, DoubleSide, Raycaster, Vector3 } from 'three';
import { parseCityBuilding } from './citygml';
import { buildNycModel, containsLocation, projectLocation } from './geometry';

describe.skipIf(!process.env.NYC_TEST_DB)('official NYC archive integration', () => {
  it('loads source geometry and reports exact containment for representative locations', () => {
    const db = new DatabaseSync(process.env.NYC_TEST_DB!, {readOnly:true});
    const query = db.prepare('SELECT b.xml FROM bounds r JOIN buildings b ON r.id=b.id WHERE min_x<=? AND max_x>=? AND min_y<=? AND max_y>=?');
    const samples = [
      {name:'Queens demo', latitude:40.7281616,longitude:-73.7951012},
      {name:'Flatiron',latitude:40.74106,longitude:-73.98970},
      {name:'One WTC',latitude:40.71300,longitude:-74.01318},
      {name:'Empire State',latitude:40.74844,longitude:-73.98566},
    ];
    let matched=0;
    for(const sample of samples) {
      const [x,y]=projectLocation(sample);
      const candidates=query.all(x,x,y,y) as {xml:Uint8Array}[];
      const building=candidates.map(r=>parseCityBuilding(inflateSync(r.xml).toString('utf8'))).find(b=>containsLocation(b,x,y));
      if(!building) { console.log(sample.name, 'NO EXACT MODEL MATCH'); continue; }
      const model=buildNycModel(building);
      expect(model.positions.every(Number.isFinite)).toBe(true);
      expect(model.indices.length).toBeGreaterThan(0);
      expect(Math.max(...model.indices)).toBeLessThan(model.positions.length/3);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position',new Float32BufferAttribute(model.positions,3));
      geometry.setIndex(model.indices);
      const material = new MeshBasicMaterial({side:DoubleSide});
      const mesh = new Mesh(geometry,material);
      mesh.updateMatrixWorld(true);
      const vertices=model.indices.slice(0,3).map(i=>new Vector3().fromArray(model.positions,i*3));
      const center=vertices.reduce((sum,v)=>sum.add(v),new Vector3()).divideScalar(3);
      const ray=new Raycaster(new Vector3(center.x,(model.modelHeightMeters ?? 1000)+10,center.z),new Vector3(0,-1,0));
      expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);
      geometry.dispose(); material.dispose();
      console.log(sample.name, {bin:building.bin,id:building.id,height:model.modelHeightMeters,roofs:building.surfaces.filter(s=>s.type==='RoofSurface').length,triangles:model.indices.length/3});
      matched++;
    }
    db.close();
    expect(matched).toBeGreaterThanOrEqual(3);
  });
});
