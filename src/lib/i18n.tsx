'use client';

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';

export type Lang = 'en' | 'zh';

const en = {
  switchTo: '中文',
  switchLabel: 'Switch to Chinese',
  header: {
    home: 'Start over',
    examples: 'Examples',
    search: 'Search NYC addresses or buildings',
  },
  steps: {
    label: 'Workflow steps',
    select: 'Select building',
    design: 'Design',
    results: 'Results',
  },
  places: {
    shared: 'Shared NYC rooftop design',
    mapPick: 'Building picked on the map',
    fallback: 'NYC building',
    'staten-island': 'Staten Island home',
    queens: 'Queens home',
    brooklyn: 'Brooklyn home',
    bronx: 'Bronx home',
    manhattan: 'Manhattan home',
  },
  map: {
    label: 'Satellite map for picking a building',
    loading: 'Loading satellite map…',
    hintZoom: (count: string) => `Inside the blue line is the study area: ${count} buildings with 3D models · zoom in to see their outlines`,
    hintPick: 'Outlined buildings have a 3D model · click one to select it',
    hover: (address: string, height: number | null) => `${address}${height === null ? '' : ` · ${Math.round(height)} m`} · click to select`,
    failed: 'The map failed to load. It needs a browser with WebGL.',
  },
  select: {
    idleTitle: 'Design a solar array on NYC rooftops',
    idleBody: 'Search an address, or click a roof on the satellite map to begin.',
    loadingTitle: 'Loading the building…',
    loadingBody: 'Loading the NYC 3D model.',
    noModelTitle: 'No 3D model at this spot',
    noModelBody: 'The NYC / TUM model has no building here. Try clicking closer to the middle of the roof.',
    outsideTitle: 'Outside the study area',
    outsideBody: 'This tool covers buildings in New York City’s five boroughs, inside the blue line. Pick a spot within it.',
    errorTitle: "This building couldn't be loaded",
    errorBody: 'The model service is unavailable right now. Please try again.',
    eyebrow: 'Selected building',
    modelHeight: (height: string, release: string) => `Model height ${height} m · TUM ${release} release`,
    modelSource: 'NYC Open Data / TUM LoD2. Historical survey; the building may have changed.',
    start: 'Design this roof',
  },
  design: {
    eyebrow: 'Roof design',
    count: (count: number) => `${count} panels`,
    capacity: (kw: string) => `${kw} kW`,
    collapse: 'Collapse panel',
    expand: 'Expand panel',
    sharedModelChanged: 'The matched building differs from the shared one, so the shared layout was not loaded.',
    statusAuto: 'Auto layout · updates as you change settings',
    statusEdited: 'Edited by hand',
    statusEmpty: 'No array yet',
    emptyTitle: 'Mark what must stay clear first',
    emptyBody: 'Outline rooftop equipment, hatches and walkways with the Keep-out tool, then generate the array around them.',
    drawZones: 'Draw keep-out',
    neighborsLoading: 'Loading surrounding buildings…',
    neighborsReady: (count: number) => `Shade from ${count} surrounding building${count === 1 ? '' : 's'} within 200 m included`,
    neighborsNone: 'No surrounding building within 200 m rises high enough to shade this roof',
    neighborsFailed: 'Surrounding buildings unavailable; only the building’s own shade is counted',
    applySettings: 'Apply new settings',
    applyHint: 'Replaces your hand edits; Undo brings them back.',
    regenerate: 'Regenerate array',
    generate: 'Generate array',
    generating: 'Generating…',
    layoutTitle: 'Array settings',
    azimuth: 'Facing',
    tilt: 'Rack tilt',
    setback: 'Edge setback',
    rowSpacing: 'Row gap',
    moreOptions: 'More options',
    alignToRoof: 'Align rows to the building',
    includeShaded: 'Include shaded or poorly facing spots',
    maxPanels: 'Panel limit',
    fill: 'Fill roof',
    compass: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
    layoutSummary: (placed: number, shaded: number) => shaded
      ? `${placed} placed · ${shaded} shaded or poorly facing spots skipped`
      : `${placed} placed`,
    layoutEmpty: 'No panel fits with these settings. Try a smaller setback or row gap.',
    flatRoofNote: 'Flat roofs get tilted racks; pitched roofs get flush panels along their slope.',
    zones: (count: number) => `${count} keep-out area${count === 1 ? '' : 's'}`,
    zonesHint: 'Use the Keep-out tool to outline equipment, hatches or walkways; layouts leave them and the setback around them clear.',
    clearZones: 'Remove all',
    undo: 'Undo',
    redo: 'Redo',
    clear: 'Clear all',
    next: 'See results',
  },
  optimize: {
    title: 'Best layout',
    objectiveMax: 'Most energy',
    objectiveBalanced: 'Balanced',
    hintMax: 'Packs the roof for the highest annual output.',
    hintBalanced: 'Highest output while every panel keeps at least 90% of an ideal panel’s yield.',
    run: 'Find best layout',
    rerun: 'Search again',
    running: (done: number, total: number) => `Comparing ${done} of ${total} layouts…`,
    option: (tilt: number, gap: string) => `Tilt ${tilt}° · Row gap ${gap} m`,
    stats: (panels: number, kw: string, mwh: number) => `${panels} panels · ${kw} kW · ${mwh.toLocaleString()} kWh/yr`,
    gain: (percent: number) => `${percent >= 0 ? '+' : ''}${percent}% energy`,
    efficiency: (percent: number) => `${percent}% per panel`,
    apply: 'Apply',
    applied: 'Applied',
    stale: 'Settings changed since this search.',
    note: 'Compares rack tilt and row gap with your facing and setback, using the same hourly energy model as the results. The change is relative to the current settings.',
    failed: 'The search failed. Please try again.',
  },
  tools: {
    label: 'Editing tools',
    select: 'Select',
    add: 'Place',
    erase: 'Erase',
    zone: 'Keep-out',
    selectHint: 'Drag on the roof to box-select · Shift adds · drag panels to move',
    addHint: 'Click the roof to place a panel · it snaps to nearby rows',
    eraseHint: 'Click or drag across panels or keep-out areas to erase',
    zoneHint: 'Click to add anchors · click the first anchor or press Enter to close · Shift keeps 45° · drag an anchor to reshape, Alt-click to remove it · Backspace undoes the last anchor',
    orbitHint: 'Drag the sky to orbit · right-drag to pan · scroll to zoom',
    resetView: 'Reset view',
    topView: 'Top view',
    neighbors: 'Surroundings',
    basemap: 'Satellite',
  },
  selection: {
    count: (count: number) => `${count} selected`,
    rotateLeft: 'Rotate 5° counter-clockwise',
    rotateRight: 'Rotate 5° clockwise',
    orientation: 'Portrait / Landscape',
    row: 'Row',
    roof: 'Whole roof',
    all: 'All',
    delete: 'Delete',
    deselect: 'Deselect',
  },
  sun: {
    date: 'Simulation date',
    play: 'Play',
    pause: 'Pause',
    time: 'Time of day',
    position: (azimuth: string, altitude: string) => `Sun azimuth ${azimuth}° · altitude ${altitude}°`,
    direct: (percent: number) => `Right now panels receive ${percent}% of direct light`,
  },
  results: {
    eyebrow: 'Results',
    title: (kw: string) => `${kw} kW rooftop system`,
    panels: 'Panels',
    panelCount: (count: number) => `${count}`,
    layout: '3D concept layout',
    energy: 'Annual energy',
    energyDetail: (specificYield: number, efficiency: number) => `${specificYield.toLocaleString()} kWh/kWp · ${efficiency}% of ideal`,
    carbon: 'Annual CO₂ offset',
    carbonDetail: 'NYC grid, EPA eGRID2023',
    carbonMissing: 'Grid emission factor unavailable',
    savings: 'Annual bill value',
    savingsDetail: 'At the rate below',
    unavailable: '—',
    note: 'Hour-by-hour estimate from New York’s typical weather year, for each panel’s tilt and facing, with shade from the building, surrounding buildings and rows in front.',
    rate: 'Electricity rate (USD/kWh)',
    share: 'Copy design link',
    copied: 'Design link copied',
    basisTitle: 'How these numbers are estimated',
    keepOutNone: 'No keep-out areas drawn: rooftop equipment, hatches and walkways are not deducted, so panel count and energy may be too high.',
    keepOutSome: (count: number) => `${count} keep-out area${count === 1 ? '' : 's'} deducted; equipment you did not outline is not.`,
    drawKeepOut: 'Draw keep-out areas',
    energyBasis: 'Annual energy: hour by hour over New York’s typical weather year (PVGIS-ERA5, 2005–2023), independent of the date and time shown in the sun bar.',
    pvwattsRange: (low: string, high: string) => `This weather reads 5–8% sunnier than NREL’s PVWatts; on that basis expect about ${low}–${high} kWh a year.`,
    sunBasis: 'Sun bar: shows light and shadow at one chosen moment only; its direct-light share is for that moment, not the year.',
    modelBasis: (release: string, width: string, height: string, watts: number) => `3D model: NYC LoD2 (${release}), which may differ from today’s roof. Module ${width} × ${height} m, ${watts} W. Includes incidence-angle and temperature losses, 14% system losses and 96% inverter efficiency; trees, structural capacity and electrical design are not modeled.`,
    back: 'Back to design',
  },
  workspace: {
    label: 'Design workspace',
    heatmapShow: 'Show annual panel yield',
    heatmapOn: 'Annual yield · On',
    heatmapLegend: ['<65%', '75%', '85%', '90%+'],
    heatmapNote: 'Each panel’s annual output as a share of an ideal unshaded module here. It does not change with the time shown.',
    heatmapSelected: 'Selected panels keep their blue highlight.',
    panel: (id: number) => `Panel #${id}`,
    panelKwh: (kwh: string) => `${kwh} kWh/yr`,
    panelPose: (tilt: string, azimuth: string) => `Tilt ${tilt}° · facing ${azimuth}°`,
    compareTitle: 'Compare designs A / B',
    compareNote: 'Both are recalculated with the same building, module and shading. Saving replaces a slot. Applying one can be undone; its settings stay.',
    save: (slot: string) => `Save current as ${slot}`,
    apply: (slot: string) => `Apply ${slot}`,
    metricsLabel: 'Design comparison',
    modules: 'Panels',
    capacity: 'Capacity kW',
    annual: 'kWh/yr',
    specific: 'kWh/kW/yr',
    delta: (kwh: string, percent: string) => `B − A: ${kwh} kWh/yr${percent ? ` (${percent})` : ''}`,
    saved: 'Draft and A/B saved in this browser (latest building only).',
    saveFailed: 'Could not save in this browser. Copy a design link before leaving.',
    autosave: 'Edits are saved in this browser.',
    draftTitle: 'Continue your last design?',
    draftDetail: (label: string, count: number, time: string) => `${label} · ${count} panels · ${time}`,
    restore: 'Restore design',
    discard: 'Discard draft',
  },
  attribution: 'Imagery © NYS ITS Geospatial Services · 3D model NYC Open Data / TUM · Search NYC Planning Labs GeoSearch',
};

