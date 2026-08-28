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
  showSun: boolean;
  allowPanelEditing: boolean;
  allowLocationSelection: boolean;
  initialCamera?: CameraState;
  onTogglePanel: (index: number) => void;
  onMovePanel: (index: number, center: LatLng) => void;
  onSelectLocation: (location: MapLocation) => void;
  onMapError: (message?: string) => void;
};

const DEFAULT_CAMERA: CameraState = { heading: 25, tilt: 55, range: 240 };

function panelColor(
  C: typeof import('cesium'),
  selected: boolean,
  factor: number,
  daylight: boolean,
  colorBySun: boolean,
) {
  if (!selected) return C.Color.WHITE.withAlpha(0.12);
  if (!colorBySun) return C.Color.fromCssColorString('#075985').withAlpha(0.94);
  if (!daylight) return C.Color.fromCssColorString('#334155').withAlpha(0.9);
  if (factor > 0.75) return C.Color.fromCssColorString('#facc15').withAlpha(0.92);
  if (factor > 0.35) return C.Color.fromCssColorString('#f97316').withAlpha(0.9);
  return C.Color.fromCssColorString('#64748b').withAlpha(0.88);
}

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
      showSun,
      allowPanelEditing,
      allowLocationSelection,
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
    const interactionRef = useRef({ allowPanelEditing, allowLocationSelection });
    const panelVisualsRef = useRef({ selectedIndices, panelLightFactors, daylight: sun?.daylight ?? false, colorBySun: showSun });
    const [ready, setReady] = useState(false);
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
      callbacksRef.current = { onTogglePanel, onMovePanel, onSelectLocation, onMapError };
    }, [onMapError, onMovePanel, onSelectLocation, onTogglePanel]);

    useEffect(() => {
      interactionRef.current = { allowPanelEditing, allowLocationSelection };
    }, [allowLocationSelection, allowPanelEditing]);

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
      let releaseDragListeners: (() => void) | null = null;
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
            requestRenderMode: true,
            maximumRenderTimeChange: Number.POSITIVE_INFINITY,
          });
          viewer.scene.backgroundColor = C.Color.fromCssColorString('#020617');
          viewer.scene.shadowMap.enabled = true;
          viewer.scene.shadowMap.softShadows = false;
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
          let pendingDragCenter: LatLng | null = null;
          let suppressNextClick = false;

          const finishDrag = () => {
            if (dragIndex === null) return;
            if (dragMoved && pendingDragCenter) {
              callbacksRef.current.onMovePanel(dragIndex, pendingDragCenter);
              suppressNextClick = true;
            } else {
              callbacksRef.current.onTogglePanel(dragIndex);
            }
            panelSource.entities.removeById('drag-preview');
            dragIndex = null;
            dragMoved = false;
            pendingDragCenter = null;
            setDragging(false);
            viewer.scene.screenSpaceCameraController.enableInputs = true;
          };
          window.addEventListener('pointerup', finishDrag);
          window.addEventListener('blur', finishDrag);
          releaseDragListeners = () => {
            window.removeEventListener('pointerup', finishDrag);
            window.removeEventListener('blur', finishDrag);
          };

          handler.setInputAction((movement: { position: import('cesium').Cartesian2 }) => {
            if (!interactionRef.current.allowPanelEditing) return;
            const picked = viewer.scene.pick(movement.position) as { id?: Entity } | undefined;
            const index = panelIndexFromEntity(picked?.id);
            if (index === null) return;
            dragIndex = index;
            dragMoved = false;
            pendingDragCenter = null;
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
            pendingDragCenter = {
              latitude: C.Math.toDegrees(cartographic.latitude),
              longitude: C.Math.toDegrees(cartographic.longitude),
            };
            const preview = panelSource.entities.getById('drag-preview');
            if (preview) preview.position = new C.ConstantPositionProperty(position);
            else {
              panelSource.entities.add({
                id: 'drag-preview',
                position,
                point: {
                  pixelSize: 12,
                  color: C.Color.fromCssColorString('#38bdf8'),
                  outlineColor: C.Color.WHITE,
                  outlineWidth: 2,
                  disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
              });
            }
          }, C.ScreenSpaceEventType.MOUSE_MOVE);

          handler.setInputAction(finishDrag, C.ScreenSpaceEventType.LEFT_UP);

          handler.setInputAction((movement: { position: import('cesium').Cartesian2 }) => {
            if (suppressNextClick) {
              suppressNextClick = false;
              return;
            }
            const picked = viewer.scene.pick(movement.position) as { id?: Entity } | undefined;
            if (panelIndexFromEntity(picked?.id) !== null) return;
            if (!interactionRef.current.allowLocationSelection) return;
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
        releaseDragListeners?.();
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
      panelVisualsRef.current = {
        selectedIndices,
        panelLightFactors,
        daylight: sun?.daylight ?? false,
        colorBySun: showSun,
      };
      const source = panelSourceRef.current;
      const C = cesiumRef.current;
      if (!source || !C || !ready) return;
      for (const panel of panels) {
        const entity = source.entities.getById(`solar-panel-${panel.index}`);
        if (!entity?.polygon) continue;
        const selected = selectedIndices.has(panel.index);
        const color = panelColor(
          C,
          selected,
          panelLightFactors.get(panel.index) ?? 0,
          sun?.daylight ?? false,
          showSun,
        );
        entity.polygon.material = new C.ColorMaterialProperty(color);
        entity.polygon.outlineColor = new C.ConstantProperty(
          selected ? C.Color.fromCssColorString('#e0f2fe') : C.Color.WHITE.withAlpha(0.55),
        );
      }
      viewerRef.current?.scene.requestRender();
    }, [panelLightFactors, panels, ready, selectedIndices, showSun, sun?.daylight]);

    useEffect(() => {
      let cancelled = false;
      const viewer = viewerRef.current;
      const source = panelSourceRef.current;
      const C = cesiumRef.current;
      if (!viewer || !source || !C || !ready) return;
      source.entities.removeAll();
      if (panels.length === 0) return;

      const renderPanels = async () => {
        const originalCenterAltitudes = panels.map((panel) =>
          panel.vertices.reduce((total, vertex) => total + vertex.altitude, 0) / panel.vertices.length,
        );
        const cartographics = panels.map((panel, panelOrder) =>
          C.Cartographic.fromDegrees(
            panel.center.longitude,
            panel.center.latitude,
            originalCenterAltitudes[panelOrder],
          ),
        );
        let sampled: Array<import('cesium').Cartographic | undefined> = cartographics;
        if (viewer.scene.sampleHeightSupported) {
          try {
            sampled = await viewer.scene.sampleHeightMostDetailed(cartographics);
          } catch {
            sampled = cartographics;
          }
        }
        if (cancelled) return;

        for (const [panelOrder, panel] of panels.entries()) {
          const visuals = panelVisualsRef.current;
          const selected = visuals.selectedIndices.has(panel.index);
          const color = panelColor(
            C,
            selected,
            visuals.panelLightFactors.get(panel.index) ?? 0,
            visuals.daylight,
            visuals.colorBySun,
          );
          const centerSurface = sampled[panelOrder];
          const altitudeOffset = centerSurface
            ? centerSurface.height - originalCenterAltitudes[panelOrder]
            : 0;
          source.entities.add({
            id: `solar-panel-${panel.index}`,
            polygon: {
              hierarchy: new C.PolygonHierarchy(
                panel.vertices.map((vertex) => {
                  return C.Cartesian3.fromDegrees(
                    vertex.longitude,
                    vertex.latitude,
                    vertex.altitude + altitudeOffset + 0.16,
                  );
                }),
              ),
              perPositionHeight: true,
              material: color,
              outline: true,
              outlineColor: selected ? C.Color.fromCssColorString('#e0f2fe') : C.Color.WHITE.withAlpha(0.55),
              shadows: C.ShadowMode.DISABLED,
            },
          });
        }
        viewer.scene.requestRender();
      };
      void renderPanels();
      return () => {
        cancelled = true;
      };
    }, [panels, ready]);

    useEffect(() => {
      const viewer = viewerRef.current;
      const source = sunSourceRef.current;
      const C = cesiumRef.current;
      if (!viewer || !source || !C || !ready) return;
      source.entities.removeAll();
      if (!showSun || !location || !sun) {
        viewer.scene.requestRender();
        return;
      }
      viewer.clock.currentTime = C.JulianDate.fromDate(sunDate);
      const anchor = C.Cartesian3.fromDegrees(
        location.longitude,
        location.latitude,
        roofHeightMeters + 6,
      );
      const transform = C.Transforms.eastNorthUpToFixedFrame(anchor);
      const toWorld = (azimuthDegrees: number, altitudeDegrees: number, radius = 58) => {
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
            width: 3,
            material: C.Color.fromCssColorString('#fbbf24').withAlpha(0.7),
            depthFailMaterial: C.Color.fromCssColorString('#fbbf24').withAlpha(0.2),
          },
        });
      }
      const visualAltitude = sun.daylight ? sun.altitudeDegrees : 1.5;
      const sunPosition = toWorld(sun.azimuthDegrees, visualAltitude);
      const sunColor = C.Color.fromCssColorString(sun.daylight ? '#fde047' : '#60a5fa');
      source.entities.add({
        id: 'sun-marker',
        position: sunPosition,
        point: {
          pixelSize: sun.daylight ? 18 : 14,
          color: sunColor,
          outlineColor: C.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: sun.daylight ? undefined : {
          text: `地平线下 ${Math.abs(sun.altitudeDegrees).toFixed(1)}°`,
          font: '12px sans-serif',
          fillColor: sunColor,
          pixelOffset: new C.Cartesian2(0, -24),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      source.entities.add({
        id: 'sun-ray',
        polyline: {
          positions: [anchor, sunPosition],
          width: 1.5,
          material: sunColor.withAlpha(sun.daylight ? 0.32 : 0.2),
          depthFailMaterial: sunColor.withAlpha(0.12),
        },
      });
      viewer.scene.requestRender();
    }, [location, ready, roofHeightMeters, showSun, sun, sunDate]);

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
