# GlobalBuildingAtlas local data

The application expects the official `w075_n45_w070_n40` GlobalBuildingAtlas tile in `data/raw/gba/` and builds a local query index at `data/processed/gba-nyc.sqlite`.

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
