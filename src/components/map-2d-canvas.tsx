'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection } from 'geojson';
import maplibregl, { type GeoJSONSource, type MapGeoJSONFeature } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { ORTHO_ATTRIBUTION, ORTHO_TILE_URL } from '@/lib/map-tiles';
import { outlinesInBounds } from '@/lib/nyc/static-tiles';
import { STUDY_AREA_RINGS } from '@/lib/nyc/study-area';
import type { LatLng } from '@/lib/solar/types';

export type FootprintInfo = { id: string; address: string | null; height: number | null };

type Map2DCanvasProps = {
  location: LatLng | null;
  showMarker: boolean;
  // gml id of the building being designed, highlighted among the outlines.
  selectedBuildingId: string | null;
  onSelectLocation: (location: LatLng) => void;
  onSelectBuilding: (building: FootprintInfo, location: LatLng) => void;
  onHoverBuilding: (building: FootprintInfo | null) => void;
  onOutlinesVisibleChange: (visible: boolean) => void;
  onMapError: (message?: string) => void;
};

const NYC_CENTER: [number, number] = [-74.006, 40.7128];
// Building outlines appear from street level, where a view spans under ~1.5 km.
const OUTLINE_MIN_ZOOM = 17;
// Outlines kept between views, so panning back does not refetch or flicker.
const MAX_KEPT_OUTLINES = 30000;
const ACCENT = '#007aff';
// A frame around the region; the study-area rings are holes cut into it.
const MASK_FRAME = [[-76.5, 38.5], [-71.5, 38.5], [-71.5, 42.5], [-76.5, 42.5], [-76.5, 38.5]];
const closed = (ring: ReadonlyArray<readonly number[]>) => [...ring, ring[0]].map((point) => [...point]);
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

const info = (feature: MapGeoJSONFeature): FootprintInfo => ({
  id: String(feature.properties.id),
  address: (feature.properties.address as string | undefined) || null,
  height: typeof feature.properties.height === 'number' && feature.properties.height >= 0 ? feature.properties.height : null,
});

