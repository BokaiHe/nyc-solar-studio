'use client';

import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { Grid, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import * as THREE from 'three';
import { useI18n } from '@/lib/i18n';
import { panelDirectLightFactor } from '@/lib/solar/sun';
import type { ConceptPanel, RoofModelData, SunSnapshot } from '@/lib/solar/types';

type RoofDesigner3DProps = {
  model: RoofModelData;
  panelWidthMeters: number;
  panelHeightMeters: number;
  sun: SunSnapshot | null;
  panels: ConceptPanel[];
  onPanelsChange: Dispatch<SetStateAction<ConceptPanel[]>>;
  showControls: boolean;
  notice?: string;
};

// Scene x is east and z is south, so a panel facing compass azimuth A is
// yawed by 180° - A before tilting about its own x axis ('YXZ' order).
function panelYaw(azimuthDegrees: number): number {
  return THREE.MathUtils.degToRad(180 - azimuthDegrees);
}

function nextPanelId(panels: ConceptPanel[]): number {
  return panels.reduce((max, panel) => Math.max(max, panel.id), 0) + 1;
}

// Module styling follows BESS-Twin's SolarFarm: navy glass, light cell lines,
// a faint glow that tracks direct sunlight, and steel posts under tilted rows.
const PANEL_COLORS = { glass: '#2f4f86', selected: '#3b82f6', cells: '#9cc3ec', glow: '#5fa8ff', post: '#b8c2cc' };
const PANEL_THICKNESS = 0.05;
const ROOF_CLEARANCE = 0.16;

function SolarPanelModel({ panel, width, length, glint, selected, onSelect, onStartDrag }: {
  panel: ConceptPanel;
  width: number;
  length: number;
  glint: number;
  selected: boolean;
  onSelect: () => void;
  onStartDrag: () => void;
}) {
  const tilt = THREE.MathUtils.degToRad(panel.tiltDegrees);
  const cellLines = useMemo(() => {
    const columns = Math.max(2, Math.round(width / 0.55));
    const rows = Math.max(2, Math.round(length / 0.45));
    return [
      ...Array.from({ length: columns - 1 }, (_, index) => ({ key: `column-${index}`, x: (index + 1) * width / columns - width / 2, z: 0, size: [0.012, 0.01, length] as const })),
      ...Array.from({ length: rows - 1 }, (_, index) => ({ key: `row-${index}`, x: 0, z: (index + 1) * length / rows - length / 2, size: [width, 0.01, 0.012] as const })),
    ];
  }, [length, width]);
  // Posts run from the roof to the panel underside; the down-slope edge faces +z here.
  const posts = [-0.35, 0.35].flatMap((fraction) => {
    const z = fraction * length;
    const top = -z * Math.sin(tilt) - PANEL_THICKNESS / 2;
    const height = top + ROOF_CLEARANCE;
    if (height < 0.03) return [];
    return [-0.4, 0.4].map((side) => ({ x: side * width, z, y: top - height / 2, height }));
  });
  return (
    <group
      position={panel.position}
      rotation={[0, panelYaw(panel.azimuthDegrees), 0]}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      onPointerDown={(event) => { event.stopPropagation(); onStartDrag(); }}
    >
      {posts.map((post) => (
        <mesh key={`${post.x}:${post.z}`} position={[post.x, post.y, post.z]} castShadow>
          <boxGeometry args={[0.05, post.height, 0.05]} />
          <meshStandardMaterial color={PANEL_COLORS.post} roughness={0.6} metalness={0.3} />
        </mesh>
      ))}
      <group rotation={[tilt, 0, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[width, PANEL_THICKNESS, length]} />
          <meshStandardMaterial
            color={selected ? PANEL_COLORS.selected : PANEL_COLORS.glass}
            roughness={0.25}
            metalness={0.35}
            emissive={PANEL_COLORS.glow}
            emissiveIntensity={selected ? 0.45 : 0.05 + glint * 0.25}
          />
        </mesh>
        {cellLines.map((line) => (
          <mesh key={line.key} position={[line.x, PANEL_THICKNESS / 2 + 0.003, line.z]}>
            <boxGeometry args={line.size} />
            <meshStandardMaterial color={PANEL_COLORS.cells} roughness={0.4} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function RoofScene({ model, panelWidthMeters, panelHeightMeters, sun, panels, selectedId, onRoofClick, onRoofMove, onRoofRelease, onSelectPanel, onStartDrag, roofRef }: Pick<RoofDesigner3DProps, 'model' | 'panelWidthMeters' | 'panelHeightMeters' | 'sun' | 'panels'> & {
  selectedId: number | null;
  onRoofClick: (event: ThreeEvent<MouseEvent>) => void;
  onRoofMove: (event: ThreeEvent<PointerEvent>) => void;
  onRoofRelease: () => void;
  onSelectPanel: (id: number) => void;
  onStartDrag: (id: number) => void;
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
  const maxDimension = Math.max(model.widthMeters, model.depthMeters, model.modelHeightMeters ?? 0);
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
      <directionalLight position={lightPosition} intensity={sun?.daylight ? 2.1 : 0.25} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-maxDimension} shadow-camera-right={maxDimension} shadow-camera-top={maxDimension} shadow-camera-bottom={-maxDimension} shadow-camera-far={maxDimension * 6} shadow-normalBias={0.15} shadow-bias={-0.0001} />
      <PerspectiveCamera makeDefault position={[maxDimension * 1.6, roofTop + maxDimension * 1.2, maxDimension * 1.8]} fov={40} near={0.1} far={maxDimension * 8} />
      <OrbitControls makeDefault target={[0, roofTop * 0.5, 0]} minDistance={maxDimension * 0.25} maxDistance={maxDimension * 5} maxPolarAngle={Math.PI * 0.49} />
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
        <SolarPanelModel
          key={panel.id}
          panel={panel}
          width={panel.landscape ? panelHeightMeters : panelWidthMeters}
          length={panel.landscape ? panelWidthMeters : panelHeightMeters}
          glint={sun ? panelDirectLightFactor(panel.azimuthDegrees, panel.tiltDegrees, sun) : 0}
          selected={selectedId === panel.id}
          onSelect={() => onSelectPanel(panel.id)}
          onStartDrag={() => onStartDrag(panel.id)}
        />
      ))}
      <Grid args={[maxDimension * 1.8, maxDimension * 1.8]} position={[0, 0, 0]} cellSize={1} cellThickness={0.4} cellColor="#94a3b8" sectionSize={5} sectionThickness={0.8} sectionColor="#64748b" fadeDistance={maxDimension * 1.5} infiniteGrid />
    </>
  );
}

export function RoofDesigner3D({ model, panelWidthMeters, panelHeightMeters, sun, panels, onPanelsChange: setPanels, showControls, notice }: RoofDesigner3DProps) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [tiltDegrees, setTiltDegrees] = useState(10);
  const [orientationDegrees, setOrientationDegrees] = useState(180);
  const [setbackMeters, setSetbackMeters] = useState(1.2);
  const [rowSpacingMeters, setRowSpacingMeters] = useState(0.8);
  const roofRef = useRef<THREE.Mesh | null>(null);

  const addPanel = useCallback((point: THREE.Vector3) => {
    setPanels((current) => {
      if (current.some((panel) => Math.hypot(panel.position[0] - point.x, panel.position[2] - point.z) < panelWidthMeters * 0.7)) return current;
      return [...current, {
        id: nextPanelId(current),
        position: [point.x, point.y + 0.16, point.z],
        azimuthDegrees: orientationDegrees,
        tiltDegrees,
        landscape: false,
      }];
    });
  }, [orientationDegrees, panelWidthMeters, setPanels, tiltDegrees]);

  const autoLayout = useCallback(() => {
    const roof = roofRef.current;
    if (!roof) return;
    roof.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    const generated: ConceptPanel[] = [];
    const margin = setbackMeters;
    const stepX = panelWidthMeters + 0.22;
    const stepZ = panelHeightMeters + rowSpacingMeters;
    const rotation = panelYaw(orientationDegrees);
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
          id: generated.length + 1,
          position: [x, height, z],
          azimuthDegrees: orientationDegrees,
          tiltDegrees,
          landscape: false,
        });
        if (generated.length >= 320) break;
      }
      if (generated.length >= 320) break;
    }
    setPanels(generated);
    setSelectedId(null);
  }, [model.depthMeters, model.widthMeters, orientationDegrees, panelHeightMeters, panelWidthMeters, rowSpacingMeters, setPanels, setbackMeters, tiltDegrees]);

  const updateSelected = useCallback((patch: Partial<ConceptPanel>) => {
    if (selectedId === null) return;
    setPanels((current) => current.map((panel) => panel.id === selectedId ? { ...panel, ...patch } : panel));
  }, [selectedId, setPanels]);

  const deleteSelected = useCallback(() => {
    if (selectedId === null) return;
    setPanels((current) => current.filter((panel) => panel.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, setPanels]);

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
        />
      </Canvas>

      {showControls && (
      <aside className="absolute right-5 top-20 z-20 max-h-[calc(100vh-6.25rem)] w-80 overflow-y-auto rounded-3xl border border-slate-200 bg-white/94 p-5 shadow-2xl backdrop-blur-xl">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-600">{t.designer.eyebrow}</p>
        <h2 className="mt-1 text-lg font-semibold">{t.designer.count(panels.length)}</h2>
        <p className="mt-2 text-xs leading-5 text-slate-500">{t.designer.intro}</p>
        {notice && <p className="mt-2 text-xs font-medium text-amber-600">{notice}</p>}
        {model.nycBuildingId && (
          <div className="mt-3 rounded-2xl border border-sky-100 bg-sky-50 p-3 text-xs leading-5 text-slate-600">
            <p className="font-semibold text-sky-700">{t.designer.modelTitle}</p>
            <p>{model.modelAddress || `BIN ${model.nycBin}`}</p>
            <p>{t.designer.modelHeight(model.modelHeightMeters?.toFixed(1) ?? '—', model.modelRelease ?? '')}</p>
            <p className="text-[10px] text-slate-500">{t.designer.modelSource}</p>
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-500">{t.designer.azimuth}
            <input type="number" min="0" max="359" value={orientationDegrees} onChange={(event) => setOrientationDegrees(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-500">{t.designer.tilt}
            <input type="number" min="0" max="45" value={tiltDegrees} onChange={(event) => setTiltDegrees(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-500">{t.designer.setback}
            <input type="number" min="0" max="5" step="0.1" value={setbackMeters} onChange={(event) => setSetbackMeters(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-500">{t.designer.rowSpacing}
            <input type="number" min="0.2" max="5" step="0.1" value={rowSpacingMeters} onChange={(event) => setRowSpacingMeters(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </label>
        </div>
        <button type="button" onClick={autoLayout} className="mt-4 w-full rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-400">{t.designer.autoLayout}</button>
        {selectedPanel && (
          <div className="mt-4 rounded-2xl bg-slate-100 p-3">
            <p className="text-xs font-semibold">{t.designer.panelInfo(selectedPanel.id, Math.round(selectedPanel.azimuthDegrees))}</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button type="button" onClick={() => updateSelected({ azimuthDegrees: (selectedPanel.azimuthDegrees + 355) % 360 })} className="rounded-lg bg-white px-2 py-2 text-xs">↶ 5°</button>
              <button type="button" onClick={() => updateSelected({ landscape: !selectedPanel.landscape })} className="rounded-lg bg-white px-2 py-2 text-xs">{t.portraitLandscape}</button>
              <button type="button" onClick={() => updateSelected({ azimuthDegrees: (selectedPanel.azimuthDegrees + 5) % 360 })} className="rounded-lg bg-white px-2 py-2 text-xs">5° ↷</button>
            </div>
            <button type="button" onClick={deleteSelected} className="mt-2 w-full rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600">{t.designer.delete}</button>
          </div>
        )}
        <button type="button" onClick={() => { setPanels([]); setSelectedId(null); }} className="mt-3 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50">{t.designer.clear}</button>
      </aside>
      )}
    </div>
  );
}
