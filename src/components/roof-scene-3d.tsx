'use client';

import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { YIELD_COLORS, yieldBand } from '@/lib/design/workspace';
import { createSurfaceGeometry, panelCenter, panelYaw, rackCenterHeight, roofTopHeight, type PanelSize } from '@/lib/design/geometry';
import type { KeepOutZone } from '@/lib/design/keep-out';
import type { Basemap } from '@/lib/map-tiles';
import type { SelectMode, Tool } from '@/lib/design/state';
import type { ConceptPanel, NeighborMesh, RoofModelData, SunSnapshot } from '@/lib/solar/types';

type Position = [number, number, number];
type PanelPlan = { panel: Omit<ConceptPanel, 'id'>; valid: boolean };
export type ViewCommand = { kind: 'reset' | 'top'; nonce: number };

type RoofScene3DProps = {
  model: RoofModelData;
  panels: ConceptPanel[];
  annualRatios?: ReadonlyMap<number, number>;
  panelSize: PanelSize;
  selectedIds: number[];
  sun: SunSnapshot | null;
  tool: Tool;
  editable: boolean;
  view: ViewCommand;
  // Resolves where a new panel would go for a roof hit, snapped and checked for overlap.
  planPanel: (point: Position, normal: Position) => PanelPlan;
  zones: KeepOutZone[];
  // A keep-out area picked out from the side panel's list.
  highlightedZone: number | null;
  // Satellite imagery laid on the ground and draped over the roof; null hides it.
  basemap: Basemap | null;
  // Surrounding buildings, drawn as context and casting shadows; null hides them.
  neighbors: NeighborMesh | null;
  onAddPanel: (panel: Omit<ConceptPanel, 'id'>) => void;
  onAddZone: (points: Position[]) => void;
  onRemoveZone: (id: number) => void;
  onUpdateZone: (id: number, points: Position[]) => void;
  onSelect: (ids: number[], mode: SelectMode) => void;
  onCheckpoint: () => void;
  onMovePanels: (positions: Array<[number, Position]>, finish?: boolean) => void;
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
const COLORS = { glass: '#2f4f86', frame: '#94a3b8', cells: '#9cc3ec', post: '#b8c2cc', selected: '#38bdf8', hover: '#7dd3fc', erase: '#ef4444', ghost: '#22c55e', zone: '#ef4444', zoneErase: '#991b1b' };
// Keep-out areas float this far above the roof so they never z-fight with it.
const ZONE_LIFT = 0.04;
// Pen-tool reach on screen: a click this close to the first anchor closes
// the outline, and this close to an anchor of a finished area grabs it.
const ZONE_CLOSE_PIXELS = 14;
const ANCHOR_PIXELS = 11;

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

// Panels are immutable, so each one's transform is composed once.
const panelMatrices = new WeakMap<ConceptPanel, THREE.Matrix4>();
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);
function panelMatrix(panel: ConceptPanel): THREE.Matrix4 {
  let matrix = panelMatrices.get(panel);
  if (!matrix) {
    matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...panel.position),
      new THREE.Quaternion().setFromEuler(panelRotation(panel)),
      UNIT_SCALE,
    );
    panelMatrices.set(panel, matrix);
  }
  return matrix;
}

const panelInverses = new WeakMap<ConceptPanel, THREE.Matrix4>();
function panelInverse(panel: ConceptPanel): THREE.Matrix4 {
  let inverse = panelInverses.get(panel);
  if (!inverse) {
    inverse = panelMatrix(panel).clone().invert();
    panelInverses.set(panel, inverse);
  }
  return inverse;
}

