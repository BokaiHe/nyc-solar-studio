# NYC Solar Roof 3D

在纽约真实三维建筑上选择屋顶、查看 Google Solar API 推荐板位、拖动和旋转光伏板，并模拟不同日期与时间太阳位置的交互式网页 Demo。

## 当前功能

- Cesium 三维地球与 Google Photorealistic 3D Tiles
- Google Places 纽约地址搜索
- 五个行政区住宅演示入口
- 在三维建筑上直接点击并读取屋顶
- Solar API Building Insights 服务端代理
- `panelToPolygon()` 屋顶平面几何转换
- 候选板点击增删与三个预设方案
- 光伏板屋顶网格吸附、拖动、选择和旋转
- 日期、纽约当地时间与播放控制
- 太阳轨迹、太阳方向、场景光影和光伏板直射系数预览
- 装机容量、年发电量、年度电力价值和碳减排汇总
- 基于 EIA 2020 RECS 的冰箱用电量等效
- URL 方案分享
- 无数据和服务失败状态
- Google Solar attribution

## 技术栈

- Next.js App Router
- React + TypeScript
- Tailwind CSS
- CesiumJS
- Google Map Tiles API（Photorealistic 3D Tiles）
- Google Places API (New)
- Google Solar API Building Insights
- Vitest
- Vercel

## 本地启动

```powershell
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

浏览器 Key 启用 Places API 和 Map Tiles API，并设置 HTTP Referer 限制。Cesium 必须在浏览器中创建临时 3D Tiles session，因此该 Key 会随前端代码提供；HTTP Referer 与 API 范围限制负责约束用途。服务端 Key 只启用 Solar API，并且不会进入页面代码。部署前在 Google Cloud Console 设置预算提醒和可用配额。

Google Cloud 项目必须启用并计费：

- Places API (New)
- Solar API
- Map Tiles API

安装依赖时，`postinstall` 会把 Cesium 的静态运行资源复制到 `public/cesium`。该目录由构建生成，不纳入 Git。

## 操作方法

1. 搜索纽约地址、选择演示建筑，或直接点击三维城市中的屋顶。
2. 点击候选板位进行增删；按住一块板拖动，可沿当前屋顶重新放置。
3. 选中光伏板后，用左侧按钮按 5° 旋转，或恢复 Google 推荐布局。
4. 在页面底部选择日期并拖动时间；播放按钮会自动推进一天中的太阳位置。
5. 太阳轨迹和光线随时间变化，板面颜色与“当前直射”显示朝向匹配程度。

## 验证命令

```bash
npm test
npm run lint
npm run build
```

## 三维贴合验收

选择五栋不同屋顶住宅进行视觉验证。至少四栋同时满足以下条件时保留三维路线：

- 候选板稳定显示
- 地图旋转、倾斜和缩放后仍贴合屋顶
- 点击响应稳定
- 没有明显浮空、穿模或扭曲

当前渲染采用绝对高度。至少用五栋不同屋顶住宅检查数据源之间的高度差；出现稳定的系统偏移时，再校准全局高度偏移值。

## 数据与计算口径

- `yearlyEnergyDcKwh`：Google Solar API 返回的直流侧年能量。
- 交流年发电量：直流年能量乘以 Google 方法文档采用的 0.85 DC→AC 折减。
- 年度电力价值：交流年发电量乘以页面可编辑电价。
- 碳减排：采用 Solar API 返回的当地电网 `carbonOffsetFactorKgPerMwh`。
- 冰箱等效：采用 EIA 2020 RECS 纽约州常用冰箱 542 kWh/年。
- 当前直射系数：仅表示给定时刻太阳方向与板面法线的夹角关系，不包含云量、遮挡、温度和逆变损耗。

年度电力价值只表达发电对应的电力价值，未模拟负荷曲线、固定费用和净计量结算。

## 数据局限

- Solar API 覆盖和影像质量因建筑而异。
- 影像日期之后发生的树木生长和建筑改造不会反映在结果中。
- Solar API 假设 400 W、20.4% 效率、85% DC→AC 折减，并假设光伏板与屋顶齐平安装。
- 平屋顶支架会同时改变单块板收益、板间距和可安装数量。
- Solar API 屋顶模型与三维地图网格来自不同处理链路；页面会把每个板位顶点吸附到当前最高精度三维网格，局部网格缺损或树木仍可能影响贴合。
- 拖动或旋转光伏板后，Google 返回的年度发电量仍是原候选板位基线；当前版本不会伪造自定义布局的年发电量。
- 实时光影用于空间体验和朝向比较，不代表工程级阴影分析。

## 暂缓功能

- Solar Data Layers
- PVGIS
- Data Layers 级逐像素遮挡分析
- 自定义布局的工程级发电重算

## 版本管理

- `main` 始终保持可构建。
- 功能分支使用 `feat/<name>`，修复分支使用 `fix/<name>`。
- 提交信息采用 Conventional Commits，例如 `feat: add solar building lookup`。
- 版本采用 SemVer。当前三维交互版本为 `v0.2.4`。
- 架构变化记录在 [`docs/DECISIONS.md`](docs/DECISIONS.md)。

## 官方来源

- [Google Solar API methodology](https://developers.google.com/maps/documentation/solar/methodology)
- [Google Building Insights](https://developers.google.com/maps/documentation/solar/building-insights)
- [Google Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles)
- [CesiumJS](https://cesium.com/platform/cesiumjs/)
- [EIA 2020 RECS New York end-use table](https://www.eia.gov/consumption/residential/data/2020/state/pdf/ce5.3.st.pdf)

Source: Includes solar data from Google.

## 当前验收边界

纯函数部分已经由单元测试、ESLint、TypeScript 和生产构建覆盖。真实三维瓦片仍需启用 Map Tiles API 后进行浏览器联调；Solar Building Insights 已通过服务端请求验证。
