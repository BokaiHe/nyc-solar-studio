'use client';

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';

export type Lang = 'en' | 'zh';

const en = {
  switchTo: '中文',
  switchLabel: 'Switch to Chinese',
  messages: {
    start: 'Search an address, or click a building on the satellite map.',
    loading: 'Reading rooftop solar data…',
    ready: 'Click candidate slots to add panels; press and drag a panel to move it.',
    noData: 'No detailed roof data is available for this building.',
    solarUnavailable: 'The Solar service is temporarily unavailable. Please try again later.',
    mapsForbidden: 'Google Maps JavaScript API is not enabled, or the key lacks permission.',
    mapsFailed: 'The satellite map failed to load. Check the Maps JavaScript API.',
  },
  warnings: {
    roofDataChanged: 'Google roof data has changed; this layout may differ from the shared one.',
    modelChanged: 'The matched 3D building differs from the shared one; the 3D layout was not loaded.',
  },
  share: {
    copied3d: '3D design link copied',
    copiedWithMoves: 'Copied; dragged panel positions are not included in the link',
    copied: 'Link copied',
  },
  quality: { HIGH: 'High-quality', MEDIUM: 'Medium-quality', BASE: 'Base-quality' },
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
  model3d: {
    loadingTitle: 'Loading NYC 3D building',
    loadingBody: 'Reading roof and wall surfaces…',
    errorTitle: "This building's 3D model can't be loaded right now",
    errorBody: 'No historical 3D model matched this location, or the service is unavailable. Pick another building on the map, or continue in 2D.',
    back2d: 'Back to 2D design',
  },
  header: {
    home: 'Back to explore',
    examples: 'Examples',
    search: 'Search NYC addresses or buildings',
  },
  intro: {
    title: 'Design a solar array on satellite rooftops',
    body: 'Search an address, or rotate the map and click a roof to begin.',
  },
  loadingPill: 'Reading roof data…',
  cannotAnalyze: "This building can't be analyzed",
  reselect: 'Choose again',
  focus: {
    eyebrow: 'Building selected',
    meta: (quality: string, date: string, count: number) => `${quality} imagery · ${date} · ${count} candidate slots`,
    enter3d: 'Open isolated 3D design',
    design2d: '2D roof design',
    viewSun: 'View sunlight',
  },
  tabs: { design: 'Design', sun: 'Sun', results: 'Results' },
  surface: { roof2d: '2D roof', isolated3d: 'Isolated 3D' },
  tools: { select: 'Select', place: 'Place', sun: 'Sun', results: 'Results' },
  design2d: {
    eyebrow: 'Solar design',
    title: (count: number, kw: string) => `${count} panels · ${kw} kW`,
    intro: 'Pick a recommended size first; edit only when you need to fine-tune.',
    presets: { small: 'Small', balanced: 'Balanced', full: 'Google max' },
    panels: (count: number) => `${count} panels`,
    count: 'Panel count',
    finishEdit: 'Done editing',
    fineTune: 'Fine-tune slots',
    editHint: 'Light outlines are candidate slots. Click to add or remove; press and drag a blue panel to move it.',
    groupRotation: 'Rotate group',
    activePanel: (index: number) => `Panel #${index}`,
    moved: (count: number) => `${count} moved`,
    restore: 'Restore recommended positions',
    nextSun: 'Next: sunlight simulation',
    footnote: 'Dragged layouts are conceptual; the Google yearly baseline still uses the original recommended slots.',
  },
  portraitLandscape: 'Portrait / Landscape',
  sun: {
    eyebrow: 'Sun position',
    azimuth: 'Azimuth',
    altitude: 'Altitude',
    direct: (percent: number, is3D: boolean) => `${is3D ? '3D panels' : 'Panels'} receive ${percent}% of direct light now. Drag the timeline below to follow the day.`,
    date: 'Simulation date',
    play: 'Play',
    pause: 'Pause',
    time: 'Time of day',
  },
  results: {
    eyebrow: 'Results',
    eyebrow3d: '3D results',
    title: (kw: string) => `${kw} kW rooftop system`,
    panels: 'Panels',
    panelCount: (count: number) => `${count}`,
    layout: 'Concept layout',
    layout3d: '3D concept layout',
    energy: 'Annual energy baseline',
    energy3d: 'Annual energy estimate',
    energyDetail: 'Google recommended layout',
    energyDetail3d: 'Google per-panel average',
    carbon: 'Annual CO₂ baseline',
    carbon3d: 'Annual CO₂ estimate',
    carbonDetail: 'Local grid factor',
    direct: 'Direct light now',
    directDetail: 'Geometric simulation',
    note3d: '3D annual energy ignores orientation, tilt and shading; it scales with panel count only.',
    rate: 'Electricity rate (USD/kWh)',
    share: 'Copy design link',
    imagery: (quality: string, date: string) => `${quality} · imagery date ${date}`,
    derate: 'Annual energy applies a 0.85 DC→AC derate.',
  },
  attribution: 'Includes solar data from Google · Map imagery © Google',
  closePanel: 'Close panel',
  designer: {
    eyebrow: 'Idealized 3D design',
    count: (count: number) => `${count} panels`,
    intro: 'Click the roof to add panels; drag a blue panel to move it. Conceptual only — requires engineering review.',
    modelTitle: 'NYC 3D building · LoD2',
    modelHeight: (height: string, release: string) => `Model height ${height} m · TUM ${release} release`,
    modelSource: 'Source: NYC Open Data / TUM. Historical model; original roof shape preserved.',
    azimuth: 'Facing azimuth (°)',
    tilt: 'Rack tilt (°)',
    setback: 'Roof setback (m)',
    rowSpacing: 'Row spacing (m)',
    autoLayout: 'Generate tidy array',
    panelInfo: (id: number, azimuth: number) => `Panel #${id} · facing ${azimuth}°`,
    delete: 'Delete panel',
    clear: 'Clear',
  },
  map: {
    label: 'Satellite roof design map',
    loading: 'Loading satellite map…',
    hint: 'Scroll to zoom · drag to pan · click a roof to start',
  },
};

