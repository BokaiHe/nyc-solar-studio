# Architecture decisions

## ADR-001 — Google-first data stack

Use Google 3D Maps, Places and Solar Building Insights so the application can reuse existing globe, search, roof segmentation and energy-estimation capabilities.

## ADR-002 — Server-side Solar API call

The browser calls `/api/solar`; the route handler holds the Solar API key. The browser key remains limited to Maps JavaScript API and Places API with HTTP Referer restrictions.

## ADR-003 — Pure panel geometry

`panelToPolygon()` remains independent from map rendering. It converts Solar panel and roof-segment fields into four geographic vertices. This keeps the geometry testable and reusable by a possible 2D fallback.

## ADR-004 — Polygon panel rendering

Use `Polygon3DInteractiveElement` with `extruded: false`. Candidate and selected states are represented by fill and stroke changes. GLB assets are outside the current scope.

## ADR-005 — No persistent application data

The first release stores no account or project database. Share state is encoded in the URL and Solar data is fetched again when the link opens.

## ADR-006 — Explicit 3D fallback gate

Five roof samples determine whether the project keeps 3D rendering or moves to a 2D satellite overlay. The decision occurs immediately after the visual geometry test.

## ADR-007 — Orthographic design surface

The v0.4 design workflow uses Google satellite imagery as the primary editing surface. Solar panel centers and the roof image now share the same geographic plane, eliminating the unstable height reconciliation between Building Insights and Photorealistic 3D Tiles.

## ADR-008 — Local 3D requires Solar DSM

A future 3D preview must derive its roof mesh from Solar Data Layers DSM and building mask data. Photorealistic city tiles remain outside the editing workflow because they cannot guarantee geometric alignment with Building Insights panel coordinates.

## ADR-009 — Local 3D uses NYC / TUM LoD2

Supersedes ADR-008. The 3D designer renders the selected building's original TUM LoD2 CityGML surfaces from a local SQLite index. Solar DSM reconstruction and GlobalBuildingAtlas LoD1 extrusion are removed from the codebase.

## ADR-010 — Single 3D design surface

Supersedes ADR-003, ADR-004, ADR-006 and ADR-007. The satellite map is used only to select a building; panels are designed exclusively on the NYC / TUM LoD2 roof in 3D. Google Building Insights is optional context and no longer gates the workflow. Design state lives in one reducer so results, sharing and undo read the same source.

## ADR-011 — Face-based layout with self-shading filter

Automatic layout works per planar roof face in face-local coordinates: a 0.2 m raster with setbacks by distance transform, a building-aligned grid chosen from 36 offsets, and annual beam-exposure scoring by ray casting against the building's own roof and walls. A position is kept when it reaches 80% of the best position's exposure, following the common 80% TSRF rule. Surrounding NYC / TUM buildings within 200 m that rise more than tan(3°) per meter of distance above the roof are added as occluders (ADR-012); trees and rooftop equipment are not modeled, so real shading can still be worse.

## ADR-012 — Surrounding buildings as occluders

Neighbor geometry is served separately (`/api/solar/neighbors`) so the selected model appears without waiting. The server keeps only buildings within 200 m whose top rises above the roof by more than the 3° minimum sun altitude allows for their distance, drops faces below the roof, and caches recent results. Rays test each building's bounding box before its triangles. The first automatic layout waits for the neighbors so it is scored once.

## ADR-013 — Own hourly energy model

Annual energy is computed per panel from a month × UTC-hour table of the PVGIS-ERA5 typical meteorological year for New York (2005–2023), shipped as source code so the app has no runtime weather dependency. Plane-of-array light combines beam (with the building, neighbor and row shading already used for layout), isotropic diffuse scaled by the panel's sky view, and roof-reflected light (albedo 0.2); ASHRAE incidence losses, a cell-temperature correction, PVWatts' default 14% system losses and 96% inverter efficiency follow. An unshaded panel at the best tilt yields about 1,360 kWh/kWp, a few percent above NREL PVWatts for New York because ERA5 reads slightly sunnier. Google Solar data is now used only for panel size, wattage and the grid carbon factor.

## ADR-014 — Map footprint index

Footprints for all buildings are extracted once into `data/processed/nyc-footprints.sqlite` (WGS84 rings simplified to 0.2 m, height, address, R-tree on bounds) rather than parsed on demand, so a street-level map view returns in about 0.1 s. The main CityGML index stays read-only. Picking an outline loads the model by gml id; clicking elsewhere still falls back to the point lookup.
