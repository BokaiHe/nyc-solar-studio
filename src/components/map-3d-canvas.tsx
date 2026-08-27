'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { sunPathForDate } from '@/lib/solar/sun';
import type {
  CameraState,
  LatLng,
  RenderPanel,
  SunSnapshot,
} from '@/lib/solar/types';
import type {
  CustomDataSource,
  Entity,
  ScreenSpaceEventHandler,
  Viewer,
} from 'cesium';

export type MapLocation = {
  latitude: number;
  longitude: number;
};

export type Map3DHandle = {
  getCamera: () => CameraState;
};

type Map3DCanvasProps = {
  apiKey: string;
  location: MapLocation | null;
  roofHeightMeters: number;
  panels: RenderPanel[];
  selectedIndices: ReadonlySet<number>;
  panelLightFactors: ReadonlyMap<number, number>;
  sunDate: Date;
  sun: SunSnapshot | null;
  initialCamera?: CameraState;
  onTogglePanel: (index: number) => void;
  onMovePanel: (index: number, center: LatLng) => void;
  onSelectLocation: (location: MapLocation) => void;
  onMapError: (message?: string) => void;
};

const DEFAULT_CAMERA: CameraState = { heading: 25, tilt: 55, range: 240 };

function panelIndexFromEntity(entity: Entity | undefined): number | null {
  if (!entity?.id.startsWith('solar-panel-')) return null;
  const index = Number(entity.id.slice('solar-panel-'.length));
  return Number.isInteger(index) ? index : null;
}

