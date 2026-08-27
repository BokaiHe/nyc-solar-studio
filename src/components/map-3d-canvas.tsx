'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { loadGoogleMaps } from '@/lib/google-maps-loader';
import type { PositioningMode } from '@/lib/solar/panel-to-polygon';
import type { CameraState, RenderPanel } from '@/lib/solar/types';

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
  panels: RenderPanel[];
  selectedIndices: ReadonlySet<number>;
  positioningMode: PositioningMode;
  initialCamera?: CameraState;
  onTogglePanel: (index: number) => void;
  onMapError: () => void;
};

const DEFAULT_CAMERA: CameraState = { heading: 25, tilt: 67, range: 260 };

export const Map3DCanvas = forwardRef<Map3DHandle, Map3DCanvasProps>(
  function Map3DCanvas(
    {
      apiKey,
      location,
      panels,
      selectedIndices,
      positioningMode,
      initialCamera,
      onTogglePanel,
      onMapError,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<google.maps.maps3d.Map3DElement | null>(null);
    const polygonRefs = useRef(
      new Map<number, google.maps.maps3d.Polygon3DInteractiveElement>(),
    );
    const [mapReady, setMapReady] = useState(false);
    const onToggleRef = useRef(onTogglePanel);
    const onMapErrorRef = useRef(onMapError);
    const selectedRef = useRef<ReadonlySet<number>>(new Set());

    useEffect(() => {
      onToggleRef.current = onTogglePanel;
    }, [onTogglePanel]);

    useEffect(() => {
      onMapErrorRef.current = onMapError;
    }, [onMapError]);

    useImperativeHandle(ref, () => ({
      getCamera: () => {
        const map = mapRef.current;
        return {
          heading: map?.heading ?? DEFAULT_CAMERA.heading,
          tilt: map?.tilt ?? DEFAULT_CAMERA.tilt,
          range: map?.range ?? DEFAULT_CAMERA.range,
        };
      },
    }));

    useEffect(() => {
      let disposed = false;
      const polygons = polygonRefs.current;

      void loadGoogleMaps(apiKey)
        .then(async () => {
          const { Map3DElement, MapMode } = (await google.maps.importLibrary(
            'maps3d',
          )) as google.maps.Maps3DLibrary;
          if (disposed || !hostRef.current) return;

          const map = new Map3DElement({
            center: {
              lat: 40.7128,
              lng: -74.006,
              altitude: 0,
            },
            range: 18_000,
            tilt: 42,
            heading: 0,
            mode: MapMode.HYBRID,
          });
          map.style.width = '100%';
          map.style.height = '100%';
          map.addEventListener('gmp-error', () => onMapErrorRef.current());
          hostRef.current.replaceChildren(map);
          mapRef.current = map;
          setMapReady(true);
        })
        .catch(() => onMapErrorRef.current());

      return () => {
        disposed = true;
        for (const polygon of polygons.values()) polygon.remove();
        polygons.clear();
        mapRef.current?.remove();
        mapRef.current = null;
        setMapReady(false);
      };
    }, [apiKey]);

    useEffect(() => {
      const map = mapRef.current;
      if (!map || !location) return;
      const camera = initialCamera ?? DEFAULT_CAMERA;
      map.flyCameraTo({
        endCamera: {
          center: {
            lat: location.latitude,
            lng: location.longitude,
            altitude: 20,
          },
          range: camera.range,
          tilt: camera.tilt,
          heading: camera.heading,
        },
        durationMillis: 1_200,
      });
    }, [initialCamera, location]);

    useEffect(() => {
      const map = mapRef.current;
      if (!map || !mapReady) return;
      let cancelled = false;

      void google.maps.importLibrary('maps3d').then((library) => {
        if (cancelled || !mapRef.current) return;
        const { AltitudeMode, Polygon3DInteractiveElement } =
          library as google.maps.Maps3DLibrary;

        for (const polygon of polygonRefs.current.values()) polygon.remove();
        polygonRefs.current.clear();

        for (const panel of panels) {
          const selected = selectedRef.current.has(panel.index);
          const polygon = new Polygon3DInteractiveElement({
            altitudeMode:
              positioningMode === 'ABSOLUTE'
                ? AltitudeMode.ABSOLUTE
                : AltitudeMode.RELATIVE_TO_MESH,
            extruded: false,
            fillColor: selected ? '#155eefb8' : '#ffffff26',
            strokeColor: selected ? '#7dd3fc' : '#ffffffb3',
            strokeWidth: selected ? 3 : 1,
            path: panel.vertices.map((vertex) => ({
              lat: vertex.latitude,
              lng: vertex.longitude,
              altitude: vertex.altitude,
            })),
          });
          polygon.addEventListener('gmp-click', () => onToggleRef.current(panel.index));
          map.append(polygon);
          polygonRefs.current.set(panel.index, polygon);
        }
      });

      return () => {
        cancelled = true;
      };
    }, [mapReady, panels, positioningMode]);

    useEffect(() => {
      selectedRef.current = selectedIndices;
      for (const [index, polygon] of polygonRefs.current) {
        const selected = selectedIndices.has(index);
        polygon.fillColor = selected ? '#155eefb8' : '#ffffff26';
        polygon.strokeColor = selected ? '#7dd3fc' : '#ffffffb3';
        polygon.strokeWidth = selected ? 3 : 1;
      }
    }, [selectedIndices]);

    return <div ref={hostRef} className="absolute inset-0" aria-label="纽约三维地图" />;
  },
);