// Picking for a batch of panels. Three's instanced raycast transforms the box
// of every instance, which takes hundreds of milliseconds per pointer move on
// a roof with ten thousand panels; a bounding-sphere test on the raw panel
// centers first leaves only the few panels under the pointer to test exactly.
const localRay = new THREE.Ray();
const localHit = new THREE.Vector3();
function raycastPanels(mesh: THREE.InstancedMesh, panels: ConceptPanel[], raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
  const { geometry } = mesh;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const radius = box.max.distanceTo(box.min) / 2;
  const { origin, direction } = raycaster.ray;
  panels.forEach((panel, instanceId) => {
    const [x, y, z] = panel.position;
    const vx = x - origin.x, vy = y - origin.y, vz = z - origin.z;
    const along = vx * direction.x + vy * direction.y + vz * direction.z;
    if (along < -radius || vx * vx + vy * vy + vz * vz - along * along > radius * radius) return;
    localRay.copy(raycaster.ray).applyMatrix4(panelInverse(panel));
    if (!localRay.intersectBox(box, localHit)) return;
    const point = localHit.clone().applyMatrix4(panelMatrix(panel));
    const distance = origin.distanceTo(point);
    if (distance < raycaster.near || distance > raycaster.far) return;
    intersects.push({ distance, point, object: mesh, instanceId });
  });
}

// Panels that share a box shape and a material set, drawn as one instanced mesh.
type PanelBatch = { key: string; geometry: THREE.BufferGeometry; material: THREE.Material[]; panels: ConceptPanel[] };

const PanelBatchMesh = memo(function PanelBatchMesh({ batch, onPointerDown, onPointerOver, onPointerOut }: {
  batch: PanelBatch;
  onPointerDown: (event: ThreeEvent<PointerEvent>, panel: ConceptPanel) => void;
  onPointerOver: (event: ThreeEvent<PointerEvent>, panel: ConceptPanel) => void;
  onPointerOut: (panels: ConceptPanel[]) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { panels } = batch;
  // Capacity grows in steps; an instanced mesh cannot resize, so it remounts.
  const capacity = Math.ceil(panels.length / 256) * 256;
  // The panels this mesh last uploaded: dragging a few panels rebuilds every
  // batch's list, but only batches whose panels changed are re-uploaded.
  const uploadedRef = useRef<{ mesh: THREE.InstancedMesh; panels: ConceptPanel[] } | null>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const uploaded = uploadedRef.current;
    if (uploaded?.mesh === mesh && uploaded.panels.length === panels.length
      && uploaded.panels.every((panel, index) => panel === panels[index])) return;
    uploadedRef.current = { mesh, panels };
    panels.forEach((panel, index) => mesh.setMatrixAt(index, panelMatrix(panel)));
    mesh.count = panels.length;
    mesh.instanceMatrix.needsUpdate = true;
    // Picking culls by the bounding sphere, which must follow moved panels.
    mesh.computeBoundingSphere();
  }, [capacity, panels]);
  const panelAt = (event: ThreeEvent<PointerEvent>) => (event.instanceId === undefined ? undefined : panels[event.instanceId]);
  if (!panels.length) return null;
  return (
    <instancedMesh
      key={capacity}
      ref={ref}
      args={[batch.geometry, batch.material, capacity]}
      castShadow
      receiveShadow
      raycast={function (this: THREE.InstancedMesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
        raycastPanels(this, panels, raycaster, intersects);
      }}
      onPointerDown={(event) => {
        const panel = panelAt(event);
        if (panel) onPointerDown(event, panel);
      }}
      onPointerMove={(event) => {
        const panel = panelAt(event);
        if (panel) onPointerOver(event, panel);
      }}
      onPointerOut={() => onPointerOut(panels)}
    />
  );
});

// Post transforms of one rack panel, cached per panel and module size.
const postMatrices = new WeakMap<ConceptPanel, { size: PanelSize; matrices: THREE.Matrix4[] }>();
const UP_AXIS = new THREE.Vector3(0, 1, 0);
function rackPostMatrices(panel: ConceptPanel, panelSize: PanelSize): THREE.Matrix4[] {
  const cached = postMatrices.get(panel);
  if (cached?.size === panelSize) return cached.matrices;
  const matrices: THREE.Matrix4[] = [];
  const width = panel.landscape ? panelSize.heightMeters : panelSize.widthMeters;
  const length = panel.landscape ? panelSize.widthMeters : panelSize.heightMeters;
  const tilt = THREE.MathUtils.degToRad(panel.tiltDegrees);
  const roofBelow = rackCenterHeight(panel.tiltDegrees, length);
  const yaw = new THREE.Quaternion().setFromAxisAngle(UP_AXIS, panelYaw(panel.azimuthDegrees));
  for (const fraction of [-0.35, 0.35]) {
    // The down-slope edge faces +z in panel space.
    const z = fraction * length;
    const top = -z * Math.sin(tilt) - PANEL_THICKNESS / 2;
    const height = top + roofBelow;
    if (height < 0.03) continue;
    for (const side of [-0.4, 0.4]) {
      const offset = new THREE.Vector3(side * width, top - height / 2, z).applyQuaternion(yaw);
      matrices.push(new THREE.Matrix4().compose(
        new THREE.Vector3(panel.position[0] + offset.x, panel.position[1] + offset.y, panel.position[2] + offset.z),
        yaw,
        new THREE.Vector3(1, height, 1),
      ));
    }
  }
  postMatrices.set(panel, { size: panelSize, matrices });
  return matrices;
}