export type Dict = typeof en;

const zh: Dict = {
  switchTo: 'EN',
  switchLabel: '切换到英文',
  header: {
    home: '重新开始',
    examples: '示例',
    search: '搜索纽约地址或建筑',
  },
  steps: {
    label: '流程步骤',
    select: '选择建筑',
    design: '设计',
    results: '结果',
  },
  places: {
    shared: '分享的纽约屋顶方案',
    mapPick: '地图点击的建筑',
    fallback: '纽约建筑',
    'staten-island': '史泰登岛住宅',
    queens: '皇后区住宅',
    brooklyn: '布鲁克林住宅',
    bronx: '布朗克斯住宅',
    manhattan: '曼哈顿住宅',
  },
  map: {
    label: '用于选择建筑的卫星地图',
    loading: '正在加载卫星地图…',
    hintZoom: (count) => `蓝线内是研究区，共 ${count} 栋三维建筑 · 放大可显示建筑轮廓`,
    hintPick: '有轮廓的建筑都有三维模型 · 点击即可选择',
    hover: (address, height) => `${address}${height === null ? '' : ` · ${Math.round(height)} m`} · 点击选择`,
    failed: '地图加载失败，需要支持 WebGL 的浏览器。',
  },
  select: {
    idleTitle: '在纽约屋顶上设计光伏方案',
    idleBody: '搜索地址，或在卫星地图上点击一个屋顶开始。',
    loadingTitle: '正在加载建筑…',
    loadingBody: '正在加载纽约三维模型。',
    noModelTitle: '这里没有三维模型',
    noModelBody: 'NYC / TUM 模型在这个位置没有建筑。试着点击屋顶更靠中间的位置。',
    outsideTitle: '不在研究区内',
    outsideBody: '目前只覆盖纽约五个区（蓝线以内）的建筑，请在蓝线范围内选择。',
    errorTitle: '这栋建筑加载失败',
    errorBody: '模型服务暂时不可用，请稍后重试。',
    eyebrow: '已选建筑',
    modelHeight: (height, release) => `模型高度 ${height} m · TUM ${release} 版`,
    modelSource: 'NYC Open Data / TUM LoD2。历史测绘，建筑可能已改建。',
    start: '设计这个屋顶',
  },
  design: {
    eyebrow: '屋顶设计',
    count: (count) => `${count} 块组件`,
    capacity: (kw) => `${kw} kW`,
    collapse: '收起面板',
    expand: '展开面板',
    sharedModelChanged: '匹配到的建筑与分享时不同，分享的布局未载入。',
    statusAuto: '自动布局 · 修改参数会实时更新',
    statusEdited: '已手动编辑',
    statusEmpty: '尚未生成阵列',
    emptyTitle: '先圈出不能装的区域',
    emptyBody: '用「禁装区」工具圈出屋顶设备、检修口和通道，再生成阵列，组件会自动避开它们。',
    drawZones: '圈禁装区',
    neighborsLoading: '正在加载周边建筑…',
    neighborsReady: (count) => `已计入 200 m 内 ${count} 栋周边建筑的遮挡`,
    neighborsNone: '200 m 内没有足够高、会遮挡屋顶的周边建筑',
    neighborsFailed: '周边建筑加载失败，只计入建筑自身遮挡',
    applySettings: '应用新参数',
    applyHint: '会替换手动编辑的结果，可用撤销恢复。',
    regenerate: '重新生成阵列',
    generate: '生成阵列',
    generating: '正在生成…',
    layoutTitle: '阵列参数',
    azimuth: '朝向',
    tilt: '支架倾角',
    setback: '屋面退距',
    rowSpacing: '行间距',
    moreOptions: '更多选项',
    alignToRoof: '行列对齐建筑方向',
    includeShaded: '包含被遮挡或朝向差的位置',
    maxPanels: '组件数量上限',
    fill: '铺满',
    compass: ['北', '东北', '东', '东南', '南', '西南', '西', '西北'],
    layoutSummary: (placed, shaded) => shaded
      ? `已放置 ${placed} 块 · 跳过 ${shaded} 个被遮挡或朝向差的位置`
      : `已放置 ${placed} 块`,
    layoutEmpty: '按当前参数放不下组件，可以减小退距或行间距。',
    flatRoofNote: '平屋顶使用倾斜支架；坡屋顶沿坡面贴装。',
    zones: (count) => `${count} 个禁装区`,
    zonesHint: '用「禁装区」工具圈出设备、检修口或通道，自动铺板会避开它们及其周围的退距。',
    clearZones: '全部移除',
    undo: '撤销',
    redo: '重做',
    clear: '全部清空',
    next: '查看结果',
  },
  optimize: {
    title: '最优布局',
    objectiveMax: '发电最多',
    objectiveBalanced: '平衡',
    hintMax: '排得更密，追求全年总发电量最高。',
    hintBalanced: '每块板都保持理想板 90% 以上效率的前提下，总发电量最高。',
    run: '寻找最优布局',
    rerun: '重新寻找',
    running: (done, total) => `正在比较第 ${done}/${total} 种布局…`,
    option: (tilt, gap) => `倾角 ${tilt}° · 行间距 ${gap} m`,
    stats: (panels, kw, mwh) => `${panels} 块 · ${kw} kW · 年发电 ${mwh.toLocaleString()} kWh`,
    gain: (percent) => `发电 ${percent >= 0 ? '+' : ''}${percent}%`,
    efficiency: (percent) => `单板效率 ${percent}%`,
    apply: '应用',
    applied: '已应用',
    stale: '搜索后参数已改变。',
    note: '在当前朝向和退距下比较支架倾角与行间距，使用与结果页相同的逐时发电模型。变化比例相对当前参数。',
    failed: '寻优失败，请重试。',
  },
  tools: {
    label: '编辑工具',
    select: '选择',
    add: '放置',
    erase: '擦除',
    zone: '禁装区',
    selectHint: '在屋顶上拖动框选 · Shift 追加 · 拖动组件可移动',
    addHint: '点击屋顶放置组件 · 会自动吸附到附近的行列',
    eraseHint: '点击或拖过组件、禁装区即可擦除',
    zoneHint: '单击添加锚点 · 点回起点或按 Enter 闭合 · 按住 Shift 保持 45° · 拖动锚点可调整形状，Alt+单击删除锚点 · Backspace 撤回上一个锚点',
    orbitHint: '在空白处拖动旋转 · 右键拖动平移 · 滚轮缩放',
    resetView: '重置视角',
    topView: '俯视',
    neighbors: '周边建筑',
    basemap: '卫星底图',
  },
  selection: {
    count: (count) => `已选 ${count} 块`,
    rotateLeft: '逆时针旋转 5°',
    rotateRight: '顺时针旋转 5°',
    orientation: '横 / 竖',
    row: '整排',
    roof: '整个屋面',
    all: '全部',
    delete: '删除',
    deselect: '取消选择',
  },
  sun: {
    date: '模拟日期',
    play: '播放',
    pause: '暂停',
    time: '一天中的时间',
    position: (azimuth, altitude) => `太阳方位角 ${azimuth}° · 高度角 ${altitude}°`,
    direct: (percent) => `此刻板面直射 ${percent}%`,
  },
  results: {
    eyebrow: '方案结果',
    title: (kw) => `${kw} kW 屋顶系统`,
    panels: '光伏板',
    panelCount: (count) => `${count} 块`,
    layout: '3D 概念布局',
    energy: '年发电量',
    energyDetail: (specificYield, efficiency) => `${specificYield.toLocaleString()} kWh/kWp · 理想板的 ${efficiency}%`,
    carbon: '年减碳',
    carbonDetail: '纽约电网（EPA eGRID2023）',
    carbonMissing: '缺少电网排放因子',
    savings: '年电费价值',
    savingsDetail: '按下方电价',
    unavailable: '—',
    note: '按纽约典型气象年逐时估算，计入每块板的倾角和朝向，以及建筑自身、周边建筑和前排的遮挡。',
    rate: '电价假设（USD/kWh）',
    share: '复制方案链接',
    copied: '方案链接已复制',
    basisTitle: '计算口径',
    keepOutNone: '未圈禁装区：屋顶设备、检修口和通道没有扣除，组件数和发电量可能偏多。',
    keepOutSome: (count) => `已扣除 ${count} 个禁装区；没圈出的设备不会扣除。`,
    drawKeepOut: '去圈禁装区',
    energyBasis: '年发电量：按纽约典型气象年（PVGIS-ERA5，2005–2023）逐小时估算，与日照栏所选的日期和时刻无关。',
    pvwattsRange: (low, high) => `该气象数据比 NREL 的 PVWatts 偏晴 5–8%；按 PVWatts 口径，年发电量约 ${low}–${high} kWh。`,
    sunBasis: '日照栏：只示意所选某一时刻的光照和阴影，其中的直射比例也只代表这一刻，不代表全年。',
    modelBasis: (release, width, height, watts) => `建筑模型：纽约 LoD2 三维模型（${release} 年），可能与现状不同。组件 ${width} × ${height} m、${watts} W。已计入入射角损失、温度损失、14% 系统损失和 96% 逆变器效率；未考虑树木、结构承载和电气设计。`,
    back: '返回设计',
  },
  workspace: {
    label: '方案工作区',
    heatmapShow: '查看逐块年发电表现',
    heatmapOn: '年发电表现 · 已开启',
    heatmapLegend: ['<65%', '75%', '85%', '90%+'],
    heatmapNote: '每块板的年发电量相对同地点理想无遮挡组件的比例，不随当前显示的时刻变化。',
    heatmapSelected: '选中的组件保持蓝色高亮。',
    panel: (id) => `组件 #${id}`,
    panelKwh: (kwh) => `${kwh} kWh/年`,
    panelPose: (tilt, azimuth) => `倾角 ${tilt}° · 朝向 ${azimuth}°`,
    compareTitle: '方案 A / B 对比',
    compareNote: '两组方案按同一建筑、组件规格和遮挡条件重新计算。保存会覆盖对应槽位；应用后可撤销布局，参数保留。',
    save: (slot) => `保存当前为 ${slot}`,
    apply: (slot) => `应用 ${slot}`,
    metricsLabel: '方案比较指标',
    modules: '组件数量',
    capacity: '容量 kW',
    annual: 'kWh/年',
    specific: 'kWh/kW/年',
    delta: (kwh, percent) => `B − A：${kwh} kWh/年${percent ? `（${percent}）` : ''}`,
    saved: '草稿和 A/B 已保存在此浏览器（仅最近一栋建筑）。',
    saveFailed: '无法保存到此浏览器，离开前请先复制方案链接。',
    autosave: '编辑会自动保存到此浏览器。',
    draftTitle: '继续上次的设计？',
    draftDetail: (label, count, time) => `${label} · ${count} 块组件 · ${time}`,
    restore: '恢复设计',
    discard: '丢弃草稿',
  },
  attribution: '影像 © NYS ITS Geospatial Services · 三维模型 NYC Open Data / TUM · 地址搜索 NYC Planning Labs GeoSearch',
};

const DICTS: Record<Lang, Dict> = { en, zh };
const STORAGE_KEY = 'nyc-solar-language';
const CHANGE_EVENT = 'nyc-solar-language-change';

// English is the default; only an explicit choice is persisted. The in-memory
// copy keeps the choice for this page when storage is blocked.
let chosenLang: Lang | null = null;

function readLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  return chosenLang ?? 'en';
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

const I18nContext = createContext<{ lang: Lang; t: Dict; setLang: (lang: Lang) => void }>({
  lang: 'en',
  t: en,
  setLang: () => {},
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const lang = useSyncExternalStore(subscribe, readLang, () => 'en' as const);
  const setLang = useCallback((value: Lang) => {
    chosenLang = value;
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* storage unavailable */
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);
  return (
    <I18nContext.Provider value={{ lang, t: DICTS[lang], setLang }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
