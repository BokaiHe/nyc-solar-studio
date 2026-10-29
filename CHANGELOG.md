# Changelog

All notable changes will be documented in this file.

## [Unreleased]

### Changed

- Restructure the app into three steps — select building, 3D design, results — with one step navigation and a light card UI.
- Remove the 2D satellite panel designer; the map now only picks buildings, and the 3D LoD2 roof is the single design surface.
- Load the 3D model without waiting for Google Solar data; Google data is optional context for panel size and energy, and is used to snap street clicks to the nearest building.
- Keep all design state in one reducer (`src/lib/design/state.ts`) with undo/redo; auto layout and share links move to pure modules in `src/lib/design/`.
- Add Ctrl+Z / Ctrl+Shift+Z, Delete and Escape shortcuts; dragging a panel no longer orbits the camera or adds a stray panel.
- Share links now encode only the building and 3D layout (`lat`, `lng`, `bid`, `p3`); older 2D share links are no longer supported.
- Rewrite automatic panel layout: roof surfaces are grouped into planar faces, rasterized with setbacks from real edges and from higher roof parts, and filled with a grid aligned to the building axis. Flat faces get tilted racks; pitched faces get flush panels along the slope.
- Score every candidate position by annual sun exposure with self-shading from the building; positions below 80% of the best exposure (shaded podiums, north slopes) are skipped unless the user includes them. The 320-panel scan cap is gone; an optional limit keeps the best-exposed panels.
- Frame the 3D camera on the roof instead of the middle of tall buildings.
- Rework 3D editing around Select / Place / Erase tools (V / A / E): box-select with Shift to add, move selected groups together, place panels with a live preview that snaps to nearby rows, and erase by dragging. Dragging empty space orbits; right-drag pans.
- Add a selection bar for batch rotate, portrait/landscape, select row / whole roof / all, and delete; whole gestures undo in one step.
- Generate the array automatically on entering design and regenerate it live while settings change, until the layout is edited by hand; then offer to apply new settings instead.
- Compact design panel with collapsible advanced options, reset / top view buttons, and a bottom-sheet layout on phones.
- Draw panels with shared materials, a cell texture and instanced rack posts so large roofs stay responsive.
- Restyle the interface after Apple's design language: system font stack (SF, Segoe UI, PingFang / YaHei), size-specific tracking, translucent materials that respect reduced-transparency and high-contrast settings, iOS system colors, segmented controls and switches.
- Replace number fields with sliders that show their value live (tap the value to type an exact number), including the electricity rate.

- Load original NYC / TUM LoD2 CityGML roof and wall surfaces from a local spatial index.
- Match exact footprints and retain NYC BIN; no GBA or DSM fallback in the 3D route.
- Preserve polygon holes and heights; frame tall buildings and show bare models before manual placement.
- Document historical source and persistent-storage deployment.
- Keep 3D panel layouts when switching between 2D and 3D; results, direct-light share and carbon now follow the 3D layout.
- Share links can carry the 3D layout (`view=3d`, `bid`, `p3`) and reopen it directly in the 3D designer.
- 3D panels use the BESS-Twin module style: navy glass, cell lines, a sunlight-driven glow and rack posts.
- English interface by default, with a header toggle to Chinese; the choice is remembered in the browser.

### Fixed

- 3D panels now tilt toward their chosen azimuth instead of always facing south.
- 3D designer controls no longer overlap the sun and results panels.

### Removed

- Unused Cesium 3D canvas, GBA LoD1 lookup and Solar DSM roof reconstruction.
- `cesium`, `geotiff`, `geotiff-geokeys-to-proj4` and `stream-json` dependencies, the Cesium asset copy step and the GBA index script.

## [0.6.1] - 2026-08-28

### Changed

- Render indexed GBA buildings as clean direct LoD1 footprint extrusions
- Skip DSM raster reconstruction whenever a GBA building match is available

### Fixed

- Removed severe facade stretching and noisy roof triangulation on tall buildings

## [0.6.0] - 2026-08-27

### Added

- Streaming GlobalBuildingAtlas preprocessing for the official NYC-covering 5×5 degree tile
- Local SQLite R-tree containing 1,909,858 footprints with matched LoD1 heights
- Runtime point and nearest-building lookup for arbitrary selections across the NYC metro area
- `GBA_NYC_DB_PATH` override for external database placement

### Changed

