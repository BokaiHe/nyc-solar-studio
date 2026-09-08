# NYC / TUM model data

The active 3D model route reads `data/processed/nyc-citygml.sqlite`. Build it with `scripts/index-nyc-citygml.py` (see root README).

- Publisher: NYC Open Data, converted and published by TUM.
- Release: 2017; underlying geometry represents historical surveys.
- Source: https://www.asg.ed.tum.de/en/gis/projects/3d-city-model-of-new-york-city/
- Archive: https://www.3dcitydb.net/3dcitydb/fileadmin/public/datasets/NYC/NYC_buildings_CityGML_LoD2/NYC_Buildings_LoD2_CityGML.zip
- Downloaded: 2026-09-08; archive 2,465,425,579 bytes.
- Archive SHA-256: `57a1f424c5689f74c5a5aab0d93a5e5f9fee7a3b868753d09fc0b20add2b941e`.
- Archive member: `NYC_Buildings_LoD2_CityGML.gml`, 31,779,120,822 bytes.
- CRS: EPSG:32118, meters. Native surface elevations are retained.
- Attribution: NYC Open Data / TUM. Consult original NYC usage terms linked by TUM before redistribution.

The index stores original building XML fragments with lossless zlib compression. Runtime parses the selected building's semantic surfaces and triangulates them for rendering. No machine-learning inference is performed.

Completed index: 1,083,437 buildings; 5,219,201,024 bytes. Checked on 2026-09-08 with exact containment and roof raycasting: Queens BIN 4151176, Flatiron BIN 1016278, One WTC BIN 1088469, Empire State BIN 1015862. Heights remain the original model's values, including modeled rooftop structures.

## Historical GlobalBuildingAtlas data

Earlier application versions used the official `w075_n45_w070_n40` tile in `data/raw/gba/` and the index `data/processed/gba-nyc.sqlite`. These files are retained; the active 3D model route does not use them.

## Verified source files

| File | Size (bytes) | SHA-256 |
| --- | ---: | --- |
| `w075_n45_w070_n40.odbl.geojson` | 6,917,966,554 | `0ca2ae47de87f710e240202f70ee0631cf0197abe979fc4adc897db1a8ef2db1` |
| `w075_n45_w070_n40.lod1.json` | 1,008,804,383 | `459ee1c25b8e04d80a4edbdd50381f485fe17f6d3c9674f519a15794ac1024d1` |
| `w075_n45_w070_n40.part2.geojson` | 30,787,622 | `dbff5c732e9b284bd59b960f8dd66e14fa0ac751934d19967e37b1337eadec64` |

Downloaded and verified on 2026-08-27 from the official GlobalBuildingAtlas release. The coordinate arrays are interpreted as EPSG:3857 according to the project FAQ.

## Generated index

- Bounds: `-74.30, 40.45, -73.65, 40.95`
- Footprints: 1,909,858
- Footprints with LoD1 height: 1,909,858
- SQLite size: 1,250,324,480 bytes

Run `npm run data:build-gba-nyc` to reproduce the index. Raw and generated datasets are intentionally excluded from Git.

Review the ODbL and CC BY-NC 4.0 dataset terms before redistribution or public deployment.
