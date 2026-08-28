'use client';

import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { Grid, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { RoofModelData, SunSnapshot } from '@/lib/solar/types';

type PlacedPanel = {
  id: number;
  position: [number, number, number];
  rotationY: number;
  tiltDegrees: number;
};

type RoofDesigner3DProps = {
  model: RoofModelData;
  panelWidthMeters: number;
  panelHeightMeters: number;
  sun: SunSnapshot | null;
  onPanelCountChange?: (count: number) => void;
};

function RoofScene({ model, panelWidthMeters, panelHeightMeters, sun, panels, selectedId, onRoofClick, onRoofMove, onRoofRelease, onSelectPanel, onStartDrag, onReady, roofRef }: RoofDesigner3DProps & {
  panels: PlacedPanel[];
  selectedId: number | null;
  onRoofClick: (event: ThreeEvent<MouseEvent>) => void;
  onRoofMove: (event: ThreeEvent<PointerEvent>) => void;
  onRoofRelease: () => void;
  onSelectPanel: (id: number) => void;
  onStartDrag: (id: number) => void;
  onReady: () => void;
  roofRef: React.RefObject<THREE.Mesh | null>;
}) {
  const geometry = useMemo(() => {
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(model.positions, 3));
    result.setIndex(model.indices);
    result.computeVertexNormals();
    result.computeBoundingSphere();
    return result;
  }, [model.indices, model.positions]);
  const wallGeometry = useMemo(() => {
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(model.wallPositions, 3));
    result.setIndex(model.wallIndices);
    result.computeVertexNormals();
    return result;
  }, [model.wallIndices, model.wallPositions]);
  const deckGeometry = useMemo(() => {
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(model.deckPositions, 3));
    result.setIndex(model.deckIndices);
    result.computeVertexNormals();
    return result;
  }, [model.deckIndices, model.deckPositions]);
  useEffect(() => () => { geometry.dispose(); wallGeometry.dispose(); deckGeometry.dispose(); }, [deckGeometry, geometry, wallGeometry]);
  const maxDimension = Math.max(model.widthMeters, model.depthMeters);
  useEffect(() => onReady(), [onReady]);
  const roofTop = useMemo(() => {
    let top = 0;
    for (let index = 1; index < model.positions.length; index += 3) top = Math.max(top, model.positions[index]);
    return top;
  }, [model.positions]);
  const altitude = sun ? THREE.MathUtils.degToRad(Math.max(-5, sun.altitudeDegrees)) : Math.PI / 4;
  const azimuth = sun ? THREE.MathUtils.degToRad(sun.azimuthDegrees) : Math.PI;
  const lightPosition: [number, number, number] = [
    Math.sin(azimuth) * Math.cos(altitude) * maxDimension,
    Math.max(8, Math.sin(altitude) * maxDimension),
    -Math.cos(azimuth) * Math.cos(altitude) * maxDimension,
  ];
  return (
    <>
      <color attach="background" args={['#e8edf3']} />
      <ambientLight intensity={0.85} />
      <directionalLight position={lightPosition} intensity={sun?.daylight ? 2.1 : 0.25} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-maxDimension} shadow-camera-right={maxDimension} shadow-camera-top={maxDimension} shadow-camera-bottom={-maxDimension} />
      <PerspectiveCamera makeDefault position={[maxDimension * 0.9, maxDimension * 0.8, maxDimension * 1.05]} fov={40} near={0.1} far={maxDimension * 8} />
      <OrbitControls makeDefault target={[0, roofTop * 0.5, 0]} minDistance={maxDimension * 0.25} maxDistance={maxDimension * 2.5} maxPolarAngle={Math.PI * 0.49} />
      <mesh ref={roofRef} geometry={geometry} castShadow receiveShadow onClick={onRoofClick} onPointerMove={onRoofMove} onPointerUp={onRoofRelease}>
        <meshStandardMaterial color="#e2e8f0" roughness={0.78} metalness={0.02} side={THREE.DoubleSide} flatShading />
      </mesh>
      <mesh geometry={wallGeometry} castShadow receiveShadow>
        <meshStandardMaterial color="#a8b2bf" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={deckGeometry} receiveShadow>
        <meshStandardMaterial color="#cbd5e1" roughness={0.86} side={THREE.DoubleSide} />
      </mesh>
      {panels.map((panel) => (
        <mesh key={panel.id} position={panel.position} rotation={[THREE.MathUtils.degToRad(panel.tiltDegrees), panel.rotationY, 0]} castShadow receiveShadow onClick={(event) => { event.stopPropagation(); onSelectPanel(panel.id); }} onPointerDown={(event) => { event.stopPropagation(); onStartDrag(panel.id); }}>
          <boxGeometry args={[panelWidthMeters, 0.09, panelHeightMeters]} />
          <meshStandardMaterial color={selectedId === panel.id ? '#38bdf8' : '#075985'} metalness={0.45} roughness={0.35} />
        </mesh>
      ))}
      <Grid args={[maxDimension * 1.8, maxDimension * 1.8]} position={[0, 0, 0]} cellSize={1} cellThickness={0.4} cellColor="#94a3b8" sectionSize={5} sectionThickness={0.8} sectionColor="#64748b" fadeDistance={maxDimension * 1.5} infiniteGrid />
    </>
  );
}