export type Dict = typeof en;

const zh: Dict = {
  switchTo: 'EN',
  switchLabel: '切换到英文',
  messages: {
    start: '搜索地址，或直接在卫星地图中点击一栋建筑。',
    loading: '正在读取屋顶光伏数据…',
    ready: '点击候选板位添加；按住光伏板拖动可自定义位置。',
    noData: '这栋建筑暂无可用的精细屋顶数据。',
    solarUnavailable: 'Solar 服务暂时不可用，请稍后重试。',
    mapsForbidden: 'Google Maps JavaScript API 尚未启用或 Key 没有权限。',
    mapsFailed: '卫星设计地图加载失败，请检查 Maps JavaScript API。',
  },
  warnings: {
    roofDataChanged: 'Google 屋顶数据已更新，当前布局可能与分享时不同。',
    modelChanged: '匹配到的三维建筑与分享时不同，3D 布局未载入。',
  },
  share: {
    copied3d: '3D 方案链接已复制',
    copiedWithMoves: '已复制；自定义拖动位置暂未写入链接',
    copied: '链接已复制',
  },
  quality: { HIGH: '高精度', MEDIUM: '中等精度', BASE: '基础精度' },
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
  model3d: {
    loadingTitle: '正在加载纽约三维建筑',
    loadingBody: '读取建筑的屋顶与墙面…',
    errorTitle: '这栋建筑暂时无法加载3D模型',
    errorBody: '该位置的历史三维模型未匹配或服务暂不可用。可以返回地图重新选楼，或继续2D设计。',
    back2d: '返回2D设计',
  },
  header: {
    home: '返回探索',
    examples: '示例',
    search: '搜索纽约地址或建筑',
  },
  intro: {
    title: '在卫星屋顶上完成光伏方案设计',
    body: '搜索地址，或旋转地图后点击屋顶开始。',
  },
  loadingPill: '正在读取屋顶数据…',
  cannotAnalyze: '当前建筑无法分析',
  reselect: '重新选择',
  focus: {
    eyebrow: '已锁定建筑',
    meta: (quality, date, count) => `${quality}影像 · ${date} · ${count} 个候选板位`,
    enter3d: '进入孤立3D设计',
    design2d: '2D屋顶设计',
    viewSun: '查看日照',
  },
  tabs: { design: '设计', sun: '日照', results: '结果' },
  surface: { roof2d: '2D屋顶', isolated3d: '孤立3D' },
  tools: { select: '选择', place: '铺板', sun: '日照', results: '结果' },
  design2d: {
    eyebrow: '光伏设计',
    title: (count, kw) => `${count} 块 · ${kw} kW`,
    intro: '先选推荐规模，需要微调时再进入编辑。',
    presets: { small: '小型方案', balanced: '均衡方案', full: 'Google 铺满' },
    panels: (count) => `${count} 块`,
    count: '组件数量',
    finishEdit: '完成编辑',
    fineTune: '微调板位',
    editHint: '浅色轮廓为候选位置。点击可增删，按住蓝色组件可拖动。',
    groupRotation: '整组方向',
    activePanel: (index) => `当前组件 #${index}`,
    moved: (count) => `${count} 块已移动`,
    restore: '恢复推荐位置',
    nextSun: '下一步：日照模拟',
    footnote: '拖动布局属于概念设计；Google 年发电基准仍对应原始推荐板位。',
  },
  portraitLandscape: '横 / 竖',
  sun: {
    eyebrow: '太阳位置',
    azimuth: '方位角',
    altitude: '高度角',
    direct: (percent, is3D) => `当前${is3D ? ' 3D ' : ''}板面相对直射 ${percent}%。拖动下方时间轴观察一天变化。`,
    date: '模拟日期',
    play: '播放',
    pause: '暂停',
    time: '一天中的时间',
  },
  results: {
    eyebrow: '方案结果',
    eyebrow3d: '3D 方案结果',
    title: (kw) => `${kw} kW 屋顶系统`,
    panels: '光伏板',
    panelCount: (count) => `${count} 块`,
    layout: '概念布局',
    layout3d: '3D 概念布局',
    energy: '年发电基准',
    energy3d: '年发电估算',
    energyDetail: 'Google 推荐布局',
    energyDetail3d: 'Google 同规模单板均值',
    carbon: '年减碳基准',
    carbon3d: '年减碳估算',
    carbonDetail: '基于当地电网',
    direct: '当前直射',
    directDetail: '几何模拟',
    note3d: '3D 年发电不随朝向、倾角和遮挡变化，仅按组件数量估算。',
    rate: '电价假设（USD/kWh）',
    share: '复制方案链接',
    imagery: (quality, date) => `${quality} · 影像日期 ${date}`,
    derate: '年发电量采用 0.85 DC→AC 折减。',
  },
  attribution: 'Includes solar data from Google · 地图影像 © Google',
  closePanel: '关闭面板',
  designer: {
    eyebrow: '理想化3D设计',
    count: (count) => `${count} 块组件`,
    intro: '点击屋顶添加，拖动蓝色组件调整位置。概念级方案需工程复核。',
    modelTitle: '纽约三维建筑 · LoD2',
    modelHeight: (height, release) => `模型高度 ${height} m · TUM ${release} 版`,
    modelSource: '来源：NYC Open Data / TUM。历史模型，保留原始屋顶形状。',
    azimuth: '朝向方位 (°)',
    tilt: '支架倾角 (°)',
    setback: '屋面退距 (m)',
    rowSpacing: '行间距 (m)',
    autoLayout: '生成整齐阵列',
    panelInfo: (id, azimuth) => `组件 #${id} · 朝向 ${azimuth}°`,
    delete: '删除组件',
    clear: '清空',
  },
  map: {
    label: '屋顶卫星设计地图',
    loading: '正在加载卫星地图…',
    hint: '滚轮缩放 · 按住拖动地图 · 点击屋顶开始',
  },
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
