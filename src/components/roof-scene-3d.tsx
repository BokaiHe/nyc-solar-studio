'use client';

import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { createSurfaceGeometry, panelCenter, panelYaw, rackCenterHeight, roofTopHeight, type PanelSize } from '@/lib/design/geometry';
import type { SelectMode, Tool } from '@/lib/design/state';
import type { ConceptPanel, RoofModelData, SunSnapshot } from '@/lib/solar/types';

type Position = [number, number, number];
type PanelPlan = { panel: Omit<ConceptPanel, 'id'>; valid: boolean };
export type ViewCommand = { kind: 'reset' | 'top'; nonce: number };

type RoofScene3DProps = {
  model: RoofModelData;
  panels: ConceptPanel[];
  panelSize: PanelSize;
  selectedIds: number[];
  sun: SunSnapshot | null;
  tool: Tool;
  editable: boolean;
  view: ViewCommand;
  // Resolves where a new panel would go for a roof hit, snapped and checked for overlap.
  planPanel: (point: Position, normal: Position) => PanelPlan;
  onAddPanel: (panel: Omit<ConceptPanel, 'id'>) => void;
  onSelect: (ids: number[], mode: SelectMode) => void;
  onCheckpoint: () => void;
  onMovePanels: (positions: Array<[number, Position]>) => void;
  onCancelGesture: () => void;
  onRemovePanels: (ids: number[]) => void;
};

type Marquee = { left: number; top: number; width: number; height: number };
// The parts of drei's OrbitControls this scene drives.
type OrbitControlsImpl = { enabled: boolean; target: THREE.Vector3; object: THREE.Camera; update: () => void };

// Pointer travel (px) below which a press counts as a click rather than a drag.
const CLICK_TOLERANCE = 4;
const PANEL_THICKNESS = 0.05;

// Module styling follows BESS-Twin's SolarFarm: navy glass with light cell
// lines, aluminium frame, and steel posts under tilted racks.
const COLORS = { glass: '#2f4f86', frame: '#94a3b8', cells: '#9cc3ec', post: '#b8c2cc', selected: '#38bdf8', hover: '#7dd3fc', erase: '#ef4444', ghost: '#22c55e' };

function cellTexture(landscape: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 120;
  canvas.height = 200;
  const context = canvas.getContext('2d')!;
  context.fillStyle = COLORS.glass;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = COLORS.cells;
  context.lineWidth = 2;
  // A 6 × 10 cell module.
  for (let column = 1; column < 6; column += 1) {
    context.beginPath();
    context.moveTo((column * canvas.width) / 6, 0);
    context.lineTo((column * canvas.width) / 6, canvas.height);
    context.stroke();
  }
  for (let row = 1; row < 10; row += 1) {
    context.beginPath();
    context.moveTo(0, (row * canvas.height) / 10);
    context.lineTo(canvas.width, (row * canvas.height) / 10);
    context.stroke();
  }
  context.strokeStyle = COLORS.frame;
  context.lineWidth = 6;
  context.strokeRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (landscape) {
    texture.center.set(0.5, 0.5);
    texture.rotation = Math.PI / 2;
  }
  return texture;
}

type PanelLook = 'normal' | 'selected' | 'hover' | 'erase';

