# Third-party materials and data sources

The root [MIT license](LICENSE) covers this project's original code and documentation text. It does not relicense third-party materials. Preserve upstream attribution and license notices when redistributing the application or its assets. Public download access alone does not establish an unrestricted reuse license.

## NYC / TUM building geometry

- Files: `public/data/nyc/`, plus locally generated indexes under `data/processed/`.
- Origin: NYC Open Data / NYC DoITT building data, converted to LoD2 CityGML by the Chair of Geoinformatics, Technical University of Munich.
- [TUM project, downloads and terms](https://www.asg.ed.tum.de/gis/projekte/new-york-city-3d/); [NYC terms of use](https://www.nyc.gov/main/terms-of-use).
- TUM permits free use subject to the original NYC terms and disclaims warranties. Rights in the source datasets remain with their respective providers. TUM's CityGML objects contain external references to source datasets.
- This project transforms coordinates, triangulates surfaces, simplifies map outlines and packages geometry into compressed static tiles. These transformations do not transfer ownership of the underlying data. The original archive and checksum are recorded in [data/README.md](data/README.md).

This is the historical NYC LoD2 dataset. GlobalBuildingAtlas is a separate dataset used by earlier revisions; consult the source notices in those revisions before reusing their outputs. The current building tiles are not licensed under this project's MIT grant.

## Imagery, LiDAR and geographic services

| Material | Source and use | Terms / attribution |
|---|---|---|
| NYS orthoimagery | [NYS GIS orthoimagery program](https://gis.ny.gov/orthoimagery); 2014 map imagery, 2014/2016/2018 training imagery | Retain NYS ITS Geospatial Services attribution and consult the relevant imagery metadata and provider terms. No independent MIT grant is made for imagery. |
| NYC 2017 topobathymetric LiDAR | [NOAA distribution](https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/laz/geoid18/9306/index.html); offline label generation | Credit NYC and NOAA Office for Coastal Management; retain the source dataset's metadata and use constraints. Raw LiDAR and training crops are not committed. |
| Address search | [NYC Planning Labs GeoSearch](https://geosearch.planninglabs.nyc/) | External service with its own availability and usage conditions; this project's license grants no rights over the service. |

Screenshots, recordings, notebook image outputs and figures that contain aerial imagery or building data retain the underlying source terms. They are excluded from the root MIT grant even when their annotations or layout were created for this project.

## Climate and reference values

- `src/lib/solar/nyc-climate.ts` contains derived monthly/hourly summaries of **PVGIS-ERA5 TMY 2005–2023**, at 40.7128, -74.006. Credit the European Commission Joint Research Centre / PVGIS and the underlying ERA5 source. See [PVGIS](https://re.jrc.ec.europa.eu/pvg_tools/en/) for source information and linked legal notices. The generation script is project code; the data table retains its source conditions.
- Grid emissions values are derived from **EPA eGRID2023, NYCW**. See [EPA eGRID](https://www.epa.gov/egrid).
- The household refrigerator equivalence uses **EIA RECS 2020**. See [EIA Residential Energy Consumption Survey](https://www.eia.gov/consumption/residential/).
- Mentioning these sources does not imply endorsement by their providers.

## Rooftop obstacle model

- File: `public/models/roof-obstacles.onnx`.
- Architecture: U-Net with a MobileNetV2 encoder; fine-tuned using NYS imagery and NYC LiDAR-derived labels. Training code is in `ml/train/` and reported evaluation is in `ml/unet-results.ipynb`.
- Training uses ImageNet-pretrained initialization through [segmentation_models_pytorch](https://github.com/qubvel-org/segmentation_models.pytorch). The broader training stack includes [timm](https://github.com/huggingface/pytorch-image-models), whose documentation distinguishes software licensing from pretrained-weight and training-data terms.
- The existing project records do not identify a separately audited upstream checkpoint license. Accordingly, **the MIT code license does not grant reuse rights for the ONNX weights**. No blanket commercial-use permission is asserted for these weights. Establish the applicable checkpoint and source-data permissions before redistributing or reusing them outside this demonstration.
- Detection output needs human review; the published test metrics and label limitations are described in the README.

## Software dependencies

Dependencies retain their own licenses and notices. JavaScript versions are recorded in `package-lock.json`; Python training requirements are in `ml/train/requirements.txt`. Relevant upstream projects include:

- [Next.js](https://github.com/vercel/next.js), [React](https://github.com/facebook/react), [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss).
- [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js), [Three.js](https://github.com/mrdoob/three.js), [React Three Fiber](https://github.com/pmndrs/react-three-fiber), [Drei](https://github.com/pmndrs/drei).
- [SunCalc](https://github.com/mourner/suncalc), [Proj4js](https://github.com/proj4js/proj4js), [ONNX Runtime](https://github.com/microsoft/onnxruntime).
- [PyTorch](https://github.com/pytorch/pytorch), [segmentation_models_pytorch](https://github.com/qubvel-org/segmentation_models.pytorch), [timm](https://github.com/huggingface/pytorch-image-models).

This source list does not replace upstream license texts. Distributors of built bundles must retain the notices required by the dependency versions they distribute, including ONNX Runtime WebAssembly assets copied at build time. Build and data-preparation tools, including 7-Zip and FFmpeg, also retain their own licenses.
