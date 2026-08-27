# NYC Solar Roof 3D

在纽约真实三维建筑上选择屋顶、查看 Google Solar API 推荐板位，并逐块配置光伏板的交互式网页 Demo。

## 当前功能

- Google Maps JavaScript API 3D 城市浏览
- Google Places 纽约地址搜索
- 三个住宅演示入口
- Solar API Building Insights 服务端代理
- `panelToPolygon()` 屋顶平面几何转换
- `RELATIVE_TO_MESH` 与 `ABSOLUTE` 两种定位模式
- 候选板点击增删与三个预设方案
- 装机容量、年发电量、年度电力价值和碳减排汇总
- 基于 EIA 2020 RECS 的冰箱用电量等效
- URL 方案分享
- 无数据和服务失败状态
- Google Solar attribution

## 技术栈

- Next.js App Router
- React + TypeScript
- Tailwind CSS
- Google Maps JavaScript API 3D
- Google Places API (New)
- Google Solar API Building Insights
- Vitest
- Vercel

## 本地启动

```bash
npm install
Copy-Item .env.example .env.local
npm test
npm run dev
```

在 `.env.local` 中配置：

```dotenv
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=浏览器地图Key
GOOGLE_SOLAR_API_KEY=服务端SolarKey
```

浏览器 Key 仅启用 Maps JavaScript API 和 Places API，并设置 HTTP Referer 限制。服务端 Key 仅启用 Solar API。部署前在 Google Cloud Console 设置可用的每日配额。

## 验证命令

```bash
npm test
npm run lint
npm run build
```

## 第一轮三维 Go / No-Go

选择五栋不同屋顶住宅进行视觉验证。至少四栋同时满足以下条件时保留三维路线：

- 候选板稳定显示
- 地图旋转、倾斜和缩放后仍贴合屋顶
- 点击响应稳定
- 没有明显浮空、穿模或扭曲

通过两至三栋时，切换 `ABSOLUTE` 模式重测。结果仍低于四栋时，将覆盖物迁移到二维卫星图。通过零至一栋时直接采用二维方案。

## 数据与计算口径

- `yearlyEnergyDcKwh`：Google Solar API 返回的直流侧年能量。
- 交流年发电量：直流年能量乘以 Google 方法文档采用的 0.85 DC→AC 折减。
- 年度电力价值：交流年发电量乘以页面可编辑电价。
- 碳减排：采用 Solar API 返回的当地电网 `carbonOffsetFactorKgPerMwh`。
- 冰箱等效：采用 EIA 2020 RECS 纽约州常用冰箱 542 kWh/年。

年度电力价值只表达发电对应的电力价值，未模拟负荷曲线、固定费用和净计量结算。

## 数据局限

- Solar API 覆盖和影像质量因建筑而异。
- 影像日期之后发生的树木生长和建筑改造不会反映在结果中。
- Solar API 假设 400 W、20.4% 效率、85% DC→AC 折减，并假设光伏板与屋顶齐平安装。
- 平屋顶支架会同时改变单块板收益、板间距和可安装数量。
- Solar API 屋顶模型与三维地图网格来自不同处理链路，可能出现轻微错位。

## 暂缓功能

- Solar Data Layers
- PVGIS
- 自由拖拽光伏板
- 光伏板角度调整

## 版本管理

- `main` 始终保持可构建。
- 功能分支使用 `feat/<name>`，修复分支使用 `fix/<name>`。
- 提交信息采用 Conventional Commits，例如 `feat: add solar building lookup`。
- 版本采用 SemVer。公开 Demo 的首个冻结版本标记为 `v0.1.0`。
- 架构变化记录在 [`docs/DECISIONS.md`](docs/DECISIONS.md)。

## 官方来源

- [Google Solar API methodology](https://developers.google.com/maps/documentation/solar/methodology)
- [Google Building Insights](https://developers.google.com/maps/documentation/solar/building-insights)
- [Google 3D Maps](https://developers.google.com/maps/documentation/javascript/3d/overview)
- [EIA 2020 RECS New York end-use table](https://www.eia.gov/consumption/residential/data/2020/state/pdf/ce5.3.st.pdf)

Source: Includes solar data from Google.