// All rack posts as one instanced mesh: hundreds of panels stay cheap to draw.
function RackPosts({ panels, panelSize, material }: { panels: ConceptPanel[]; panelSize: PanelSize; material: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const posts = useMemo(
    () => panels.flatMap((panel) => (panel.mount === 'rack' ? rackPostMatrices(panel, panelSize) : [])),
    [panelSize, panels],
  );
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

// A keep-out area: a translucent fill triangulated in plan, at the heights
// it was drawn at, with an outline. Erasable with the erase tool.
const ZoneMesh = memo(function ZoneMesh({ zone, erasing, highlighted, onErase, onHover }: {
  zone: KeepOutZone;
  erasing: boolean;
  highlighted: boolean;
  onErase: (id: number) => void;
  onHover: (id: number | null) => void;
}) {
  const geometry = useMemo(() => {
    const contour = zone.points.map(([x, , z]) => new THREE.Vector2(x, z));
    const faces = THREE.ShapeUtils.triangulateShape(contour, []);
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(zone.points.flatMap(([x, y, z]) => [x, y + ZONE_LIFT, z]), 3));
    result.setIndex(faces.flat());
    return result;
  }, [zone.points]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const outline = useMemo(() => [...zone.points, zone.points[0]].map(([x, y, z]) => [x, y + ZONE_LIFT, z] as Position), [zone.points]);
  const color = highlighted ? COLORS.zoneErase : COLORS.zone;
  return (
    <group>
      <mesh
        geometry={geometry}
        renderOrder={2}
        // Only the erase tool picks zones; other tools reach the roof through them.
        raycast={erasing ? THREE.Mesh.prototype.raycast : () => null}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          onErase(zone.id);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          onHover(zone.id);
        }}
        onPointerOut={() => onHover(null)}
      >
        <meshBasicMaterial color={color} transparent opacity={highlighted ? 0.55 : 0.35} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={outline} color={color} lineWidth={2} raycast={() => null} />
    </group>
  );
});

// Solid red dots with a white rim, the same size on screen at any zoom.
function anchorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.arc(32, 32, 30, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = COLORS.zone;
  context.beginPath();
  context.arc(32, 32, 22, 0, Math.PI * 2);
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Pen-tool anchors, drawn over the roof and panels.
const Anchors = memo(function Anchors({ points, texture, size }: { points: Position[]; texture: THREE.Texture; size: number }) {
  const geometry = useMemo(() => {
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap(([x, y, z]) => [x, y + ZONE_LIFT, z]), 3));
    return result;
  }, [points]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <points geometry={geometry} raycast={() => null} renderOrder={6}>
      <pointsMaterial map={texture} size={size} sizeAttenuation={false} transparent alphaTest={0.2} depthTest={false} depthWrite={false} />
    </points>
  );
});

// Outline of at least three distinct points with some area, or null.
function cleanOutline(points: Position[]): Position[] | null {
  const distinct = points.filter((point, index) => index === 0 || Math.hypot(point[0] - points[index - 1][0], point[2] - points[index - 1][2]) > 0.05);
  let area = 0;
  distinct.forEach(([x1, , z1], index) => {
    const [x2, , z2] = distinct[(index + 1) % distinct.length];
    area += x1 * z2 - x2 * z1;
  });
  return distinct.length >= 3 && Math.abs(area) / 2 > 0.1 ? distinct : null;
}

function upNormal(face: THREE.Face | null | undefined): Position {
  if (!face) return [0, 1, 0];
  const sign = face.normal.y < 0 ? -1 : 1;
  return [face.normal.x * sign, face.normal.y * sign, face.normal.z * sign];
}

