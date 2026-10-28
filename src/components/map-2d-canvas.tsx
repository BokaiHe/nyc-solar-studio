'use client';

import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '@/lib/google-maps-loader';
import { useI18n } from '@/lib/i18n';
import type { LatLng } from '@/lib/solar/types';

type Map2DCanvasProps = {
  apiKey: string;
  location: LatLng | null;
  buildingBounds?: { sw: LatLng; ne: LatLng };
  showMarker: boolean;
  onSelectLocation: (location: LatLng) => void;
  onMapError: (message?: string) => void;
};

const NYC_CENTER = { lat: 40.7128, lng: -74.006 };

// Satellite map used only to pick a building; all design happens in 3D.
export function Map2DCanvas({ apiKey, location, buildingBounds, showMarker, onSelectLocation, onMapError }: Map2DCanvasProps) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Circle | null>(null);
  const boundsRef = useRef<google.maps.Rectangle | null>(null);
  const callbacksRef = useRef({ onSelectLocation, onMapError });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    callbacksRef.current = { onSelectLocation, onMapError };
  }, [onMapError, onSelectLocation]);

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
          if (!event.latLng) return;
          callbacksRef.current.onSelectLocation({ latitude: event.latLng.lat(), longitude: event.latLng.lng() });
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
      markerRef.current?.setMap(null);
      boundsRef.current?.setMap(null);
      mapRef.current = null;
    };
  }, [apiKey]);

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
    if (!location || !showMarker) return;
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
  }, [buildingBounds, location, ready, showMarker]);

  return (
    <>
      <div ref={hostRef} className="absolute inset-0 bg-slate-900" aria-label={t.map.label} />
      {!ready && <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-950 text-sm text-slate-300">{t.map.loading}</div>}
    </>
  );
}
