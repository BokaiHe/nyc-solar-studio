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

原始模型的几何问题可能保留。视图可显示参与遮挡计算的周边建筑，未包含树木和完整屋顶设备。

## 设计工作区

- 进入设计时屋顶是空的：先圈禁装区，再点「生成阵列」。
- 3D 视图可打开 Google 卫星底图（默认关闭），地面和屋面都有影像，屋顶设备一目了然；需要在 API key 上启用 Map Tiles API。高楼的影像有几米的倾斜偏移。
- 用「禁装区」工具（Z）像钢笔工具一样逐点圈出设备、检修口或通道：点回起点或按 Enter 闭合，Shift 锁定 45°，拖动锚点调整，Alt+单击删除锚点，可撤销；自动铺板和最优布局会避开禁装区及其周围的退距，手动放置也放不进去；擦除工具点击禁装区即可删除。禁装区随草稿和分享链接保存。
- 在设计或结果面板开启「逐块年发电表现」，组件按估算年发电量着色。固定色标以同地点理想无遮挡组件为参考，拖动日期时间不会改变年度色标；选中组件仍用蓝色标示，并显示该组件的年发电量、倾角和朝向。
- 展开「方案 A / B 对比」，保存两组布局，比较组件数量、容量、年发电量和单位容量发电量。两组使用相同建筑、组件规格和遮挡口径重算；应用 A/B 会恢复布局与参数，撤销仅恢复组件布局。
- 编辑后自动保存最近一栋建筑的草稿、A/B、组件规格与布局参数。重新打开首页可选择恢复或丢弃；主动清空的布局也会保存。草稿只存在当前浏览器，清除浏览器数据会丢失，分享链接优先于草稿。
- 工作区复用现有几何与能量计算，无需新增 API。年发电量用于概念方案比较，采用典型气象年的代表性月/小时样本近似，不能代替现场勘测和施工设计。

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

之后生成地图上的建筑轮廓索引（约 2 分钟，约 100 MB），选楼时放大地图即可看到所有有三维模型的建筑：

```powershell
npm run data:build-footprints
```

研究区边界（地图上的蓝线）由 `npm run data:build-coverage` 从轮廓索引生成，结果已提交在 `src/lib/nyc/coverage.ts`，数据更新后再运行即可。

默认数据库为 data/processed/nyc-citygml.sqlite；轮廓索引为 data/processed/nyc-footprints.sqlite（可用 NYC_FOOTPRINTS_DB_PATH 指定）。缺少轮廓索引时地图仍可点击选楼，只是不显示轮廓。服务端环境变量 NYC_TUM_DB_PATH 可指定完整路径。原始数据及数据库排除在 Git 外。旧 GBA 预处理脚本已移除，需复现时查看 v0.6.1 标签。

## 分享与部署

部署至带持久化磁盘的 Node.js 服务，将数据库放到服务器并配置 NYC_TUM_DB_PATH。访客通过网站链接浏览，按需接收单栋几何，无需下载全纽约数据。数据库无需暴露为公共文件。

常规无服务器函数的打包和临时磁盘限制不适合直接携带完整本地索引。部署时配置正式域名的浏览器 Key 来源限制及服务端环境变量。保留 NYC Open Data / TUM 来源说明，公开使用遵循 TUM 页面链接的 NYC 原始数据条款。

## 光伏与日照口径

- 三维阵列用于概念交互；自动铺设仍需人工复核边缘、通道、障碍与支架。
- 年发电量以纽约 PVGIS-ERA5 典型气象年的代表性月/小时样本近似计算，计入遮挡、入射角与温度损失、14% 系统损失和 96% 逆变器效率；手动编辑的布局同样逐块计算。减碳使用 Google 返回的当地电网因子。
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

开发分支：feat/opensolar-workflow。Source: NYC Open Data / TUM; Includes solar data from Google.