// Aerial map used only to pick a building; all design happens in 3D.
export function Map2DCanvas({ location, showMarker, selectedBuildingId, onSelectLocation, onSelectBuilding, onHoverBuilding, onOutlinesVisibleChange, onMapError }: Map2DCanvasProps) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const callbacksRef = useRef({ onSelectLocation, onSelectBuilding, onHoverBuilding, onOutlinesVisibleChange, onMapError });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    callbacksRef.current = { onSelectLocation, onSelectBuilding, onHoverBuilding, onOutlinesVisibleChange, onMapError };
  }, [onHoverBuilding, onMapError, onOutlinesVisibleChange, onSelectBuilding, onSelectLocation]);

  useEffect(() => {
    if (!hostRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: hostRef.current,
        center: NYC_CENTER,
        zoom: 11,
        maxZoom: 20.5,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: { compact: true },
        style: {
          version: 8,
          sources: {
            ortho: { type: 'raster', tiles: [ORTHO_TILE_URL], tileSize: 512, maxzoom: 20, attribution: ORTHO_ATTRIBUTION },
            mask: {
              type: 'geojson',
              data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [MASK_FRAME, ...STUDY_AREA_RINGS.map(closed)] } },
            },
            edges: {
              type: 'geojson',
              data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: STUDY_AREA_RINGS.map(closed) } },
            },
            outlines: { type: 'geojson', data: EMPTY, promoteId: 'id' },
            marker: { type: 'geojson', data: EMPTY },
          },
          layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#0f172a' } },
            { id: 'ortho', type: 'raster', source: 'ortho' },
            // Darken everything outside the study area until street level, then fade.
            { id: 'mask', type: 'fill', source: 'mask', paint: { 'fill-color': '#0b1220', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.42, 15, 0.18] } },
            { id: 'edges', type: 'line', source: 'edges', paint: { 'line-color': ACCENT, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 15, 1.5] } },
            {
              id: 'outline-fill', type: 'fill', source: 'outlines', minzoom: OUTLINE_MIN_ZOOM,
              paint: { 'fill-color': ACCENT, 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.28, 0.06] },
            },
            {
              id: 'outline-line', type: 'line', source: 'outlines', minzoom: OUTLINE_MIN_ZOOM,
              paint: {
                'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], ACCENT, '#ffffff'],
                'line-opacity': 0.8,
                'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2, 1],
              },
            },
            { id: 'selected-fill', type: 'fill', source: 'outlines', filter: ['==', ['get', 'id'], ''], paint: { 'fill-color': ACCENT, 'fill-opacity': 0.38 } },
            { id: 'selected-line', type: 'line', source: 'outlines', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': ACCENT, 'line-width': 2.5 } },
            {
              id: 'marker', type: 'circle', source: 'marker',
              paint: { 'circle-radius': 7, 'circle-color': '#38bdf8', 'circle-opacity': 0.35, 'circle-stroke-color': '#e0f2fe', 'circle-stroke-width': 3 },
            },
          ],
        },
      });
    } catch (error) {
      callbacksRef.current.onMapError(error instanceof Error ? error.message : 'Map initialization failed');
      return;
    }

    const kept = new Map<string, Feature>();
    let request = 0;
    let hovered: string | null = null;
    const setHover = (id: string | null) => {
      if (hovered) map.setFeatureState({ source: 'outlines', id: hovered }, { hover: false });
      hovered = id;
      if (id) map.setFeatureState({ source: 'outlines', id }, { hover: true });
    };

    // Load outlines for the view whenever the map comes to rest at street level.
    const refresh = () => {
      const visible = map.getZoom() >= OUTLINE_MIN_ZOOM;
      callbacksRef.current.onOutlinesVisibleChange(visible);
      if (!visible) return;
      const bounds = map.getBounds();
      const current = ++request;
      outlinesInBounds({ south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() })
        .then((outlines) => {
          if (current !== request) return;
          for (const outline of outlines) {
            if (kept.has(outline.id)) continue;
            kept.set(outline.id, {
              type: 'Feature',
              properties: { id: outline.id, address: outline.address ?? '', height: outline.height ?? -1 },
              // Each ground ring is its own outer boundary; a building may have several.
              geometry: {
                type: 'MultiPolygon',
                coordinates: outline.rings.map((flat) => {
                  const ring: number[][] = [];
                  for (let index = 0; index < flat.length; index += 2) ring.push([flat[index], flat[index + 1]]);
                  return [closed(ring)];
                }),
              },
            });
          }
          while (kept.size > MAX_KEPT_OUTLINES) kept.delete(kept.keys().next().value!);
          (map.getSource('outlines') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [...kept.values()] });
        })
        .catch(() => { /* tiles unavailable: the map still works by clicking */ });
    };

    map.on('load', () => {
      mapRef.current = map;
      setReady(true);
      refresh();
    });
    map.on('moveend', refresh);
    map.on('mousemove', 'outline-fill', (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      map.getCanvas().style.cursor = 'pointer';
      if (hovered === String(feature.properties.id)) return;
      setHover(String(feature.properties.id));
      callbacksRef.current.onHoverBuilding(info(feature));
    });
    map.on('mouseleave', 'outline-fill', () => {
      map.getCanvas().style.cursor = '';
      setHover(null);
      callbacksRef.current.onHoverBuilding(null);
    });
    map.on('click', (event) => {
      const point = { latitude: event.lngLat.lat, longitude: event.lngLat.lng };
      const feature = map.queryRenderedFeatures(event.point, { layers: ['outline-fill'] })[0];
      if (feature) callbacksRef.current.onSelectBuilding(info(feature), point);
      else callbacksRef.current.onSelectLocation(point);
    });

    return () => {
      request += 1;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Highlight the selected outline.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const filter: maplibregl.FilterSpecification = ['==', ['get', 'id'], selectedBuildingId ?? ''];
    map.setFilter('selected-fill', filter);
    map.setFilter('selected-line', filter);
  }, [ready, selectedBuildingId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !location) return;
    map.easeTo({ center: [location.longitude, location.latitude], zoom: Math.max(map.getZoom(), 19) });
  }, [location, ready]);

  // A dot where the user clicked, until an outline marks the building.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const show = location && showMarker && !selectedBuildingId;
    (map.getSource('marker') as GeoJSONSource).setData(show
      ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [location.longitude, location.latitude] } }
      : EMPTY);
  }, [location, ready, selectedBuildingId, showMarker]);

  return (
    <>
      {/* MapLibre makes its container position: relative, so it fills an absolute wrapper. */}
      <div className="absolute inset-0 bg-slate-900">
        <div ref={hostRef} className="h-full w-full" aria-label={t.map.label} />
      </div>
      {!ready && <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-950 text-sm text-slate-300">{t.map.loading}</div>}
    </>
  );
}
