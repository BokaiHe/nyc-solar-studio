# Changelog

All notable changes will be documented in this file.

## [Unreleased]

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
