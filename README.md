# NYC Solar Studio

在纽约航拍地图上选择建筑，进入 NYC 官方建筑数据的 TUM LoD2 整理版，查看单栋三维白模并进行概念级光伏设计。纯静态网站，可直接部署到 GitHub Pages，无需服务器和任何 API Key。

## 模型来源

使用 [TUM 纽约三维城市项目](https://www.asg.ed.tum.de/en/gis/projects/3d-city-model-of-new-york-city/)发布的 CityGML。保留原有 RoofSurface、WallSurface、GroundSurface、坡度和孔洞，仅进行坐标转换与多边形三角化。运行时无需机器学习、服务器或 Google 服务。

- 发布版本：TUM 2017；模型反映历史测绘状态，建筑可能已改建。
- 原坐标系：EPSG:32118，单位米。
- 匹配：从静态网格瓦片中取点击位置附近的建筑，通过底面（缺失时通过屋顶投影）精确包含判断；点在街道或院子里时吸附到 25 m 内最近的建筑，否则提示无模型。
- 保留 CityGML ID、NYC BIN 和原高度；界面显示来源和历史版本。
- 流程分三步：航拍地图选楼 → 3D 屋顶设计 → 结果与分享。地图只用于选楼。
- 地图与 3D 底图使用纽约州 ITS 2014 年正射航拍（与建筑模型同期，免费、无需 Key）；地址搜索使用 NYC Planning Labs GeoSearch。

原始模型的几何问题可能保留。视图可显示参与遮挡计算的周边建筑，未包含树木和完整屋顶设备。

## 设计工作区

- 进入设计时屋顶是空的：先圈禁装区，再点「生成阵列」。
- 3D 视图可打开航拍底图（默认关闭），地面和屋面都有影像，屋顶设备一目了然。高楼的影像有几米的倾斜偏移。
- 用「禁装区」工具（Z）像钢笔工具一样逐点圈出设备、检修口或通道：点回起点或按 Enter 闭合，Shift 锁定 45°，拖动锚点调整，Alt+单击删除锚点，可撤销；自动铺板和最优布局会避开禁装区及其周围的退距，手动放置也放不进去；擦除工具点击禁装区即可删除。禁装区随草稿和分享链接保存。
- 「自动识别」用浏览器里的 U-Net 模型从 2014 年航拍中找出平屋顶上的设备、楼梯间、天窗和排风口，框成禁装区（带「自动」标签）；可在列表中单独删除、拖动锚点修改，再次识别只替换自动识别的结果。模型（约 8 MB）和 ONNX Runtime（约 15 MB）在首次点击时才下载；加载失败时改用颜色异常算法。
- 右上角「?」打开导览：用 P.S. 321 小学演示选楼、禁装区、生成阵列、阴影和结果。首次访问自动弹出。
- 在设计或结果面板开启「逐块年发电表现」，组件按估算年发电量着色。固定色标以同地点理想无遮挡组件为参考，拖动日期时间不会改变年度色标；选中组件仍用蓝色标示，并显示该组件的年发电量、倾角和朝向。
- 展开「方案 A / B 对比」，保存两组布局，比较组件数量、容量、年发电量和单位容量发电量。两组使用相同建筑、组件规格和遮挡口径重算；应用 A/B 会恢复布局与参数，撤销仅恢复组件布局。
- 编辑后自动保存最近一栋建筑的草稿、A/B、组件规格与布局参数。重新打开首页可选择恢复或丢弃；主动清空的布局也会保存。草稿只存在当前浏览器，清除浏览器数据会丢失，分享链接优先于草稿。
- 工作区复用现有几何与能量计算，无需新增 API。年发电量用于概念方案比较，采用典型气象年的代表性月/小时样本近似，不能代替现场勘测和施工设计。

## 技术栈

Next.js（静态导出）、React、TypeScript、Tailwind CSS、MapLibre GL、Three.js / React Three Fiber、SunCalc、Proj4、Vitest；数据预处理用 fast-xml-parser 与 Node SQLite。

## 启动

需要 Node.js 22.13+（已验证 Node 24）。仓库已包含建筑瓦片，无需任何 Key：

```powershell
npm install
npm run dev
```

## 建筑数据（静态瓦片）

`public/data/nyc` 中是全纽约约 108 万栋建筑的静态瓦片，按经纬度网格（0.003° × 0.0025°，约 250 m）切分并 gzip 压缩：

- `m/{列}_{行}.bin.gz`：三维模型（CityGML 面片，州平面坐标，厘米精度）；
- `f/{列}_{行}.bin.gz`：地图轮廓（经纬度，约 1 cm 精度）、高度和地址；
- `index.json`：非空瓦片列表。

浏览器选楼时只下载点击处和周边几块，周边建筑遮挡在浏览器里计算。格式见 `src/lib/nyc/tile-format.ts`。

### 重新生成

下载 [官方 CityGML ZIP](https://www.3dcitydb.net/3dcitydb/fileadmin/public/datasets/NYC/NYC_buildings_CityGML_LoD2/NYC_Buildings_LoD2_CityGML.zip)，放入 data/raw/nyc-tum/。压缩包约 2.47 GB，流式索引无需保存解压文本。Windows 安装 Python 3 后：

```powershell
python scripts/index-nyc-citygml.py --archive data/raw/nyc-tum/NYC_Buildings_LoD2_CityGML.zip --output data/processed/nyc-citygml.sqlite --sevenzip node_modules/7zip-bin/win/x64/7za.exe
npm run data:build-footprints
npm run data:build-tiles
```

`data:build-tiles` 单进程约 2 小时，可传入经纬度范围（`west,south,east,north`）分区并行运行，已写出的瓦片会跳过，最后再不带范围运行一次以生成 `index.json`。研究区边界（地图上的蓝线）由 `npm run data:build-coverage` 生成，结果在 `src/lib/nyc/coverage.ts`。中间数据库排除在 Git 外。

## 屋顶障碍物模型

`public/models/roof-obstacles.onnx` 是在 AutoDL 上训练的 U-Net（MobileNetV2 编码器，fp16）。训练标签由 2017 年纽约 LiDAR 自动生成：屋面上凸起 0.45 m 以上、宽度小于 8 m 的东西算障碍物，坡屋顶、屋顶边缘和高差交界不参与训练。测试集上约一半的 LiDAR 障碍物被找到，模型标出的区块约六成确有障碍物；平贴的天窗 LiDAR 标不出，但模型常能认出。

重新训练（需 Python 3.10+，约 4 GB LiDAR 下载）：

```powershell
python -m venv ml/.venv; ml/.venv/Scripts/python -m pip install numpy scipy "laspy[lazrs]" pyproj pillow
ml/.venv/Scripts/python ml/build_dataset.py --tiles 60 --out data/ml/dataset
ml/.venv/Scripts/python ml/package_autodl.py
```

把 `data/ml/autodl-package.zip` 传到 GPU 服务器，按包内 `train/README.md` 训练、评估和导出，再把 `model.fp16.onnx` 放到 `public/models/roof-obstacles.onnx`；阈值在 `src/lib/design/obstacle-model.ts`。ONNX Runtime 的 WebAssembly 在 `npm run dev` / `npm run build` 前由 `scripts/copy-ort-wasm.mjs` 复制到 `public/ort`。

## 部署到 GitHub Pages

1. 把仓库推送到 GitHub（含 `public/data/nyc`，约 400 MB）。
2. 仓库 Settings → Pages → Source 选择 **GitHub Actions**。
3. 推送到 `main` 或手动运行 “Deploy to GitHub Pages” 工作流；它会以仓库路径为 `NEXT_PUBLIC_BASE_PATH` 静态导出 `out/` 并发布。

本地预览静态导出：`npm run build` 后用任意静态服务器打开 `out/`。保留 NYC Open Data / TUM 与 NYS ITS 影像来源说明，公开使用遵循各自数据条款。

## 光伏与日照口径

- 三维阵列用于概念交互；自动铺设仍需人工复核边缘、通道、障碍与支架。
- 年发电量以纽约 PVGIS-ERA5 典型气象年的代表性月/小时样本近似计算，计入遮挡、入射角与温度损失、14% 系统损失和 96% 逆变器效率；手动编辑的布局同样逐块计算。减碳使用 EPA eGRID2023 纽约市及韦斯特切斯特（NYCW）电网排放因子 442 kg/MWh。
- 日期时间控制太阳方向；铺板与寻优计入建筑自遮挡、排间遮挡和 200 m 内足够高的周边建筑遮挡，未包含天气、树木与屋顶设备。

## 验证

```powershell
npm test
npm run lint
npm run build
# 可选：完整数据库实际建筑验证
$env:NYC_TEST_DB = (Resolve-Path data/processed/nyc-citygml.sqlite).Path
npx vitest run src/lib/nyc/index.integration.test.ts
```

开发分支：feat/opensolar-workflow。Source: NYC Open Data / TUM; imagery NYS ITS Geospatial Services; search NYC Planning Labs GeoSearch.