export const Map3DCanvas = forwardRef<Map3DHandle, Map3DCanvasProps>(
  function Map3DCanvas(
    {
      apiKey,
      location,
      roofHeightMeters,
      panels,
      selectedIndices,
      panelLightFactors,
      sunDate,
      sun,
      initialCamera,
      onTogglePanel,
      onMovePanel,
      onSelectLocation,
      onMapError,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<Viewer | null>(null);
    const cesiumRef = useRef<typeof import('cesium') | null>(null);
    const panelSourceRef = useRef<CustomDataSource | null>(null);
    const sunSourceRef = useRef<CustomDataSource | null>(null);
    const handlerRef = useRef<ScreenSpaceEventHandler | null>(null);
    const callbacksRef = useRef({ onTogglePanel, onMovePanel, onSelectLocation, onMapError });
    const [ready, setReady] = useState(false);
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
      callbacksRef.current = { onTogglePanel, onMovePanel, onSelectLocation, onMapError };
    }, [onMapError, onMovePanel, onSelectLocation, onTogglePanel]);

    useImperativeHandle(ref, () => ({
      getCamera: () => {
        const viewer = viewerRef.current;
        const C = cesiumRef.current;
        if (!viewer || !C) return DEFAULT_CAMERA;
        return {
          heading: C.Math.toDegrees(viewer.camera.heading),
          tilt: 90 + C.Math.toDegrees(viewer.camera.pitch),
          range: viewer.camera.positionCartographic.height,
        };
      },
    }));

    useEffect(() => {
      let disposed = false;
      const host = hostRef.current;
      if (!host) return;
      (window as typeof window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = '/cesium/';

      void import('cesium')
        .then(async (C) => {
          if (disposed || !hostRef.current) return;
          cesiumRef.current = C;
          const viewer = new C.Viewer(hostRef.current, {
            animation: false,
            timeline: false,
            baseLayerPicker: false,
            geocoder: false,
            homeButton: false,
            sceneModePicker: false,
            navigationHelpButton: false,
            fullscreenButton: false,
            infoBox: false,
            selectionIndicator: false,
            baseLayer: false,
            globe: false,
            scene3DOnly: true,
            shadows: true,
            requestRenderMode: false,
          });
          viewer.scene.backgroundColor = C.Color.fromCssColorString('#020617');
          viewer.scene.shadowMap.enabled = true;
          viewer.scene.shadowMap.softShadows = true;
          viewer.scene.highDynamicRange = true;

          const panelSource = new C.CustomDataSource('solar-panels');
          const sunSource = new C.CustomDataSource('solar-sun');
          await viewer.dataSources.add(panelSource);
          await viewer.dataSources.add(sunSource);
          panelSourceRef.current = panelSource;
          sunSourceRef.current = sunSource;

          const tileset = await C.createGooglePhotorealistic3DTileset({
            key: apiKey,
            onlyUsingWithGoogleGeocoder: true,
          });
          tileset.shadows = C.ShadowMode.ENABLED;
          viewer.scene.primitives.add(tileset);

          const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
          handlerRef.current = handler;
          let dragIndex: number | null = null;
          let dragMoved = false;

          handler.setInputAction((movement: { position: import('cesium').Cartesian2 }) => {
            const picked = viewer.scene.pick(movement.position) as { id?: Entity } | undefined;
            const index = panelIndexFromEntity(picked?.id);
            if (index === null) return;
            dragIndex = index;
            dragMoved = false;
            setDragging(true);
            viewer.scene.screenSpaceCameraController.enableInputs = false;
          }, C.ScreenSpaceEventType.LEFT_DOWN);

          handler.setInputAction((movement: { endPosition: import('cesium').Cartesian2 }) => {
            if (dragIndex === null || !viewer.scene.pickPositionSupported) return;
            const entity = panelSource.entities.getById(`solar-panel-${dragIndex}`);
            if (entity) entity.show = false;
            viewer.scene.render(viewer.clock.currentTime);
            const position = viewer.scene.pickPosition(movement.endPosition);
            if (entity) entity.show = true;
            if (!C.defined(position)) return;
            const cartographic = C.Cartographic.fromCartesian(position);
            dragMoved = true;
            callbacksRef.current.onMovePanel(dragIndex, {
              latitude: C.Math.toDegrees(cartographic.latitude),
              longitude: C.Math.toDegrees(cartographic.longitude),
            });
          }, C.ScreenSpaceEventType.MOUSE_MOVE);

          handler.setInputAction(() => {
            if (dragIndex !== null && !dragMoved) callbacksRef.current.onTogglePanel(dragIndex);
            dragIndex = null;
            dragMoved = false;
            setDragging(false);
            viewer.scene.screenSpaceCameraController.enableInputs = true;
          }, C.ScreenSpaceEventType.LEFT_UP);

          handler.setInputAction((movement: { position: import('cesium').Cartesian2 }) => {
            const picked = viewer.scene.pick(movement.position) as { id?: Entity } | undefined;
            if (panelIndexFromEntity(picked?.id) !== null) return;
            if (!viewer.scene.pickPositionSupported) return;
            const position = viewer.scene.pickPosition(movement.position);
            if (!C.defined(position)) return;
            const cartographic = C.Cartographic.fromCartesian(position);
            callbacksRef.current.onSelectLocation({
              latitude: C.Math.toDegrees(cartographic.latitude),
              longitude: C.Math.toDegrees(cartographic.longitude),
            });
          }, C.ScreenSpaceEventType.LEFT_CLICK);

          if (!disposed) {
            viewerRef.current = viewer;
            setReady(true);
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Cesium initialization failed';
          callbacksRef.current.onMapError(message);
        });

      return () => {
        disposed = true;
        handlerRef.current?.destroy();
        handlerRef.current = null;
        if (viewerRef.current && !viewerRef.current.isDestroyed()) viewerRef.current.destroy();
        viewerRef.current = null;
        panelSourceRef.current = null;
        sunSourceRef.current = null;
        setReady(false);
      };
    }, [apiKey]);

    useEffect(() => {
      const viewer = viewerRef.current;
      const C = cesiumRef.current;
      if (!viewer || !C || !ready || !location) return;
      const camera = initialCamera ?? DEFAULT_CAMERA;
      const target = C.Cartesian3.fromDegrees(location.longitude, location.latitude, roofHeightMeters);
      viewer.camera.lookAt(
        target,
        new C.HeadingPitchRange(
          C.Math.toRadians(camera.heading),
          C.Math.toRadians(-Math.max(20, camera.tilt)),
          Math.max(90, camera.range),
        ),
      );
      viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
    }, [initialCamera, location, ready, roofHeightMeters]);

    useEffect(() => {
      const source = panelSourceRef.current;
      const C = cesiumRef.current;
      if (!source || !C || !ready) return;
      source.entities.removeAll();
      for (const panel of panels) {
        const selected = selectedIndices.has(panel.index);
        const factor = panelLightFactors.get(panel.index) ?? 0;
        const color = !selected
          ? C.Color.WHITE.withAlpha(0.12)
          : !sun?.daylight
            ? C.Color.fromCssColorString('#334155').withAlpha(0.9)
            : factor > 0.75
              ? C.Color.fromCssColorString('#facc15').withAlpha(0.92)
              : factor > 0.35
                ? C.Color.fromCssColorString('#f97316').withAlpha(0.9)
                : C.Color.fromCssColorString('#64748b').withAlpha(0.88);
        source.entities.add({
          id: `solar-panel-${panel.index}`,
          polygon: {
            hierarchy: new C.PolygonHierarchy(
              panel.vertices.map((vertex) =>
                C.Cartesian3.fromDegrees(vertex.longitude, vertex.latitude, vertex.altitude),
              ),
            ),
            perPositionHeight: true,
            material: color,
            outline: true,
            outlineColor: selected ? C.Color.fromCssColorString('#e0f2fe') : C.Color.WHITE.withAlpha(0.55),
            shadows: C.ShadowMode.ENABLED,
          },
        });
      }
    }, [panelLightFactors, panels, ready, selectedIndices, sun?.daylight]);

    useEffect(() => {
      const viewer = viewerRef.current;
      const source = sunSourceRef.current;
      const C = cesiumRef.current;
      if (!viewer || !source || !C || !ready || !location || !sun) return;
      viewer.clock.currentTime = C.JulianDate.fromDate(sunDate);
      source.entities.removeAll();
      const anchor = C.Cartesian3.fromDegrees(
        location.longitude,
        location.latitude,
        roofHeightMeters + 6,
      );
      const transform = C.Transforms.eastNorthUpToFixedFrame(anchor);
      const toWorld = (azimuthDegrees: number, altitudeDegrees: number, radius = 135) => {
        const azimuth = C.Math.toRadians(azimuthDegrees);
        const altitude = C.Math.toRadians(altitudeDegrees);
        const local = new C.Cartesian3(
          Math.sin(azimuth) * Math.cos(altitude) * radius,
          Math.cos(azimuth) * Math.cos(altitude) * radius,
          Math.sin(altitude) * radius,
        );
        return C.Matrix4.multiplyByPoint(transform, local, new C.Cartesian3());
      };
      const path = sunPathForDate(sunDate, location.latitude, location.longitude);
      if (path.length > 1) {
        source.entities.add({
          id: 'sun-path',
          polyline: {
            positions: path.map((point) => toWorld(point.azimuthDegrees, point.altitudeDegrees)),
            width: 4,
            material: C.Color.fromCssColorString('#fbbf24').withAlpha(0.8),
            depthFailMaterial: C.Color.fromCssColorString('#fbbf24').withAlpha(0.25),
          },
        });
      }
      if (sun.daylight) {
        const sunPosition = toWorld(sun.azimuthDegrees, sun.altitudeDegrees);
        source.entities.add({
          id: 'sun-marker',
          position: sunPosition,
          point: {
            pixelSize: 18,
            color: C.Color.fromCssColorString('#fde047'),
            outlineColor: C.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        source.entities.add({
          id: 'sun-ray',
          polyline: {
            positions: [anchor, sunPosition],
            width: 2,
            material: C.Color.fromCssColorString('#fde047').withAlpha(0.45),
          },
        });
      }
    }, [location, ready, roofHeightMeters, sun, sunDate]);

    return (
      <>
        <div ref={hostRef} className="absolute inset-0" aria-label="纽约三维太阳能设计地图" />
        {!ready && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-950 text-sm text-slate-300">
            正在加载三维城市…
          </div>
        )}
        {dragging && (
          <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 rounded-full bg-sky-500 px-4 py-2 text-xs font-semibold text-white shadow-xl">
            拖动光伏板，松开完成放置
          </div>
        )}
      </>
    );
  },
);
