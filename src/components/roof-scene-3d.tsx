'use client';

import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { Grid, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { createSurfaceGeometry, panelYaw, rackCenterHeight, roofTopHeight, type PanelSize } from '@/lib/design/geometry';
import { panelDirectLightFactor } from '@/lib/solar/sun';
import type { ConceptPanel, RoofModelData, SunSnapshot } from '@/lib/solar/types';

type Position = [number, number, number];

type RoofScene3DProps = {
  model: RoofModelData;
  panels: ConceptPanel[];
  panelSize: PanelSize;
  selectedId: number | null;
  sun: SunSnapshot | null;
  editable: boolean;
  // Roof hits carry the surface point and its upward unit normal.
  onAddPanel: (point: Position, normal: Position) => void;
  onSelectPanel: (id: number | null) => void;
  onDragStart: (id: number) => void;
  onDragMove: (id: number, point: Position, normal: Position) => void;
};

// Pointer travel (px) below which a press counts as a click rather than an orbit.
const CLICK_TOLERANCE = 4;

// Module styling follows BESS-Twin's SolarFarm: navy glass, light cell lines,
// a faint glow that tracks direct sunlight, and steel posts under tilted rows.
const PANEL_COLORS = { glass: '#2f4f86', selected: '#3b82f6', cells: '#9cc3ec', glow: '#5fa8ff', post: '#b8c2cc' };
const PANEL_THICKNESS = 0.05;

function SolarPanelModel({ panel, width, length, glint, selected, editable, onSelect, onStartDrag }: {
  panel: ConceptPanel;
  width: number;
  length: number;
  glint: number;
  selected: boolean;
  editable: boolean;
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
  // Rack posts run from the roof to the panel underside; the down-slope edge
  // faces +z here. Flush panels lie on the roof and need none.
  const roofBelow = rackCenterHeight(panel.tiltDegrees, length);
  const posts = panel.mount === 'flush' ? [] : [-0.35, 0.35].flatMap((fraction) => {
    const z = fraction * length;
    const top = -z * Math.sin(tilt) - PANEL_THICKNESS / 2;
    const height = top + roofBelow;
    if (height < 0.03) return [];
    return [-0.4, 0.4].map((side) => ({ key: `${fraction}:${side}`, x: side * width, z, y: top - height / 2, height }));
  });
  return (
    <group
      position={panel.position}
      rotation={[0, panelYaw(panel.azimuthDegrees), 0]}
      onClick={(event) => { event.stopPropagation(); if (editable) onSelect(); }}
      onPointerDown={(event) => { event.stopPropagation(); if (editable) onStartDrag(); }}
    >
      {posts.map((post) => (
        <mesh key={post.key} position={[post.x, post.y, post.z]} castShadow>
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

// The roof mesh is untransformed, so face normals are already in scene space.
function hitNormal(event: ThreeEvent<MouseEvent | PointerEvent>): Position {
  const normal = event.face?.normal;
  if (!normal) return [0, 1, 0];
  const sign = normal.y < 0 ? -1 : 1;
  return [normal.x * sign, normal.y * sign, normal.z * sign];
}

function Scene({ model, panels, panelSize, selectedId, sun, editable, draggingId, onAddPanel, onSelectPanel, onStartDrag, onDragMove }: Omit<RoofScene3DProps, 'onDragStart'> & {
  draggingId: number | null;
  onStartDrag: (id: number) => void;
}) {
  const roofGeometry = useMemo(() => createSurfaceGeometry(model.positions, model.indices), [model.indices, model.positions]);
  const wallGeometry = useMemo(() => createSurfaceGeometry(model.wallPositions, model.wallIndices), [model.wallIndices, model.wallPositions]);
  useEffect(() => () => { roofGeometry.dispose(); wallGeometry.dispose(); }, [roofGeometry, wallGeometry]);
  const footprint = Math.max(model.widthMeters, model.depthMeters, 8);
  const size = Math.max(footprint, model.modelHeightMeters ?? 0);
  const roofTop = useMemo(() => roofTopHeight(model.positions), [model.positions]);
  const altitude = sun ? THREE.MathUtils.degToRad(Math.max(-5, sun.altitudeDegrees)) : Math.PI / 4;
  const azimuth = sun ? THREE.MathUtils.degToRad(sun.azimuthDegrees) : Math.PI;
  const lightPosition: Position = [
    Math.sin(azimuth) * Math.cos(altitude) * size,
    Math.max(8, Math.sin(altitude) * size),
    -Math.cos(azimuth) * Math.cos(altitude) * size,
  ];
  const onRoofClick = (event: ThreeEvent<MouseEvent>) => {
    if (!editable || draggingId !== null || event.delta > CLICK_TOLERANCE) return;
    onAddPanel([event.point.x, event.point.y, event.point.z], hitNormal(event));
  };
  const onRoofMove = (event: ThreeEvent<PointerEvent>) => {
    if (draggingId === null) return;
    onDragMove(draggingId, [event.point.x, event.point.y, event.point.z], hitNormal(event));
  };
  return (
    <>
      <color attach="background" args={['#e8edf3']} />
      <ambientLight intensity={0.85} />
      <directionalLight position={lightPosition} intensity={sun?.daylight ? 2.1 : 0.25} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-size} shadow-camera-right={size} shadow-camera-top={size} shadow-camera-bottom={-size} shadow-camera-far={size * 6} shadow-normalBias={0.15} shadow-bias={-0.0001} />
      {/* Design happens on the roof, so frame the roof footprint, not the whole tower. */}
      <PerspectiveCamera makeDefault position={[footprint * 1.1, roofTop + footprint * 1.1, footprint * 1.3]} fov={40} near={0.1} far={size * 10} />
      <OrbitControls makeDefault enabled={draggingId === null} target={[0, roofTop, 0]} minDistance={Math.max(4, footprint * 0.12)} maxDistance={size * 4} maxPolarAngle={Math.PI * 0.49} />
      <mesh geometry={roofGeometry} castShadow receiveShadow onClick={onRoofClick} onPointerMove={onRoofMove}>
        <meshStandardMaterial color="#e2e8f0" roughness={0.78} metalness={0.02} side={THREE.DoubleSide} flatShading />
      </mesh>
      <mesh geometry={wallGeometry} castShadow receiveShadow>
        <meshStandardMaterial color="#a8b2bf" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {panels.map((panel) => (
        <SolarPanelModel
          key={panel.id}
          panel={panel}
          width={panel.landscape ? panelSize.heightMeters : panelSize.widthMeters}
          length={panel.landscape ? panelSize.widthMeters : panelSize.heightMeters}
          glint={sun ? panelDirectLightFactor(panel.azimuthDegrees, panel.tiltDegrees, sun) : 0}
          selected={selectedId === panel.id}
          editable={editable}
          onSelect={() => onSelectPanel(panel.id)}
          onStartDrag={() => onStartDrag(panel.id)}
        />
      ))}
      <Grid args={[size * 1.8, size * 1.8]} cellSize={1} cellThickness={0.4} cellColor="#94a3b8" sectionSize={5} sectionThickness={0.8} sectionColor="#64748b" fadeDistance={size * 1.5} infiniteGrid />
    </>
  );
}

export function RoofScene3D(props: RoofScene3DProps) {
  const { editable, onDragStart, onSelectPanel } = props;
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const draggingRef = useRef<number | null>(null);

  // A drag can end anywhere, including off the roof or outside the canvas.
  useEffect(() => {
    const endDrag = () => {
      if (draggingRef.current === null) return;
      draggingRef.current = null;
      // Defer so the click that ends the drag does not add a panel.
      window.setTimeout(() => setDraggingId(null), 0);
    };
    window.addEventListener('pointerup', endDrag);
    return () => window.removeEventListener('pointerup', endDrag);
  }, []);

  return (
    <div className="absolute inset-0 bg-slate-200">
      <Canvas
        shadows
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={() => { if (editable) onSelectPanel(null); }}
      >
        <Scene
          {...props}
          draggingId={draggingId}
          onStartDrag={(id) => {
            draggingRef.current = id;
            setDraggingId(id);
            onDragStart(id);
          }}
        />
      </Canvas>
    </div>
  );
}