function usePanelMaterials(glint: number) {
  const textures = useMemo(() => ({ portrait: cellTexture(false), landscape: cellTexture(true) }), []);
  const materials = useMemo(() => {
    const side = new THREE.MeshStandardMaterial({ color: COLORS.frame, roughness: 0.5, metalness: 0.4 });
    const build = (map: THREE.Texture, look: PanelLook) => {
      const tint = { normal: '#ffffff', selected: COLORS.selected, hover: COLORS.hover, erase: COLORS.erase }[look];
      const top = new THREE.MeshStandardMaterial({ map, color: tint, roughness: 0.25, metalness: 0.35, emissive: look === 'normal' ? '#5fa8ff' : tint, emissiveIntensity: look === 'normal' ? 0 : 0.35 });
      // Box faces: +x, -x, +y (top), -y, +z, -z.
      return [side, side, top, side, side, side];
    };
    const looks = (map: THREE.Texture): Record<PanelLook, THREE.Material[]> => ({
      normal: build(map, 'normal'),
      selected: build(map, 'selected'),
      hover: build(map, 'hover'),
      erase: build(map, 'erase'),
    });
    return {
      portrait: looks(textures.portrait),
      landscape: looks(textures.landscape),
      post: new THREE.MeshStandardMaterial({ color: COLORS.post, roughness: 0.6, metalness: 0.3 }),
      ghost: new THREE.MeshStandardMaterial({ color: COLORS.ghost, transparent: true, opacity: 0.55, depthWrite: false }),
      ghostInvalid: new THREE.MeshStandardMaterial({ color: COLORS.erase, transparent: true, opacity: 0.45, depthWrite: false }),
    };
  }, [textures]);
  // Normal panels glow faintly with direct sun, as in BESS-Twin.
  useEffect(() => {
    for (const set of [materials.portrait.normal, materials.landscape.normal]) {
      (set[2] as THREE.MeshStandardMaterial).emissiveIntensity = 0.05 + glint * 0.2;
    }
  }, [glint, materials]);
  useEffect(() => () => {
    textures.portrait.dispose();
    textures.landscape.dispose();
  }, [textures]);
  return materials;
}

const panelRotation = (panel: Pick<ConceptPanel, 'azimuthDegrees' | 'tiltDegrees'>) =>
  new THREE.Euler(THREE.MathUtils.degToRad(panel.tiltDegrees), panelYaw(panel.azimuthDegrees), 0, 'YXZ');

const PanelMesh = memo(function PanelMesh({ panel, geometry, material, onPointerDown, onPointerEnter, onPointerLeave }: {
  panel: ConceptPanel;
  geometry: THREE.BufferGeometry;
  material: THREE.Material[];
  onPointerDown: (event: ThreeEvent<PointerEvent>, panel: ConceptPanel) => void;
  onPointerEnter: (event: ThreeEvent<PointerEvent>, panel: ConceptPanel) => void;
  onPointerLeave: (panel: ConceptPanel) => void;
}) {
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={panel.position}
      rotation={panelRotation(panel)}
      castShadow
      receiveShadow
      onPointerDown={(event) => onPointerDown(event, panel)}
      onPointerEnter={(event) => onPointerEnter(event, panel)}
      onPointerLeave={() => onPointerLeave(panel)}
    />
  );
});

// All rack posts as one instanced mesh: hundreds of panels stay cheap to draw.
function RackPosts({ panels, panelSize, material }: { panels: ConceptPanel[]; panelSize: PanelSize; material: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const posts = useMemo(() => {
    const result: THREE.Matrix4[] = [];
    const yaw = new THREE.Quaternion();
    for (const panel of panels) {
      if (panel.mount !== 'rack') continue;
      const width = panel.landscape ? panelSize.heightMeters : panelSize.widthMeters;
      const length = panel.landscape ? panelSize.widthMeters : panelSize.heightMeters;
      const tilt = THREE.MathUtils.degToRad(panel.tiltDegrees);
      const roofBelow = rackCenterHeight(panel.tiltDegrees, length);
      yaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), panelYaw(panel.azimuthDegrees));
      for (const fraction of [-0.35, 0.35]) {
        // The down-slope edge faces +z in panel space.
        const z = fraction * length;
        const top = -z * Math.sin(tilt) - PANEL_THICKNESS / 2;
        const height = top + roofBelow;
        if (height < 0.03) continue;
        for (const side of [-0.4, 0.4]) {
          const offset = new THREE.Vector3(side * width, top - height / 2, z).applyQuaternion(yaw);
          result.push(new THREE.Matrix4().compose(
            new THREE.Vector3(panel.position[0] + offset.x, panel.position[1] + offset.y, panel.position[2] + offset.z),
            yaw,
            new THREE.Vector3(1, height, 1),
          ));
        }
      }
    }
    return result;
  }, [panelSize, panels]);
  const geometry = useMemo(() => new THREE.BoxGeometry(0.05, 1, 0.05), []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    posts.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.count = posts.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [posts]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (!posts.length) return null;
  // Remount when the capacity grows; instanced meshes cannot resize.
  return <instancedMesh key={Math.ceil(posts.length / 256)} ref={ref} args={[geometry, material, Math.ceil(posts.length / 256) * 256]} castShadow />;
}

