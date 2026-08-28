# NYC Solar Studio

以 OpenSolar 的任务流为交互参考，在纽约卫星屋顶上完成建筑选择、Google 推荐铺板、板组编辑、日照预览与方案结果查看。

## 当前功能

- Google Places 纽约地址搜索与五区演示入口
- Google Maps 卫星正射设计画布
- 点击地图锁定建筑，显示 Solar API 建筑边界与中心反馈
- Solar API Building Insights 服务端代理
- Google 推荐板位与小型、均衡、最大化方案
- 组件数量连续调节
- 候选板点击增删、单板拖动与旋转
- 已选板组整体旋转
- 设计、日照、结果三阶段工作流
- 日期、纽约当地时间和太阳轨迹播放
- 板面相对直射着色
- 装机容量、年发电量和碳减排汇总
- URL 方案分享
- Google Solar attribution

## 界面结构

- 顶部：地址搜索与设计阶段导航
- 左侧：选择、铺板、日照和结果工具
- 中央：卫星屋顶设计画布
- 右侧：当前方案或选中对象属性
- 底部：日照模式日期与时间轴

设计操作以2D正射画布为主，使 Solar API 经纬度板位和 Google 卫星屋顶保持稳定对齐。局部3D预览将在 Solar Data Layers/DSM 接入后加入，避免再次混用独立的三维网格数据。

## 技术栈

- Next.js App Router
- React + TypeScript
- Tailwind CSS
- Google Maps JavaScript API
- Google Places API (New)
- Google Solar API Building Insights
- SunCalc
- Vitest
- Vercel

## 本地启动

```powershell
npm install
Copy-Item .env.example .env.local
npm test
npm run dev
```

`.env.local`：

```dotenv
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=浏览器地图Key
GOOGLE_SOLAR_API_KEY=服务端SolarKey
```

浏览器 Key 启用 Places API (New) 和 Maps JavaScript API，并设置 HTTP Referer 限制。服务端 Key 只启用 Solar API。

## 操作方法

1. 搜索纽约地址、选择演示建筑，或点击卫星地图中的屋顶。
2. 确认建筑边界后进入设计。
3. 选择推荐规模或拖动组件数量滑块。
4. 进入“铺板”工具，点击候选位置增删组件。
5. 拖动蓝色组件，或在右侧调整单块及整组方向。
6. 进入日照模式，选择日期并拖动时间轴。
7. 在结果页查看系统规模、年发电基准和减碳基准。

## 数据与计算口径

- `yearlyEnergyDcKwh` 来自 Google Solar API。
- 交流年发电量采用 0.85 DC→AC 折减。
- 碳减排采用 Solar API 返回的当地电网排放因子。
- 当前直射只表达太阳方向与板面法线的夹角关系。
- 自定义移动或旋转后，年发电量仍显示 Google 原推荐板位基准。

## 数据局限

- Solar API 覆盖和影像质量因建筑而异。
- Google 推荐布局默认采用 400 W 组件并与屋顶齐平。
- Building Insights 不提供自定义布局重新计算后的年发电量。
- 当前日照颜色未包含云量、树木和周边建筑遮挡。
- 工程级遮阴、屋顶高程和局部3D需要 Solar Data Layers/DSM。

## 验证

```bash
npm test
npm run lint
npm run build
```

## 版本管理

- `main` 保留已发布实验版本。
- OpenSolar 风格重构位于 `feat/opensolar-workflow`。
- 当前卫星设计器版本为 `v0.4.0`。

## 官方来源

- [Google Solar API methodology](https://developers.google.com/maps/documentation/solar/methodology)
- [Google Building Insights](https://developers.google.com/maps/documentation/solar/building-insights)
- [Google Solar Potential demo](https://github.com/googlemaps-samples/js-solar-potential)
- [OpenSolar Auto Design](https://www.opensolar.com/auto-design/)

Source: Includes solar data from Google.
