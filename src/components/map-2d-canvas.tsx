'use client';

import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '@/lib/google-maps-loader';
import { useI18n } from '@/lib/i18n';
import type { LatLng } from '@/lib/solar/types';

export type FootprintInfo = { id: string; address: string | null; height: number | null };

type Map2DCanvasProps = {
  apiKey: string;
  location: LatLng | null;
  buildingBounds?: { sw: LatLng; ne: LatLng };
  showMarker: boolean;
  // gml id of the building being designed, highlighted among the outlines.
  selectedBuildingId: string | null;
  onSelectLocation: (location: LatLng) => void;
  onSelectBuilding: (building: FootprintInfo, location: LatLng) => void;
  onHoverBuilding: (building: FootprintInfo | null) => void;
  onOutlinesVisibleChange: (visible: boolean) => void;
  onMapError: (message?: string) => void;
};

const NYC_CENTER = { lat: 40.7128, lng: -74.006 };
// Building outlines appear from street level, where a view spans under ~1.5 km.
const OUTLINE_MIN_ZOOM = 17;
const ACCENT = '#007aff';

type FootprintResponse = { footprints: Array<{ id: string; height: number | null; address: string | null; rings: number[][] }> };

// Satellite map used only to pick a building; all design happens in 3D.
export function Map2DCanvas({ apiKey, location, buildingBounds, showMarker, selectedBuildingId, onSelectLocation, onSelectBuilding, onHoverBuilding, onOutlinesVisibleChange, onMapError }: Map2DCanvasProps) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Circle | null>(null);
  const boundsRef = useRef<google.maps.Rectangle | null>(null);
  const selectedRef = useRef<string | null>(selectedBuildingId);
  const callbacksRef = useRef({ onSelectLocation, onSelectBuilding, onHoverBuilding, onOutlinesVisibleChange, onMapError });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    callbacksRef.current = { onSelectLocation, onSelectBuilding, onHoverBuilding, onOutlinesVisibleChange, onMapError };
  }, [onHoverBuilding, onMapError, onOutlinesVisibleChange, onSelectBuilding, onSelectLocation]);

  useEffect(() => {
    let disposed = false;
    const listeners: google.maps.MapsEventListener[] = [];
    let request: AbortController | null = null;
    // Clicking an outline also reaches the map; ignore that echo.
    let lastOutlineClick = 0;
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
        const outlines = map.data;
        const style = (feature: google.maps.Data.Feature): google.maps.Data.StyleOptions => {
          const selected = feature.getId() === selectedRef.current;
          return {
            fillColor: ACCENT,
            fillOpacity: selected ? 0.38 : 0.06,
            strokeColor: selected ? ACCENT : '#ffffff',
            strokeOpacity: selected ? 1 : 0.75,
            strokeWeight: selected ? 2.5 : 1,
            zIndex: selected ? 2 : 1,
          };
        };
        outlines.setStyle(style);
        const info = (feature: google.maps.Data.Feature): FootprintInfo => ({
          id: String(feature.getId()),
          address: (feature.getProperty('address') as string | null) ?? null,
          height: (feature.getProperty('height') as number | null) ?? null,
        });
        listeners.push(
          outlines.addListener('mouseover', (event: google.maps.Data.MouseEvent) => {
            outlines.overrideStyle(event.feature, { fillOpacity: 0.28, strokeColor: ACCENT, strokeWeight: 2, zIndex: 3 });
            callbacksRef.current.onHoverBuilding(info(event.feature));
          }),
          outlines.addListener('mouseout', (event: google.maps.Data.MouseEvent) => {
            outlines.revertStyle(event.feature);
            callbacksRef.current.onHoverBuilding(null);
          }),
          outlines.addListener('click', (event: google.maps.Data.MouseEvent) => {
            lastOutlineClick = Date.now();
            if (!event.latLng) return;
            callbacksRef.current.onSelectBuilding(info(event.feature), { latitude: event.latLng.lat(), longitude: event.latLng.lng() });
          }),
          map.addListener('click', (event: google.maps.MapMouseEvent) => {
            if (!event.latLng || Date.now() - lastOutlineClick < 300) return;
            callbacksRef.current.onSelectLocation({ latitude: event.latLng.lat(), longitude: event.latLng.lng() });
          }),
          // Load outlines for the view whenever the map comes to rest at street level.
          map.addListener('idle', () => {
            const visible = (map.getZoom() ?? 0) >= OUTLINE_MIN_ZOOM;
            callbacksRef.current.onOutlinesVisibleChange(visible);
            outlines.setStyle(visible ? style : { visible: false });
            const view = map.getBounds();
            if (!visible || !view) return;
            request?.abort();
            request = new AbortController();
            const sw = view.getSouthWest();
            const ne = view.getNorthEast();
            const query = `s=${sw.lat()}&w=${sw.lng()}&n=${ne.lat()}&e=${ne.lng()}`;
            void fetch(`/api/solar/footprints?${query}`, { signal: request.signal })
              .then((response) => (response.ok ? response.json() as Promise<FootprintResponse> : null))
              .then((result) => {
                if (!result || disposed) return;
                for (const footprint of result.footprints) {
                  if (outlines.getFeatureById(footprint.id)) continue;
                  const rings = footprint.rings.map((flat) => {
                    const ring: google.maps.LatLngLiteral[] = [];
                    for (let index = 0; index < flat.length; index += 2) ring.push({ lng: flat[index], lat: flat[index + 1] });
                    return ring;
                  });
                  // Each ground ring is its own outer boundary; a building may have several.
                  outlines.add(new google.maps.Data.Feature({
                    id: footprint.id,
                    geometry: new google.maps.Data.MultiPolygon(rings.map((ring) => [ring])),
                    properties: { address: footprint.address, height: footprint.height },
                  }));
                }
              })
              .catch(() => { /* aborted or unavailable: the map still works by clicking */ });
          }),
        );
        mapRef.current = map;
        setReady(true);
      })
      .catch((error: unknown) => {
        callbacksRef.current.onMapError(error instanceof Error ? error.message : 'Map initialization failed');
      });
    return () => {
      disposed = true;
      request?.abort();
      listeners.forEach((listener) => listener.remove());
      markerRef.current?.setMap(null);
      boundsRef.current?.setMap(null);
      mapRef.current = null;
    };
  }, [apiKey]);

  // Restyle so the selected outline stands out.
  useEffect(() => {
    selectedRef.current = selectedBuildingId;
    const map = mapRef.current;
    if (!map || !ready) return;
    const visible = (map.getZoom() ?? 0) >= OUTLINE_MIN_ZOOM;
    if (visible) map.data.setStyle(map.data.getStyle());
  }, [ready, selectedBuildingId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !location) return;
    map.panTo({ lat: location.latitude, lng: location.longitude });
    if ((map.getZoom() ?? 0) < 19) map.setZoom(19);
  }, [location, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markerRef.current?.setMap(null);
    boundsRef.current?.setMap(null);
    markerRef.current = null;
    boundsRef.current = null;
    // With an outline selected, the outline itself marks the building.
    if (!location || !showMarker || selectedBuildingId) return;
    markerRef.current = new google.maps.Circle({
      map,
      center: { lat: location.latitude, lng: location.longitude },
      radius: 4,
      fillColor: '#38bdf8',
      fillOpacity: 0.25,
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
  }, [buildingBounds, location, ready, selectedBuildingId, showMarker]);

  return (
    <>
      <div ref={hostRef} className="absolute inset-0 bg-slate-900" aria-label={t.map.label} />
      {!ready && <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-950 text-sm text-slate-300">{t.map.loading}</div>}
    </>
  );
}
