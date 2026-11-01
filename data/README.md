# NYC / TUM model data

The static application loads compressed model and outline tiles from `public/data/nyc/`. The SQLite indexes under `data/processed/` are used offline to build those tiles. Build the CityGML index with `scripts/index-nyc-citygml.py`, then generate tiles as described in the root README.

- Publisher: NYC Open Data, converted and published by TUM.
- Release: 2017; underlying geometry represents historical surveys.
- Source: https://www.asg.ed.tum.de/en/gis/projects/3d-city-model-of-new-york-city/
- Archive: https://www.3dcitydb.net/3dcitydb/fileadmin/public/datasets/NYC/NYC_buildings_CityGML_LoD2/NYC_Buildings_LoD2_CityGML.zip
- Downloaded: 2026-09-08; archive 2,465,425,579 bytes.
- Archive SHA-256: `57a1f424c5689f74c5a5aab0d93a5e5f9fee7a3b868753d09fc0b20add2b941e`.
- Archive member: `NYC_Buildings_LoD2_CityGML.gml`, 31,779,120,822 bytes.
- CRS: EPSG:32118, meters. Native surface elevations are retained.
- Attribution: NYC Open Data / TUM. Consult original NYC usage terms linked by TUM before redistribution.

The offline index stores original building XML fragments with lossless zlib compression. Tile generation extracts semantic surfaces; the browser loads the resulting geometry and triangulates it for rendering. Building geometry uses the original CityGML surfaces. Rooftop obstacle detection is a separate, optional image-based model.

The building tiles retain the original data providers' rights and terms. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md); the root MIT code license does not cover these datasets.

Completed index: 1,083,437 buildings; 5,219,201,024 bytes. Checked on 2026-09-08 with exact containment and roof raycasting: Queens BIN 4151176, Flatiron BIN 1016278, One WTC BIN 1088469, Empire State BIN 1015862. Heights remain the original model's values, including modeled rooftop structures.

## Historical GlobalBuildingAtlas data

Versions up to v0.6.1 used the GlobalBuildingAtlas tile `w075_n45_w070_n40` and the index `data/processed/gba-nyc.sqlite`. The application and preprocessing script no longer use them; check out tag `v0.6.1` for the GBA pipeline, source checksums and index details. Local copies of these files can be deleted.