function upNormal(face: THREE.Face | null | undefined): Position {
  if (!face) return [0, 1, 0];
  const sign = face.normal.y < 0 ? -1 : 1;
  return [face.normal.x * sign, face.normal.y * sign, face.normal.z * sign];
}

type Gesture =
  | { kind: 'move'; startX: number; startY: number; started: boolean; plane: THREE.Plane; from: THREE.Vector3; origins: Array<[ConceptPanel, Position]> }
  | { kind: 'marquee'; startX: number; startY: number; additive: boolean }
  | { kind: 'erase'; erased: boolean };

function Scene(props: RoofScene3DProps & { setMarquee: (marquee: Marquee | null) => void; setCursor: (cursor: string) => void }) {
  const { model, panels, panelSize, selectedIds, sun, tool, editable, view, planPanel, onAddPanel, onSelect, onCheckpoint, onMovePanels, onCancelGesture, onRemovePanels, setMarquee, setCursor } = props;
  const { camera, gl, raycaster } = useThree();
  const viewport = useThree((state) => state.size);
  // Portrait screens show less width, so back the camera off to keep the roof in frame.
  const fit = Math.max(1, 0.9 / Math.max(0.1, viewport.width / Math.max(1, viewport.height)));
  // The camera prop only seeds the first frame; resizes must not reset the user's view.
  const [initialFit] = useState(fit);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const roofRef = useRef<THREE.Mesh>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [ghost, setGhost] = useState<PanelPlan | null>(null);

  const roofGeometry = useMemo(() => createSurfaceGeometry(model.positions, model.indices), [model.indices, model.positions]);
  const wallGeometry = useMemo(() => createSurfaceGeometry(model.wallPositions, model.wallIndices), [model.wallIndices, model.wallPositions]);
  const boxes = useMemo(() => ({
    portrait: new THREE.BoxGeometry(panelSize.widthMeters, PANEL_THICKNESS, panelSize.heightMeters),
    landscape: new THREE.BoxGeometry(panelSize.heightMeters, PANEL_THICKNESS, panelSize.widthMeters),
  }), [panelSize]);
  useEffect(() => () => {
    roofGeometry.dispose();
    wallGeometry.dispose();
    boxes.portrait.dispose();
    boxes.landscape.dispose();
  }, [boxes, roofGeometry, wallGeometry]);

  const footprint = Math.max(model.widthMeters, model.depthMeters, 8);
  const size = Math.max(footprint, model.modelHeightMeters ?? 0);
  const roofTop = useMemo(() => roofTopHeight(model.positions), [model.positions]);
  const glint = sun?.daylight ? Math.max(0, Math.sin(THREE.MathUtils.degToRad(sun.altitudeDegrees))) : 0;
  const materials = usePanelMaterials(glint);
  const altitude = sun ? THREE.MathUtils.degToRad(Math.max(-5, sun.altitudeDegrees)) : Math.PI / 4;
  const azimuth = sun ? THREE.MathUtils.degToRad(sun.azimuthDegrees) : Math.PI;
  const lightPosition: Position = [
    Math.sin(azimuth) * Math.cos(altitude) * size,
    Math.max(8, Math.sin(altitude) * size),
    -Math.cos(azimuth) * Math.cos(altitude) * size,
  ];

  // Camera commands: frame the roof obliquely, or look straight down on it.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const reach = footprint * fit;
    const position = view.kind === 'top'
      ? [0, roofTop + reach * 1.6, 0.01]
      : [reach * 1.1, roofTop + reach * 1.1, reach * 1.3];
    controls.object.position.set(position[0], position[1], position[2]);
    controls.target.set(0, roofTop, 0);
    controls.update();
    // Refit only on explicit commands, not on every resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [footprint, roofTop, view]);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const setControlsEnabled = useCallback((enabled: boolean) => {
    if (controlsRef.current) controlsRef.current.enabled = enabled;
  }, []);

  const pointerOnPlane = useCallback((clientX: number, clientY: number, plane: THREE.Plane) => {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  }, [camera, gl, raycaster]);

  // Drop a moved panel back onto whatever roof lies under it.
  const reseat = useCallback((panel: ConceptPanel, x: number, z: number): Position | null => {
    const roof = roofRef.current;
    if (!roof) return null;
    const probe = new THREE.Raycaster(new THREE.Vector3(x, panel.position[1] + 50, z), new THREE.Vector3(0, -1, 0));
    const hit = probe.intersectObject(roof, false)[0];
    if (!hit) return null;
    const length = panel.landscape ? panelSize.widthMeters : panelSize.heightMeters;
    return panelCenter([hit.point.x, hit.point.y, hit.point.z], upNormal(hit.face), panel.mount, panel.tiltDegrees, length);
  }, [panelSize]);

  // Window-level listeners finish gestures even when the pointer leaves the canvas.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      if (gesture.kind === 'move') {
        if (!gesture.started) {
          if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < CLICK_TOLERANCE) return;
          gesture.started = true;
          onCheckpoint();
        }
        const point = pointerOnPlane(event.clientX, event.clientY, gesture.plane);
        if (!point) return;
        const dx = point.x - gesture.from.x;
        const dz = point.z - gesture.from.z;
        onMovePanels(gesture.origins.map(([panel, origin]) => [panel.id, [origin[0] + dx, origin[1], origin[2] + dz]]));
      } else if (gesture.kind === 'marquee') {
        const rect = gl.domElement.getBoundingClientRect();
        const left = Math.min(gesture.startX, event.clientX) - rect.left;
        const top = Math.min(gesture.startY, event.clientY) - rect.top;
        setMarquee({ left, top, width: Math.abs(event.clientX - gesture.startX), height: Math.abs(event.clientY - gesture.startY) });
      }
    };
    const onUp = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      gestureRef.current = null;
      setControlsEnabled(true);
      if (gesture.kind === 'move' && gesture.started) {
        const point = pointerOnPlane(event.clientX, event.clientY, gesture.plane);
        const dx = point ? point.x - gesture.from.x : 0;
        const dz = point ? point.z - gesture.from.z : 0;
        const seated = gesture.origins.map(([panel, origin]) => [panel.id, reseat(panel, origin[0] + dx, origin[2] + dz)] as const);
        // Dropping any panel off the roof cancels the whole move.
        if (seated.some(([, position]) => position === null)) onCancelGesture();
        else onMovePanels(seated as Array<[number, Position]>);
      } else if (gesture.kind === 'marquee') {
        setMarquee(null);
        const width = Math.abs(event.clientX - gesture.startX);
        const height = Math.abs(event.clientY - gesture.startY);
        if (width < CLICK_TOLERANCE && height < CLICK_TOLERANCE) {
          if (!gesture.additive) onSelect([], 'replace');
          return;
        }
        const rect = gl.domElement.getBoundingClientRect();
        const minX = Math.min(gesture.startX, event.clientX) - rect.left;
        const minY = Math.min(gesture.startY, event.clientY) - rect.top;
        const projected = new THREE.Vector3();
        const ids = panels.filter((panel) => {
          projected.set(...panel.position).project(camera);
          const x = ((projected.x + 1) / 2) * rect.width;
          const y = ((1 - projected.y) / 2) * rect.height;
          return projected.z < 1 && x >= minX && x <= minX + width && y >= minY && y <= minY + height;
        }).map((panel) => panel.id);
        onSelect(ids, gesture.additive ? 'add' : 'replace');
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [camera, gl, onCancelGesture, onCheckpoint, onMovePanels, onSelect, panels, pointerOnPlane, reseat, setControlsEnabled, setMarquee]);

  const onPanelDown = useCallback((event: ThreeEvent<PointerEvent>, panel: ConceptPanel) => {
    if (!editable || event.button !== 0) return;
    event.stopPropagation();
    if (tool === 'add') return;
    setControlsEnabled(false);
    if (tool === 'erase') {
      onCheckpoint();
      onRemovePanels([panel.id]);
      gestureRef.current = { kind: 'erase', erased: true };
      return;
    }
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (additive && selected.has(panel.id)) {
      onSelect([panel.id], 'toggle');
      setControlsEnabled(true);
      return;
    }
    const ids = additive ? [...selected, panel.id] : selected.has(panel.id) ? [...selected] : [panel.id];
    if (!selected.has(panel.id)) onSelect([panel.id], additive ? 'add' : 'replace');
    const moving = new Set(ids);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -panel.position[1]);
    const from = pointerOnPlane(event.nativeEvent.clientX, event.nativeEvent.clientY, plane) ?? new THREE.Vector3(...panel.position);
    gestureRef.current = {
      kind: 'move',
      startX: event.nativeEvent.clientX,
      startY: event.nativeEvent.clientY,
      started: false,
      plane,
      from,
      origins: panels.filter((item) => moving.has(item.id)).map((item) => [item, item.position]),
    };
  }, [editable, onCheckpoint, onRemovePanels, onSelect, panels, pointerOnPlane, selected, setControlsEnabled, tool]);

  const onPanelEnter = useCallback((event: ThreeEvent<PointerEvent>, panel: ConceptPanel) => {
    if (!editable || tool === 'add') return;
    event.stopPropagation();
    setHoveredId(panel.id);
    const gesture = gestureRef.current;
    if (gesture?.kind === 'erase') {
      if (!gesture.erased) {
        onCheckpoint();
        gesture.erased = true;
      }
      onRemovePanels([panel.id]);
    }
  }, [editable, onCheckpoint, onRemovePanels, tool]);

  const onPanelLeave = useCallback((panel: ConceptPanel) => {
    setHoveredId((current) => (current === panel.id ? null : current));
  }, []);

  const onRoofDown = (event: ThreeEvent<PointerEvent>) => {
    if (!editable || event.button !== 0 || tool === 'add') return;
    setControlsEnabled(false);
    if (tool === 'erase') {
      gestureRef.current = { kind: 'erase', erased: false };
      return;
    }
    gestureRef.current = {
      kind: 'marquee',
      startX: event.nativeEvent.clientX,
      startY: event.nativeEvent.clientY,
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
    };
  };

  const onRoofMove = (event: ThreeEvent<PointerEvent>) => {
    if (!editable || tool !== 'add' || gestureRef.current) return;
    setGhost(planPanel([event.point.x, event.point.y, event.point.z], upNormal(event.face)));
  };

  const onRoofClick = (event: ThreeEvent<MouseEvent>) => {
    if (!editable || tool !== 'add' || event.delta > CLICK_TOLERANCE) return;
    const plan = planPanel([event.point.x, event.point.y, event.point.z], upNormal(event.face));
    if (plan.valid) onAddPanel(plan.panel);
    setGhost(planPanel([event.point.x, event.point.y, event.point.z], upNormal(event.face)));
  };

  const hovered = editable && tool !== 'add' ? hoveredId : null;
  useEffect(() => {
    setCursor(!editable ? 'default'
      : tool === 'add' ? 'crosshair'
        : tool === 'erase' ? (hovered !== null ? 'pointer' : 'crosshair')
          : hovered !== null ? 'move' : 'default');
  }, [editable, hovered, setCursor, tool]);

  const lookFor = (panel: ConceptPanel): PanelLook => {
    if (!editable) return 'normal';
    if (hovered === panel.id && tool === 'erase') return 'erase';
    if (selected.has(panel.id)) return 'selected';
    if (hovered === panel.id) return 'hover';
    return 'normal';
  };

  // The ghost only shows while placing; stale previews from another tool are ignored.
  const preview = editable && tool === 'add' ? ghost : null;

  return (
    <>
      <color attach="background" args={['#e8edf3']} />
      <ambientLight intensity={0.85} />
      <directionalLight position={lightPosition} intensity={sun?.daylight ? 2.1 : 0.25} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-size} shadow-camera-right={size} shadow-camera-top={size} shadow-camera-bottom={-size} shadow-camera-far={size * 6} shadow-normalBias={0.15} shadow-bias={-0.0001} />
      {/* Design happens on the roof, so frame the roof footprint, not the whole tower. */}
      <PerspectiveCamera makeDefault position={[footprint * initialFit * 1.1, roofTop + footprint * initialFit * 1.1, footprint * initialFit * 1.3]} fov={40} near={0.1} far={size * 10} />
      <OrbitControls ref={controlsRef as never} makeDefault target={[0, roofTop, 0]} minDistance={Math.max(4, footprint * 0.12)} maxDistance={size * 4} maxPolarAngle={Math.PI * 0.49} />
      <mesh ref={roofRef} geometry={roofGeometry} castShadow receiveShadow onPointerDown={onRoofDown} onPointerMove={onRoofMove} onPointerOut={() => setGhost(null)} onClick={onRoofClick}>
        <meshStandardMaterial color="#e2e8f0" roughness={0.78} metalness={0.02} side={THREE.DoubleSide} flatShading />
      </mesh>
      <mesh geometry={wallGeometry} castShadow receiveShadow>
        <meshStandardMaterial color="#a8b2bf" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {panels.map((panel) => (
        <PanelMesh
          key={panel.id}
          panel={panel}
          geometry={panel.landscape ? boxes.landscape : boxes.portrait}
          material={materials[panel.landscape ? 'landscape' : 'portrait'][lookFor(panel)]}
          onPointerDown={onPanelDown}
          onPointerEnter={onPanelEnter}
          onPointerLeave={onPanelLeave}
        />
      ))}
      <RackPosts panels={panels} panelSize={panelSize} material={materials.post} />
      {preview && (
        <mesh
          geometry={preview.panel.landscape ? boxes.landscape : boxes.portrait}
          material={preview.valid ? materials.ghost : materials.ghostInvalid}
          position={preview.panel.position}
          rotation={panelRotation(preview.panel)}
          raycast={() => null}
        />
      )}
      <Grid args={[size * 1.8, size * 1.8]} cellSize={1} cellThickness={0.4} cellColor="#94a3b8" sectionSize={5} sectionThickness={0.8} sectionColor="#64748b" fadeDistance={size * 1.5} infiniteGrid />
    </>
  );
}

export function RoofScene3D(props: RoofScene3DProps) {
  const { editable, onSelect, tool } = props;
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [cursor, setCursor] = useState('default');
  return (
    <div className="absolute inset-0 bg-slate-200" style={{ cursor }} onContextMenu={(event) => event.preventDefault()}>
      <Canvas
        shadows
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={(event) => { if (editable && tool === 'select' && event.button === 0 && !event.shiftKey) onSelect([], 'replace'); }}
      >
        <Scene {...props} setMarquee={setMarquee} setCursor={setCursor} />
      </Canvas>
      {marquee && (
        <div
          className="pointer-events-none absolute border border-sky-500 bg-sky-400/15"
          style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
        />
      )}
    </div>
  );
}
