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