export function RoofDesigner3D({ model, panelWidthMeters, panelHeightMeters, sun, onPanelCountChange }: RoofDesigner3DProps) {
  const [panels, setPanels] = useState<PlacedPanel[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [tiltDegrees, setTiltDegrees] = useState(10);
  const [orientationDegrees, setOrientationDegrees] = useState(180);
  const [setbackMeters, setSetbackMeters] = useState(1.2);
  const [rowSpacingMeters, setRowSpacingMeters] = useState(0.8);
  const [sceneReady, setSceneReady] = useState(false);
  const nextIdRef = useRef(1);
  const didAutoLayoutRef = useRef(false);
  const roofRef = useRef<THREE.Mesh | null>(null);

  useEffect(() => onPanelCountChange?.(panels.length), [onPanelCountChange, panels.length]);

  const addPanel = useCallback((point: THREE.Vector3) => {
    setPanels((current) => {
      if (current.some((panel) => Math.hypot(panel.position[0] - point.x, panel.position[2] - point.z) < panelWidthMeters * 0.7)) return current;
      return [...current, {
        id: nextIdRef.current++,
        position: [point.x, point.y + 0.16, point.z],
        rotationY: THREE.MathUtils.degToRad(orientationDegrees),
        tiltDegrees,
      }];
    });
  }, [orientationDegrees, panelWidthMeters, tiltDegrees]);

  const autoLayout = useCallback(() => {
    const roof = roofRef.current;
    if (!roof) return;
    roof.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    const generated: PlacedPanel[] = [];
    const margin = setbackMeters;
    const stepX = panelWidthMeters + 0.22;
    const stepZ = panelHeightMeters + rowSpacingMeters;
    const rotation = THREE.MathUtils.degToRad(orientationDegrees);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const sampleRoof = (x: number, z: number) => {
      const sampleOffsets: Array<[number, number]> = [
        [0, 0],
        [-panelWidthMeters * 0.44, -panelHeightMeters * 0.44],
        [panelWidthMeters * 0.44, -panelHeightMeters * 0.44],
        [-panelWidthMeters * 0.44, panelHeightMeters * 0.44],
        [panelWidthMeters * 0.44, panelHeightMeters * 0.44],
      ];
      const heights: number[] = [];
      for (const [localX, localZ] of sampleOffsets) {
        const sampleX = x + localX * cos + localZ * sin;
        const sampleZ = z - localX * sin + localZ * cos;
        raycaster.set(new THREE.Vector3(sampleX, 1000, sampleZ), new THREE.Vector3(0, -1, 0));
        const hit = raycaster.intersectObject(roof, false)[0];
        if (!hit) return null;
        heights.push(hit.point.y);
      }
      if (Math.max(...heights) - Math.min(...heights) > 1.25) return null;
      return Math.max(...heights) + 0.22;
    };
    for (let z = -model.depthMeters / 2 + margin; z <= model.depthMeters / 2 - margin; z += stepZ) {
      for (let x = -model.widthMeters / 2 + margin; x <= model.widthMeters / 2 - margin; x += stepX) {
        const height = sampleRoof(x, z);
        if (height === null) continue;
        generated.push({
          id: nextIdRef.current++,
          position: [x, height, z],
          rotationY: rotation,
          tiltDegrees,
        });
        if (generated.length >= 320) break;
      }
      if (generated.length >= 320) break;
    }
    setPanels(generated);
    setSelectedId(null);
  }, [model.depthMeters, model.widthMeters, orientationDegrees, panelHeightMeters, panelWidthMeters, rowSpacingMeters, setbackMeters, tiltDegrees]);

  useEffect(() => {
    if (!sceneReady || didAutoLayoutRef.current) return;
    const timeout = window.setTimeout(() => {
      if (!roofRef.current) return;
      didAutoLayoutRef.current = true;
      autoLayout();
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [autoLayout, sceneReady]);

  const updateSelected = useCallback((patch: Partial<PlacedPanel>) => {
    if (selectedId === null) return;
    setPanels((current) => current.map((panel) => panel.id === selectedId ? { ...panel, ...patch } : panel));
  }, [selectedId]);

  const deleteSelected = useCallback(() => {
    if (selectedId === null) return;
    setPanels((current) => current.filter((panel) => panel.id !== selectedId));
    setSelectedId(null);
  }, [selectedId]);

  const selectedPanel = panels.find((panel) => panel.id === selectedId);

  return (
    <div className="absolute inset-0 bg-slate-200 text-slate-950">
      <Canvas shadows dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: 'high-performance' }}>
        <RoofScene
          model={model}
          panelWidthMeters={panelWidthMeters}
          panelHeightMeters={panelHeightMeters}
          sun={sun}
          panels={panels}
          selectedId={selectedId}
          roofRef={roofRef}
          onRoofClick={(event) => { if (draggingId === null) addPanel(event.point); }}
          onRoofMove={(event) => {
            if (draggingId === null) return;
            setPanels((current) => current.map((panel) => panel.id === draggingId ? { ...panel, position: [event.point.x, event.point.y + 0.16, event.point.z] } : panel));
          }}
          onRoofRelease={() => setDraggingId(null)}
          onSelectPanel={setSelectedId}
          onStartDrag={(id) => { setSelectedId(id); setDraggingId(id); }}
          onReady={() => setSceneReady(true)}
        />
      </Canvas>

      <aside className="absolute right-5 top-20 z-20 w-80 rounded-3xl border border-slate-200 bg-white/94 p-5 shadow-2xl backdrop-blur-xl">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-600">理想化3D设计</p>
        <h2 className="mt-1 text-lg font-semibold">{panels.length} 块组件</h2>
        <p className="mt-2 text-xs leading-5 text-slate-500">点击屋顶添加，拖动蓝色组件调整位置。概念级方案需工程复核。</p>
        {model.gbaBuildingId && (
          <div className="mt-3 rounded-2xl border border-sky-100 bg-sky-50 p-3 text-xs leading-5 text-slate-600">
            <p className="font-semibold text-sky-700">GlobalBuildingAtlas 已匹配</p>
            <p>{model.gbaBuildingId} · LoD1 高度 {model.gbaHeightMeters?.toFixed(2)} m</p>
            <p className="text-[10px] text-slate-400">GBA LoD1: CC BY-NC 4.0 · 屋顶细节来自 Google DSM</p>
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-500">阵列方位
            <input type="number" min="0" max="359" value={orientationDegrees} onChange={(event) => setOrientationDegrees(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-500">支架倾角
            <input type="number" min="0" max="45" value={tiltDegrees} onChange={(event) => setTiltDegrees(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-500">屋面退距 (m)
            <input type="number" min="0" max="5" step="0.1" value={setbackMeters} onChange={(event) => setSetbackMeters(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-500">行间距 (m)
            <input type="number" min="0.2" max="5" step="0.1" value={rowSpacingMeters} onChange={(event) => setRowSpacingMeters(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </label>
        </div>
        <button type="button" onClick={autoLayout} className="mt-4 w-full rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-400">生成整齐阵列</button>
        {selectedPanel && (
          <div className="mt-4 rounded-2xl bg-slate-100 p-3">
            <p className="text-xs font-semibold">组件 #{selectedPanel.id}</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button type="button" onClick={() => updateSelected({ rotationY: selectedPanel.rotationY - THREE.MathUtils.degToRad(5) })} className="rounded-lg bg-white px-2 py-2 text-xs">↶ 5°</button>
              <button type="button" onClick={() => updateSelected({ rotationY: selectedPanel.rotationY + Math.PI / 2 })} className="rounded-lg bg-white px-2 py-2 text-xs">横 / 竖</button>
              <button type="button" onClick={() => updateSelected({ rotationY: selectedPanel.rotationY + THREE.MathUtils.degToRad(5) })} className="rounded-lg bg-white px-2 py-2 text-xs">5° ↷</button>
            </div>
            <button type="button" onClick={deleteSelected} className="mt-2 w-full rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600">删除组件</button>
          </div>
        )}
        <button type="button" onClick={() => { setPanels([]); setSelectedId(null); }} className="mt-3 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50">清空</button>
      </aside>
    </div>
  );
}
