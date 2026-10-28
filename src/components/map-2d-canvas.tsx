'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { loadGoogleMaps } from '@/lib/google-maps-loader';
import { useI18n } from '@/lib/i18n';
import type { CameraState, LatLng, RenderPanel } from '@/lib/solar/types';

export type MapLocation = { latitude: number; longitude: number };
export type MapCanvasHandle = { getCamera: () => CameraState };

type Map2DCanvasProps = {
  apiKey: string;
  location: MapLocation | null;
  buildingBounds?: { sw: LatLng; ne: LatLng };
  panels: RenderPanel[];
  selectedIndices: ReadonlySet<number>;
  panelLightFactors: ReadonlyMap<number, number>;
  colorBySun: boolean;
  allowPanelEditing: boolean;
  allowLocationSelection: boolean;
  showBuildingMarker: boolean;
  onTogglePanel: (index: number) => void;
  onMovePanel: (index: number, center: LatLng) => void;
  onSelectLocation: (location: MapLocation) => void;
  onMapError: (message?: string) => void;
};

const NYC_CENTER = { lat: 40.7128, lng: -74.006 };

function fillColor(selected: boolean, factor: number, colorBySun: boolean) {
  if (!selected) return '#e2e8f0';
  if (!colorBySun) return '#0284c7';
  if (factor > 0.75) return '#facc15';
  if (factor > 0.35) return '#f97316';
  return '#64748b';
}

function polygonCenter(path: google.maps.MVCArray<google.maps.LatLng>): LatLng {
  let latitude = 0;
  let longitude = 0;
  path.forEach((point) => {
    latitude += point.lat();
    longitude += point.lng();
  });
  return {
    latitude: latitude / Math.max(1, path.getLength()),
    longitude: longitude / Math.max(1, path.getLength()),
  };
}

export const Map2DCanvas = forwardRef<MapCanvasHandle, Map2DCanvasProps>(function Map2DCanvas(
  {
    apiKey,
    location,
    buildingBounds,
    panels,
    selectedIndices,
    panelLightFactors,
    colorBySun,
    allowPanelEditing,
    allowLocationSelection,
    showBuildingMarker,
    onTogglePanel,
    onMovePanel,
    onSelectLocation,
    onMapError,
  },
  ref,
) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const markerRef = useRef<google.maps.Circle | null>(null);
  const boundsRef = useRef<google.maps.Rectangle | null>(null);
  const callbacksRef = useRef({ onTogglePanel, onMovePanel, onSelectLocation, onMapError });
  const interactionRef = useRef({ allowPanelEditing, allowLocationSelection });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    callbacksRef.current = { onTogglePanel, onMovePanel, onSelectLocation, onMapError };
  }, [onMapError, onMovePanel, onSelectLocation, onTogglePanel]);

  useEffect(() => {
    interactionRef.current = { allowPanelEditing, allowLocationSelection };
  }, [allowLocationSelection, allowPanelEditing]);

  useImperativeHandle(ref, () => ({
    getCamera: () => ({ heading: 0, tilt: 0, range: mapRef.current?.getZoom() ?? 20 } satisfies CameraState),
  }));

  useEffect(() => {
    let disposed = false;
    let clickListener: google.maps.MapsEventListener | null = null;
    void loadGoogleMaps(apiKey)
      .then(async () => {
        await google.maps.importLibrary('maps');
        if (disposed || !hostRef.current) return;
        const map = new google.maps.Map(hostRef.current, {
          center: NYC_CENTER,
          zoom: 12,
          mapTypeId: 'satellite',
          tilt: 0,
          heading: 0,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          keyboardShortcuts: false,
        });
        clickListener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
          if (!interactionRef.current.allowLocationSelection || !event.latLng) return;
          callbacksRef.current.onSelectLocation({
            latitude: event.latLng.lat(),
            longitude: event.latLng.lng(),
          });
        });
        mapRef.current = map;
        setReady(true);
      })
      .catch((error: unknown) => {
        callbacksRef.current.onMapError(error instanceof Error ? error.message : 'Map initialization failed');
      });
    return () => {
      disposed = true;
      clickListener?.remove();
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      markerRef.current?.setMap(null);
      boundsRef.current?.setMap(null);
      mapRef.current = null;
    };
  }, [apiKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !location) return;
    map.panTo({ lat: location.latitude, lng: location.longitude });
    if ((map.getZoom() ?? 0) < 20) map.setZoom(20);
  }, [location, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markerRef.current?.setMap(null);
    boundsRef.current?.setMap(null);
    markerRef.current = null;
    boundsRef.current = null;
    if (!location || !showBuildingMarker) return;
    markerRef.current = new google.maps.Circle({
      map,
      center: { lat: location.latitude, lng: location.longitude },
      radius: 5,
      fillColor: '#38bdf8',
      fillOpacity: 0.2,
      strokeColor: '#e0f2fe',
      strokeOpacity: 1,
      strokeWeight: 3,
      clickable: false,
      zIndex: 1000,
    });
    if (buildingBounds) {
      boundsRef.current = new google.maps.Rectangle({
        map,
        bounds: {
          south: buildingBounds.sw.latitude,
          west: buildingBounds.sw.longitude,
          north: buildingBounds.ne.latitude,
          east: buildingBounds.ne.longitude,
        },
        fillColor: '#38bdf8',
        fillOpacity: 0.08,
        strokeColor: '#7dd3fc',
        strokeOpacity: 0.95,
        strokeWeight: 2,
        clickable: false,
        zIndex: 5,
      });
    }
  }, [buildingBounds, location, ready, showBuildingMarker]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = panels.map((panel) => {
      const selected = selectedIndices.has(panel.index);
      const polygon = new google.maps.Polygon({
        map,
        paths: panel.vertices.map((vertex) => ({ lat: vertex.latitude, lng: vertex.longitude })),
        fillColor: fillColor(selected, panelLightFactors.get(panel.index) ?? 0, colorBySun),
        fillOpacity: selected ? 0.9 : 0.18,
        strokeColor: selected ? '#f8fafc' : '#bae6fd',
        strokeOpacity: selected ? 1 : 0.7,
        strokeWeight: selected ? 1.5 : 1,
        clickable: allowPanelEditing,
        draggable: allowPanelEditing && selected,
        editable: false,
        geodesic: false,
        zIndex: selected ? 20 : 10,
      });
      polygon.addListener('click', () => {
        if (interactionRef.current.allowPanelEditing) callbacksRef.current.onTogglePanel(panel.index);
      });
      polygon.addListener('dragend', () => {
        if (!interactionRef.current.allowPanelEditing) return;
        callbacksRef.current.onMovePanel(panel.index, polygonCenter(polygon.getPath()));
      });
      return polygon;
    });
    return () => {
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      polygonsRef.current = [];
    };
  }, [allowPanelEditing, colorBySun, panelLightFactors, panels, ready, selectedIndices]);

  return (
    <>
      <div ref={hostRef} className="absolute inset-0 bg-slate-900" aria-label={t.map.label} />
      {!ready && <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-950 text-sm text-slate-300">{t.map.loading}</div>}
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-slate-950/75 px-3 py-1.5 text-[11px] text-white/80 backdrop-blur-md">
        {t.map.hint}
      </div>
    </>
  );
});
