# NYC Solar Studio

在纽约卫星地图选择建筑，进入 NYC 官方建筑数据的 TUM LoD2 整理版，查看单栋三维白模并进行概念级光伏设计。

## 模型来源

使用 [TUM 纽约三维城市项目](https://www.asg.ed.tum.de/en/gis/projects/3d-city-model-of-new-york-city/)发布的 CityGML。保留原有 RoofSurface、WallSurface、GroundSurface、坡度和孔洞，仅进行坐标转换与多边形三角化。运行时无需机器学习或 Google DSM。

- 发布版本：TUM 2017；模型反映历史测绘状态，建筑可能已改建。
- 原坐标系：EPSG:32118，单位米。
- 匹配：空间索引筛选后，通过底面（缺失时通过屋顶投影）精确包含判断。无匹配时提示无模型。
- 保留 CityGML ID、NYC BIN 和原高度；界面显示来源和历史版本。
- 流程分三步：卫星地图选楼 → 3D 屋顶设计 → 结果与分享。卫星地图只用于选楼。
- 3D 模型不依赖 Google；Google Building Insights 可选，用于组件尺寸、发电基准，以及把点在街道上的位置吸附到最近建筑。

原始模型的几何问题可能保留。孤立视图未包含周边建筑、树木和完整屋顶设备。

## 技术栈

Next.js、React、TypeScript、Tailwind CSS、Google Maps JavaScript API、Places API (New)、Solar Building Insights、Three.js / React Three Fiber、SunCalc、Proj4、fast-xml-parser、Node SQLite、Vitest。

## 启动

需要 Node.js 22.13+（已验证 Node 24）。

```powershell
npm install
# 仅首次创建；已有 .env.local 时保留
Copy-Item .env.example .env.local
npm run dev
```

浏览器 Key 启用 Maps JavaScript API 和 Places API (New)，配置网站来源限制。服务端 Key 启用 Solar API。Key 存放于 .env.local，勿提交 Git。

## 一次性准备模型

下载 [官方 CityGML ZIP](https://www.3dcitydb.net/3dcitydb/fileadmin/public/datasets/NYC/NYC_buildings_CityGML_LoD2/NYC_Buildings_LoD2_CityGML.zip)，放入 data/raw/nyc-tum/。

压缩包约 2.47 GB，解压文本约 31.8 GB。流式索引无需保存解压文本。Windows 安装 Python 3 后执行：

```powershell
python scripts/index-nyc-citygml.py --archive data/raw/nyc-tum/NYC_Buildings_LoD2_CityGML.zip --output data/processed/nyc-citygml.sqlite --sevenzip node_modules/7zip-bin/win/x64/7za.exe
```

脚本保存压缩的原始单栋 CityGML 和空间索引，结束后标记完整。已有输出不会覆盖。其他系统指定本机支持 Deflate64 的 7-Zip 路径。

默认数据库为 data/processed/nyc-citygml.sqlite；服务端环境变量 NYC_TUM_DB_PATH 可指定完整路径。原始数据及数据库排除在 Git 外。旧 GBA 预处理脚本已移除，需复现时查看 v0.6.1 标签。

## 分享与部署

部署至带持久化磁盘的 Node.js 服务，将数据库放到服务器并配置 NYC_TUM_DB_PATH。访客通过网站链接浏览，按需接收单栋几何，无需下载全纽约数据。数据库无需暴露为公共文件。

常规无服务器函数的打包和临时磁盘限制不适合直接携带完整本地索引。部署时配置正式域名的浏览器 Key 来源限制及服务端环境变量。保留 NYC Open Data / TUM 来源说明，公开使用遵循 TUM 页面链接的 NYC 原始数据条款。

## 光伏与日照口径

- 三维阵列用于概念交互；自动铺设仍需人工复核边缘、通道、障碍与支架。
- 年发电基准来自 Google 原推荐配置；自定义布局不会触发工程级重算。
- 交流年发电量采用 0.85 DC→AC 假设，减碳使用 Google 返回的当地电网因子。
- 日期时间控制太阳方向；当前模拟未包含天气及周边完整遮挡。

## 验证

```powershell
npm test
npm run lint
npm run build
# 可选：完整数据库实际建筑验证
$env:NYC_TEST_DB = (Resolve-Path data/processed/nyc-citygml.sqlite).Path
npx vitest run src/lib/nyc/index.integration.test.ts
```

开发分支：feat/opensolar-workflow。Source: NYC Open Data / TUM; Includes solar data from Google.
