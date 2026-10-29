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
  apiKey: {
    title: 'API key required',
    before: 'Add your Google Maps and Solar API keys to ',
    after: '.',
  },
  map: {
    label: 'Satellite map for picking a building',
    loading: 'Loading satellite map…',
    hint: 'Scroll to zoom · drag to pan · click a roof to select it',
    forbidden: 'Google Maps JavaScript API is not enabled, or the key lacks permission.',
    failed: 'The satellite map failed to load. Check the Maps JavaScript API.',
  },
  select: {
    idleTitle: 'Design a solar array on NYC rooftops',
    idleBody: 'Search an address, or click a roof on the satellite map to begin.',
    loadingTitle: 'Loading the building…',
    loadingBody: 'Matching the NYC 3D model and Google Solar data.',
    noModelTitle: 'No 3D model at this spot',
    noModelBody: 'The NYC / TUM model has no building here. Try clicking closer to the middle of the roof.',
    errorTitle: "This building couldn't be loaded",
    errorBody: 'The model service is unavailable right now. Please try again.',
    eyebrow: 'Selected building',
    modelHeight: (height: string, release: string) => `Model height ${height} m · TUM ${release} release`,
    modelSource: 'NYC Open Data / TUM LoD2. Historical survey; the building may have changed.',
    googleReady: (quality: string, date: string) => `Google Solar: ${quality} imagery, ${date}`,
    googleMissing: 'No Google Solar data here — energy estimates will be unavailable.',
    start: 'Design this roof',
  },
  quality: { HIGH: 'high-quality', MEDIUM: 'medium-quality', BASE: 'base-quality' },
  design: {
    eyebrow: 'Roof design',
    count: (count: number) => `${count} panels`,
    capacity: (kw: string) => `${kw} kW`,
    collapse: 'Collapse panel',
    expand: 'Expand panel',
    sharedModelChanged: 'The matched building differs from the shared one, so the shared layout was not loaded.',
    statusAuto: 'Auto layout · updates as you change settings',
    statusEdited: 'Edited by hand',
    applySettings: 'Apply new settings',
    applyHint: 'Replaces your hand edits; Undo brings them back.',
    regenerate: 'Regenerate array',
    generate: 'Generate array',
    generating: 'Generating…',
    layoutTitle: 'Array settings',
    azimuth: 'Facing (°)',
    tilt: 'Rack tilt (°)',
    setback: 'Setback (m)',
    rowSpacing: 'Row gap (m)',
    moreOptions: 'More options',
    alignToRoof: 'Align rows to the building',
    includeShaded: 'Include shaded or poorly facing spots',
    maxPanels: 'Max panels (0 = fill)',
    layoutSummary: (placed: number, shaded: number) => shaded
      ? `${placed} placed · ${shaded} shaded or poorly facing spots skipped`
      : `${placed} placed`,
    layoutEmpty: 'No panel fits with these settings. Try a smaller setback or row gap.',
    flatRoofNote: 'Flat roofs get tilted racks; pitched roofs get flush panels along their slope.',
    undo: 'Undo',
    redo: 'Redo',
    clear: 'Clear all',
    next: 'See results',
  },
  tools: {
    label: 'Editing tools',
    select: 'Select',
    add: 'Place',
    erase: 'Erase',
    selectHint: 'Drag on the roof to box-select · Shift adds · drag panels to move',
    addHint: 'Click the roof to place a panel · it snaps to nearby rows',
    eraseHint: 'Click or drag across panels to erase',
    orbitHint: 'Drag the sky to orbit · right-drag to pan · scroll to zoom',
    resetView: 'Reset view',
    topView: 'Top view',
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
    toggle: 'Sun',
    hide: 'Hide sun controls',
    date: 'Simulation date',
    play: 'Play',
    pause: 'Pause',
    time: 'Time of day',
    position: (azimuth: string, altitude: string) => `Sun azimuth ${azimuth}° · altitude ${altitude}°`,
    direct: (percent: number) => `Panels receive ${percent}% of direct light`,
  },
  results: {
    eyebrow: 'Results',
    title: (kw: string) => `${kw} kW rooftop system`,
    panels: 'Panels',
    panelCount: (count: number) => `${count}`,
    layout: '3D concept layout',
    energy: 'Annual energy',
    energyDetail: 'Google per-panel average',
    carbon: 'Annual CO₂ offset',
    carbonDetail: 'Local grid factor',
    savings: 'Annual bill value',
    savingsDetail: 'At the rate below',
    unavailable: '—',
    noGoogle: 'No Google Solar data for this building, so only capacity is shown.',
    note: 'Energy currently scales with panel count only; orientation, tilt and shading are not modeled yet.',
    rate: 'Electricity rate (USD/kWh)',
    share: 'Copy design link',
    copied: 'Design link copied',
    derate: 'Annual energy applies a 0.85 DC→AC derate.',
    back: 'Back to design',
  },
  attribution: 'Includes solar data from Google · Map imagery © Google · 3D model NYC Open Data / TUM',
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
  apiKey: {
    title: '需要配置 API Key',
    before: '请在 ',
    after: ' 中填写 Google Maps 与 Solar API Key。',
  },
  map: {
    label: '用于选择建筑的卫星地图',
    loading: '正在加载卫星地图…',
    hint: '滚轮缩放 · 按住拖动地图 · 点击屋顶选中建筑',
    forbidden: 'Google Maps JavaScript API 尚未启用或 Key 没有权限。',
    failed: '卫星地图加载失败，请检查 Maps JavaScript API。',
  },
  select: {
    idleTitle: '在纽约屋顶上设计光伏方案',
    idleBody: '搜索地址，或在卫星地图上点击一个屋顶开始。',
    loadingTitle: '正在加载建筑…',
    loadingBody: '正在匹配纽约三维模型与 Google Solar 数据。',
    noModelTitle: '这里没有三维模型',
    noModelBody: 'NYC / TUM 模型在这个位置没有建筑。试着点击屋顶更靠中间的位置。',
    errorTitle: '这栋建筑加载失败',
    errorBody: '模型服务暂时不可用，请稍后重试。',
    eyebrow: '已选建筑',
    modelHeight: (height, release) => `模型高度 ${height} m · TUM ${release} 版`,
    modelSource: 'NYC Open Data / TUM LoD2。历史测绘，建筑可能已改建。',
    googleReady: (quality, date) => `Google Solar：${quality}影像，${date}`,
    googleMissing: '此处没有 Google Solar 数据，将无法估算发电量。',
    start: '设计这个屋顶',
  },
  quality: { HIGH: '高精度', MEDIUM: '中等精度', BASE: '基础精度' },
  design: {
    eyebrow: '屋顶设计',
    count: (count) => `${count} 块组件`,
    capacity: (kw) => `${kw} kW`,
    collapse: '收起面板',
    expand: '展开面板',
    sharedModelChanged: '匹配到的建筑与分享时不同，分享的布局未载入。',
    statusAuto: '自动布局 · 修改参数会实时更新',
    statusEdited: '已手动编辑',
    applySettings: '应用新参数',
    applyHint: '会替换手动编辑的结果，可用撤销恢复。',
    regenerate: '重新生成阵列',
    generate: '生成阵列',
    generating: '正在生成…',
    layoutTitle: '阵列参数',
    azimuth: '朝向 (°)',
    tilt: '支架倾角 (°)',
    setback: '退距 (m)',
    rowSpacing: '行间距 (m)',
    moreOptions: '更多选项',
    alignToRoof: '行列对齐建筑方向',
    includeShaded: '包含被遮挡或朝向差的位置',
    maxPanels: '最多组件数（0 = 铺满）',
    layoutSummary: (placed, shaded) => shaded
      ? `已放置 ${placed} 块 · 跳过 ${shaded} 个被遮挡或朝向差的位置`
      : `已放置 ${placed} 块`,
    layoutEmpty: '按当前参数放不下组件，可以减小退距或行间距。',
    flatRoofNote: '平屋顶使用倾斜支架；坡屋顶沿坡面贴装。',
    undo: '撤销',
    redo: '重做',
    clear: '全部清空',
    next: '查看结果',
  },
  tools: {
    label: '编辑工具',
    select: '选择',
    add: '放置',
    erase: '擦除',
    selectHint: '在屋顶上拖动框选 · Shift 追加 · 拖动组件可移动',
    addHint: '点击屋顶放置组件 · 会自动吸附到附近的行列',
    eraseHint: '点击或拖过组件即可擦除',
    orbitHint: '在空白处拖动旋转 · 右键拖动平移 · 滚轮缩放',
    resetView: '重置视角',
    topView: '俯视',
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
    toggle: '日照',
    hide: '收起日照控制',
    date: '模拟日期',
    play: '播放',
    pause: '暂停',
    time: '一天中的时间',
    position: (azimuth, altitude) => `太阳方位角 ${azimuth}° · 高度角 ${altitude}°`,
    direct: (percent) => `板面相对直射 ${percent}%`,
  },
  results: {
    eyebrow: '方案结果',
    title: (kw) => `${kw} kW 屋顶系统`,
    panels: '光伏板',
    panelCount: (count) => `${count} 块`,
    layout: '3D 概念布局',
    energy: '年发电量',
    energyDetail: 'Google 同规模单板均值',
    carbon: '年减碳',
    carbonDetail: '基于当地电网',
    savings: '年电费价值',
    savingsDetail: '按下方电价',
    unavailable: '—',
    noGoogle: '这栋建筑没有 Google Solar 数据，只显示装机容量。',
    note: '目前发电量只随组件数量变化，尚未考虑朝向、倾角和遮挡。',
    rate: '电价假设（USD/kWh）',
    share: '复制方案链接',
    copied: '方案链接已复制',
    derate: '年发电量采用 0.85 DC→AC 折减。',
    back: '返回设计',
  },
  attribution: 'Includes solar data from Google · 地图影像 © Google · 三维模型 NYC Open Data / TUM',
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