type Gesture =
  | { kind: 'move'; startX: number; startY: number; started: boolean; plane: THREE.Plane; from: THREE.Vector3; origins: Array<[ConceptPanel, Position]> }
  | { kind: 'marquee'; startX: number; startY: number; additive: boolean }
  | { kind: 'erase'; erased: boolean }
  | { kind: 'anchor'; zone: KeepOutZone; index: number };

function Scene(props: RoofScene3DProps & { setMarquee: (marquee: Marquee | null) => void; setCursor: (cursor: string) => void }) {
  const { model, panels, panelSize, selectedIds, sun, tool, editable, view, planPanel, zones, highlightedZone, basemap, neighbors, onAddPanel, onAddZone, onRemoveZone, onUpdateZone, onSelect, onCheckpoint, onMovePanels, onCancelGesture, onRemovePanels, setMarquee, setCursor } = props;
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
  // The keep-out outline being drawn, and where the pointer is on the roof.
  const [zoneDraft, setZoneDraft] = useState<Position[]>([]);
  const [zoneCursor, setZoneCursor] = useState<Position | null>(null);
  const [hoveredZone, setHoveredZone] = useState<number | null>(null);
  // A finished area's outline while one of its anchors is dragged.
  const [anchorDrag, setAnchorDrag] = useState<{ id: number; points: Position[] } | null>(null);
  const [overAnchor, setOverAnchor] = useState(false);
  // Set when a press grabs an anchor, so the click that follows adds no point.
  const anchorPressRef = useRef(false);
  const anchorDot = useMemo(() => anchorTexture(), []);
  useEffect(() => () => anchorDot.dispose(), [anchorDot]);
  // Switching tools drops an unfinished outline.
  const [draftTool, setDraftTool] = useState(tool);
  if (draftTool !== tool) {
    setDraftTool(tool);
    setZoneDraft([]);
    setZoneCursor(null);
  }

  const roofGeometry = useMemo(() => {
    const geometry = createSurfaceGeometry(model.positions, model.indices);
    if (basemap) {
      // Drape the imagery over the roof by plan position, as seen from above.
      const { minX, maxX, minZ, maxZ } = basemap;
      const uv: number[] = [];
      for (let index = 0; index < model.positions.length; index += 3) {
        uv.push((model.positions[index] - minX) / (maxX - minX), (maxZ - model.positions[index + 2]) / (maxZ - minZ));
      }
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    }
    return geometry;
  }, [basemap, model.indices, model.positions]);
  const basemapTexture = useMemo(() => {
    if (!basemap) return null;
    const texture = new THREE.CanvasTexture(basemap.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }, [basemap]);
  useEffect(() => () => basemapTexture?.dispose(), [basemapTexture]);
  const wallGeometry = useMemo(() => createSurfaceGeometry(model.wallPositions, model.wallIndices), [model.wallIndices, model.wallPositions]);
  const neighborGeometry = useMemo(() => neighbors?.indices.length ? createSurfaceGeometry(neighbors.positions, neighbors.indices) : null, [neighbors]);
  useEffect(() => () => neighborGeometry?.dispose(), [neighborGeometry]);
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
  // Shared, unlit bands: annual yield colors do not change with the sun slider.
  const yieldMaterials = useMemo(() => YIELD_COLORS.map(color => {
    const side = new THREE.MeshBasicMaterial({ color: '#64748b' });
    const top = new THREE.MeshBasicMaterial({ color });
    return [side, side, top, side, side, side];
  }), []);
  useEffect(() => () => { for (const set of yieldMaterials) for (const material of new Set(set)) material.dispose(); }, [yieldMaterials]);
  const altitude = sun ? THREE.MathUtils.degToRad(Math.max(-5, sun.altitudeDegrees)) : Math.PI / 4;
  const azimuth = sun ? THREE.MathUtils.degToRad(sun.azimuthDegrees) : Math.PI;
  // With neighbors shown, the light's shadow box widens so their shadows reach the roof.
  const shadowSize = neighborGeometry ? Math.max(size, neighbors?.radiusMeters ?? 0) : size;
  const lightPosition: Position = [
    Math.sin(azimuth) * Math.cos(altitude) * shadowSize,
    Math.max(8, Math.sin(altitude) * shadowSize),
    -Math.cos(azimuth) * Math.cos(altitude) * shadowSize,
  ];

  // Camera commands: frame the roof obliquely, or show it as a flat plan,
  // north up, with an orthographic camera so edges can be traced exactly.
  const plan = view.kind === 'top';
  // Pixels per meter that fit the roof on screen, fixed per command so the
  // wheel zoom is not undone by a resize. The plan camera mounts with it;
  // the controls only reach that camera after this render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const planZoom = useMemo(() => viewport.height / (footprint * fit * 1.2), [footprint, view]);
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || plan) return;
    const reach = footprint * fit;
    controls.object.position.set(reach * 1.1, roofTop + reach * 1.1, reach * 1.3);
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

  // The roof point under the pointer, if any.
  const roofHitAt = useCallback((clientX: number, clientY: number): Position | null => {
    const roof = roofRef.current;
    if (!roof) return null;
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(roof, false)[0];
    return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
  }, [camera, gl, raycaster]);

  // Height of the roof straight below (x, z), looking down from above `nearY`.
  const roofHeightAt = useCallback((x: number, z: number, nearY: number): number | null => {
    const roof = roofRef.current;
    if (!roof) return null;
    const probe = new THREE.Raycaster(new THREE.Vector3(x, nearY + 20, z), new THREE.Vector3(0, -1, 0));
    return probe.intersectObject(roof, false)[0]?.point.y ?? null;
  }, []);

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
      } else if (gesture.kind === 'anchor') {
        const point = roofHitAt(event.clientX, event.clientY);
        if (!point) return;
        setAnchorDrag({ id: gesture.zone.id, points: gesture.zone.points.map((item, index) => (index === gesture.index ? point : item)) });
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
      if (gesture.kind === 'anchor') {
        const point = roofHitAt(event.clientX, event.clientY);
        const outline = point && cleanOutline(gesture.zone.points.map((item, index) => (index === gesture.index ? point : item)));
        if (outline) onUpdateZone(gesture.zone.id, outline);
        setAnchorDrag(null);
      } else if (gesture.kind === 'move' && gesture.started) {
        const point = pointerOnPlane(event.clientX, event.clientY, gesture.plane);
        const dx = point ? point.x - gesture.from.x : 0;
        const dz = point ? point.z - gesture.from.z : 0;
        const seated = gesture.origins.map(([panel, origin]) => [panel.id, reseat(panel, origin[0] + dx, origin[2] + dz)] as const);
        // Dropping any panel off the roof cancels the whole move.
        if (seated.some(([, position]) => position === null)) onCancelGesture();
        else onMovePanels(seated as Array<[number, Position]>, true);
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
  }, [camera, gl, onCancelGesture, onCheckpoint, onMovePanels, onSelect, onUpdateZone, panels, pointerOnPlane, reseat, roofHitAt, setControlsEnabled, setMarquee]);

  const onPanelDown = useCallback((event: ThreeEvent<PointerEvent>, panel: ConceptPanel) => {
    // Keep-out outlines are drawn on the roof, through any panels on it.
    if (!editable || event.button !== 0 || tool === 'zone') return;
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

  // Moving across one instanced mesh reports every pointer move, so a panel
  // counts as entered only when the hovered panel changes.
  const hoveredRef = useRef<number | null>(null);
  const onPanelOver = useCallback((event: ThreeEvent<PointerEvent>, panel: ConceptPanel) => {
    if (!editable || tool === 'add' || tool === 'zone') return;
    event.stopPropagation();
    if (hoveredRef.current === panel.id) return;
    hoveredRef.current = panel.id;
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

  // Leaving a batch clears the hover only if the hovered panel is in it; a
  // hovered panel itself moves to the hover batch.
  const onPanelOut = useCallback((batchPanels: ConceptPanel[]) => {
    const current = hoveredRef.current;
    if (current === null || !batchPanels.some((panel) => panel.id === current)) return;
    hoveredRef.current = null;
    setHoveredId(null);
  }, []);

  // Distance in pixels between two scene points as currently viewed.
  const screenGap = (a: Position, b: Position) => {
    const pa = new THREE.Vector3(...a).project(camera);
    const pb = new THREE.Vector3(...b).project(camera);
    return Math.hypot(((pa.x - pb.x) * viewport.width) / 2, ((pa.y - pb.y) * viewport.height) / 2);
  };

  // The anchor of a finished area under the pointer (while no outline is being drawn).
  const anchorAt = (point: Position): { zone: KeepOutZone; index: number } | null => {
    if (zoneDraft.length) return null;
    for (const zone of zones) {
      const index = zone.points.findIndex((anchor) => screenGap(anchor, point) < ANCHOR_PIXELS);
      if (index >= 0) return { zone, index };
    }
    return null;
  };

  const onRoofDown = (event: ThreeEvent<PointerEvent>) => {
    if (!editable || event.button !== 0 || tool === 'add') return;
    if (tool === 'zone') {
      // Like a pen tool: drag an anchor to reshape an area; Alt-click removes it.
      const grabbed = anchorAt([event.point.x, event.point.y, event.point.z]);
      anchorPressRef.current = grabbed !== null;
      if (!grabbed) return;
      if (event.altKey) {
        const outline = cleanOutline(grabbed.zone.points.filter((_, index) => index !== grabbed.index));
        if (outline) onUpdateZone(grabbed.zone.id, outline);
        return;
      }
      setControlsEnabled(false);
      gestureRef.current = { kind: 'anchor', ...grabbed };
      return;
    }
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

  // Where the next anchor goes: under the pointer, along a 45° step from the
  // last anchor with Shift, or exactly on the first anchor when close to it.
  const penPoint = (event: ThreeEvent<PointerEvent | MouseEvent>): Position => {
    let point: Position = [event.point.x, event.point.y, event.point.z];
    const last = zoneDraft.at(-1);
    if (event.shiftKey && last) {
      const dx = point[0] - last[0];
      const dz = point[2] - last[2];
      const angle = Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const length = dx * Math.cos(angle) + dz * Math.sin(angle);
      const x = last[0] + length * Math.cos(angle);
      const z = last[2] + length * Math.sin(angle);
      point = [x, roofHeightAt(x, z, point[1]) ?? point[1], z];
    }
    const first = zoneDraft[0];
    return zoneDraft.length >= 3 && screenGap(point, first) < ZONE_CLOSE_PIXELS ? first : point;
  };

  const onRoofMove = (event: ThreeEvent<PointerEvent>) => {
    if (!editable || gestureRef.current) return;
    if (tool === 'zone') {
      setZoneCursor(penPoint(event));
      setOverAnchor(anchorAt([event.point.x, event.point.y, event.point.z]) !== null);
    } else if (tool === 'add') {
      setGhost(planPanel([event.point.x, event.point.y, event.point.z], upNormal(event.face)));
    }
  };

  // Close the outline being drawn into a keep-out area; slivers are discarded.
  const finishZone = useCallback((points: Position[]) => {
    const outline = cleanOutline(points);
    if (outline) onAddZone(outline);
    setZoneDraft([]);
  }, [onAddZone]);

  const onRoofClick = (event: ThreeEvent<MouseEvent>) => {
    if (!editable || event.delta > CLICK_TOLERANCE) return;
    if (tool === 'zone') {
      if (anchorPressRef.current) {
        anchorPressRef.current = false;
        return;
      }
      const point = penPoint(event);
      if (zoneDraft.length >= 3 && point === zoneDraft[0]) finishZone(zoneDraft);
      else setZoneDraft([...zoneDraft, point]);
      return;
    }
    if (tool !== 'add') return;
    const plan = planPanel([event.point.x, event.point.y, event.point.z], upNormal(event.face));
    if (plan.valid) onAddPanel(plan.panel);
    setGhost(planPanel([event.point.x, event.point.y, event.point.z], upNormal(event.face)));
  };

  // Enter finishes the outline, Backspace removes its last point. (Escape
  // switches back to Select, which drops the outline.)
  useEffect(() => {
    if (tool !== 'zone') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter') finishZone(zoneDraft);
      else if (event.key === 'Backspace' && zoneDraft.length) {
        event.preventDefault();
        setZoneDraft(zoneDraft.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finishZone, tool, zoneDraft]);

  const hovered = editable && tool !== 'add' && tool !== 'zone' ? hoveredId : null;
  const zoneGrab = tool === 'zone' && (overAnchor || anchorDrag !== null);
  useEffect(() => {
    setCursor(!editable ? 'default'
      : tool === 'zone' ? (zoneGrab ? 'move' : 'crosshair')
        : tool === 'add' ? 'crosshair'
        : tool === 'erase' ? (hovered !== null ? 'pointer' : 'crosshair')
          : hovered !== null ? 'move' : 'default');
  }, [editable, hovered, setCursor, tool, zoneGrab]);

  // Group panels by box shape and look (selection, hover, yield band) into
  // a handful of instanced meshes, so large roofs draw in a few calls.
  const annualRatios = props.annualRatios;
  const batches = useMemo(() => {
    const lookFor = (panel: ConceptPanel): PanelLook => {
      if (!editable) return 'normal';
      if (hovered === panel.id && tool === 'erase') return 'erase';
      if (selected.has(panel.id)) return 'selected';
      if (hovered === panel.id) return 'hover';
      return 'normal';
    };
    const byKey = new Map<string, PanelBatch>();
    for (const panel of panels) {
      const shape = panel.landscape ? 'landscape' : 'portrait';
      const look = lookFor(panel);
      const ratio = look === 'normal' ? annualRatios?.get(panel.id) : undefined;
      const band = ratio === undefined ? null : yieldBand(ratio);
      const key = `${shape}:${band === null ? look : `yield${band}`}`;
      let batch = byKey.get(key);
      if (!batch) {
        batch = { key, geometry: boxes[shape], material: band === null ? materials[shape][look] : yieldMaterials[band], panels: [] };
        byKey.set(key, batch);
      }
      batch.panels.push(panel);
    }
    return [...byKey.values()];
  }, [annualRatios, boxes, editable, hovered, materials, panels, selected, tool, yieldMaterials]);

  // The outline so far plus the pointer, closed when the pointer is on the first point.
  const draftPoints = editable && tool === 'zone' ? zoneDraft : [];
  // penPoint snaps the cursor onto the first anchor when it can close.
  const closing = draftPoints.length >= 3 && zoneCursor === draftPoints[0];
  const penActive = editable && tool === 'zone';
  const drawingPoints = closing ? [...draftPoints, draftPoints[0]] : zoneCursor ? [...draftPoints, zoneCursor] : draftPoints;
  const drawing = draftPoints.length && drawingPoints.length >= 2 ? drawingPoints : null;

  // Areas as shown, with the one being reshaped following its dragged anchor.
  const shownZones = anchorDrag
    ? zones.map((zone) => (zone.id === anchorDrag.id ? { ...zone, points: anchorDrag.points } : zone))
    : zones;

  // The ghost only shows while placing; stale previews from another tool are ignored.
  const preview = editable && tool === 'add' ? ghost : null;

  return (
    <>
      <color attach="background" args={['#e8edf3']} />
      <ambientLight intensity={0.85} />
      <directionalLight position={lightPosition} intensity={sun?.daylight ? 2.1 : 0.25} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-shadowSize} shadow-camera-right={shadowSize} shadow-camera-top={shadowSize} shadow-camera-bottom={-shadowSize} shadow-camera-far={shadowSize * 6} shadow-normalBias={0.15} shadow-bias={-0.0001} />
      {/* Design happens on the roof, so frame the roof footprint, not the whole tower. */}
      {plan ? (
        <OrthographicCamera makeDefault position={[0, roofTop + size * 2, 0.001]} zoom={planZoom} near={0.1} far={Math.max(size * 10, 1500)} />
      ) : (
        <PerspectiveCamera makeDefault position={[footprint * initialFit * 1.1, roofTop + footprint * initialFit * 1.1, footprint * initialFit * 1.3]} fov={40} near={0.1} far={Math.max(size * 10, 1500)} />
      )}
      {/* The plan view only pans and zooms: right-drag pans, the wheel zooms. */}
      <OrbitControls
        key={plan ? 'plan' : 'orbit'}
        ref={controlsRef as never}
        makeDefault
        target={[0, roofTop, 0]}
        enableRotate={!plan}
        minZoom={plan ? viewport.height / (footprint * 6) : 0}
        maxZoom={plan ? viewport.height / 3 : Infinity}
        minDistance={Math.max(4, footprint * 0.12)}
        maxDistance={size * 4}
        maxPolarAngle={Math.PI * 0.49}
      />
      <mesh ref={roofRef} geometry={roofGeometry} castShadow receiveShadow onPointerDown={onRoofDown} onPointerMove={onRoofMove} onPointerOut={() => { setGhost(null); setZoneCursor(null); }} onClick={onRoofClick} onDoubleClick={() => { if (editable && tool === 'zone') finishZone(zoneDraft); }}>
        <meshStandardMaterial key={basemapTexture ? 'imagery' : 'plain'} color={basemapTexture ? '#ffffff' : '#e2e8f0'} map={basemapTexture} roughness={0.78} metalness={0.02} side={THREE.DoubleSide} flatShading />
      </mesh>
      <mesh geometry={wallGeometry} castShadow receiveShadow>
        <meshStandardMaterial color="#a8b2bf" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {neighborGeometry && (
        // Translucent so towers next to the camera never hide the roof being designed;
        // they still cast shadows onto it.
        <mesh geometry={neighborGeometry} castShadow raycast={() => null} renderOrder={1}>
          <meshStandardMaterial color="#c3cad4" roughness={0.95} side={THREE.DoubleSide} transparent opacity={0.38} depthWrite={false} />
        </mesh>
      )}
      {batches.map((batch) => (
        <PanelBatchMesh key={batch.key} batch={batch} onPointerDown={onPanelDown} onPointerOver={onPanelOver} onPointerOut={onPanelOut} />
      ))}
      <RackPosts panels={panels} panelSize={panelSize} material={materials.post} />
      {shownZones.map((zone) => (
        <ZoneMesh
          key={zone.id}
          zone={zone}
          erasing={editable && tool === 'erase'}
          highlighted={(editable && tool === 'erase' && hoveredZone === zone.id) || highlightedZone === zone.id}
          onErase={onRemoveZone}
          onHover={setHoveredZone}
        />
      ))}
      {penActive && shownZones.map((zone) => <Anchors key={zone.id} points={zone.points} texture={anchorDot} size={10} />)}
      {closing && <ZoneMesh zone={{ id: -1, points: draftPoints }} erasing={false} highlighted={false} onErase={onRemoveZone} onHover={setHoveredZone} />}
      {drawing && (
        <Line points={drawing.map(([x, y, z]) => [x, y + ZONE_LIFT, z] as Position)} color={COLORS.zone} lineWidth={2} raycast={() => null} />
      )}
      {draftPoints.length > 0 && <Anchors points={draftPoints} texture={anchorDot} size={11} />}
      {/* The first anchor grows when a click would close the outline. */}
      {closing && <Anchors points={[draftPoints[0]]} texture={anchorDot} size={18} />}
      {preview && (
        <mesh
          geometry={preview.panel.landscape ? boxes.landscape : boxes.portrait}
          material={preview.valid ? materials.ghost : materials.ghostInvalid}
          position={preview.panel.position}
          rotation={panelRotation(preview.panel)}
          raycast={() => null}
        />
      )}
      {basemap && basemapTexture ? (
        <mesh
          rotation-x={-Math.PI / 2}
          position={[(basemap.minX + basemap.maxX) / 2, -0.02, (basemap.minZ + basemap.maxZ) / 2]}
          receiveShadow
          raycast={() => null}
        >
          <planeGeometry args={[basemap.maxX - basemap.minX, basemap.maxZ - basemap.minZ]} />
          <meshStandardMaterial map={basemapTexture} roughness={1} />
        </mesh>
      ) : (
        <Grid args={[size * 1.8, size * 1.8]} cellSize={1} cellThickness={0.4} cellColor="#94a3b8" sectionSize={5} sectionThickness={0.8} sectionColor="#64748b" fadeDistance={size * 1.5} infiniteGrid />
      )}
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
      {props.basemap && (
        <p className="pointer-events-none absolute bottom-1 right-2 max-w-[60%] truncate text-right text-[10px] text-white/90 [text-shadow:0_0_3px_rgba(0,0,0,0.8)]">
          {props.basemap.attribution}
        </p>
      )}
      {marquee && (
        <div
          className="pointer-events-none absolute rounded-[4px] border border-accent bg-accent/12"
          style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
        />
      )}
    </div>
  );
}