- Replaced the single hardcoded demo lookup with the full local spatial index, retaining the verified demo as a missing-index fallback
- Applied GBA footprint and height constraints to any indexed building selected on the 2D map

## [0.5.1] - 2026-08-27

### Added

- Verified GlobalBuildingAtlas LoD1 record for `osm248172169USA`
- Exact single-building footprint constraint for Google DSM roof extraction
- GBA source, building identifier, height and license disclosure in the 3D designer

### Fixed

- Prevented the verified Queens terrace demo from merging with the full connected row of neighboring roofs

## [0.5.0] - 2026-08-27

### Added

- Two-dimensional building selection followed by an isolated three-dimensional roof designer
- Server-side Solar Data Layers DSM and building-mask processing
- Cleaned roof mesh with generated perimeter walls
- Idealized automatic panel arrays with setback and row-spacing controls
- Direct 3D panel placement, dragging, rotation and deletion
- Date-and-time-driven directional sunlight in the isolated scene

### Changed

- Kept the satellite map focused on finding and confirming a building
- Moved detailed panel design to a lightweight local Three.js scene

## [0.4.0] - 2026-08-27

### Added

- OpenSolar-inspired satellite rooftop design workspace
- Building center and bounding-box selection feedback
- Left-side design tools and continuous panel-count control
- Group rotation controls alongside single-panel editing
- Accurate planimetric panel overlays on Google satellite imagery

### Changed

- Made the 2D orthographic roof view the primary design surface
- Reorganized controls around design, sunlight, and results stages
- Reserved local 3D preview for a shared Solar Data Layers/DSM geometry source

## [0.3.1] - 2026-08-27

### Fixed

- Recentered the camera on the Solar API building and the active panel group
- Added an explicit selected-building marker during building focus
- Added immediate roof-fitting feedback after choosing a panel configuration
- Increased design-panel contrast and reduced the default camera distance

## [0.3.0] - 2026-08-27

### Changed

- Reorganized the interface into building focus, design, sunlight, and results modes
- Reduced the persistent map UI to a compact search bar and contextual controls
- Hidden candidate panels until explicit edit mode and limited the initial candidate preview
- Moved the date and time controls into sunlight mode
- Replaced the large solar ray with a compact building-scale sun path
- Added calm blue design panels and sunlight-based colors only during simulation

## [0.2.4] - 2026-08-27

### Fixed

- Roof clamping now samples one center height per panel and preserves the panel plane, preventing roof-edge vertices from stretching down facades
- Panel geometry is no longer re-sampled when time, sunlight color, or selection changes
- Dragging commits one position update on release and safely ends when the pointer leaves the canvas

### Performance

- Reduced detailed mesh samples by 75 percent
- Enabled Cesium request-render mode and disabled per-panel soft shadow work

## [0.2.3] - 2026-08-27

### Fixed

- Panel vertices are sampled against the highest-detail 3D Tiles mesh so layouts follow the visible roof surface
- The sun marker now continues moving along the horizon before sunrise and after sunset while showing its true below-horizon altitude

## [0.2.2] - 2026-08-27

### Fixed

- Date and time controls now use a deterministic server snapshot before synchronizing to New York local time, preventing hydration mismatches

## [0.2.1] - 2026-08-27

### Fixed

- Shared building links now load correctly under React development-mode strict checks

## [0.2.0] - 2026-08-27

### Added

- Cesium viewer with Google Photorealistic 3D Tiles
- Direct building selection from the 3D city
- Roof-panel dragging and 5-degree rotation controls
- Date and time simulation in New York local time
- Animated sun position, daily sun path, light direction and panel incidence preview
- Sun-position and rotated roof-plane geometry tests

### Changed

- Replaced the previous Maps JavaScript 3D renderer with Cesium so the scene can use a simulation clock and editable geometry
- Isolated generated Cesium runtime assets from Git and ESLint

## [0.1.1] - 2026-08-27

### Added

- Reproducible Node version metadata
- Calculation and share-state unit tests
- Shared-layout candidate range validation

## [0.1.0] - 2026-08-27

### Added

- Initial Next.js project structure
- Google 3D Maps and Places integration
- Solar Building Insights server route
- Testable roof-panel geometry conversion
- Interactive candidate panel selection
- Solar summary panel and URL sharing
- Five-borough demo entry points
- GitHub Actions verification workflow
- Roof geometry unit tests
