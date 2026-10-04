// v0.2 生态核心类型：水平海域网格 × 三个深度层 × 可配置物种。
// 本目录不依赖 DOM、Canvas、帧率或界面状态。

export const NLAYER = 3;
export const LAYER_TOP = [600, 900, 1200] as const;
export const LAYER_BOTTOM = [900, 1200, 1500] as const;
export const LAYER_MID = [750, 1050, 1350] as const;

export interface ThermalResponse {
  /** 最适温度 °C */
  Topt: number;
  /** 热生态位宽度 °C：摄食表现 = exp(−((T−Topt)/Tsig)²) */
  Tsig: number;
  /** 代谢温度系数：摄食上限和背景损失都乘 Q10^((T−Tref)/10) */
  Q10: number;
}

export interface EncounterParams {
  /** 参考密度下每小时的期望接触次数 */
  base: number;
  /** 噪声吸引系数：本艇噪声每高出 100 dB 10 dB，期望次数乘 (1 + noiseAttract) */
  noiseAttract: number;
}

export interface SpeciesDef {
  /** 短代号，作为库的键 */
  id: string;
  name: string;
  /** resource 只有补给和背景损失；fish/mutant 都走同一套摄食方程，mutant 只是参数上对辐射耐受 */
  group: 'resource' | 'fish' | 'mutant';
  tier?: string;
  /** 一个完整水柱（三层体积都完整）的初始生物量，BU */
  initialPerColumn: number;
  q: number; H: number; eta: number; m: number; mu: number;
  /** 三层目标分布权重（未受环境调整时），和为 1 */
  p: [number, number, number];
  /** 捕食偏好：被摄食对象 id → 相对权重 */
  diet: Record<string, number>;
  thermal: ThermalResponse | null;
  /** 辐射额外损失率，1/模拟日/RU */
  radSens: number;
  /** 辐射对栖息偏好的影响：权重乘 exp(radPref·I/(1+I))，负值回避、正值趋近 */
  radPref: number;
  /** 台风扰动额外损失率，1/模拟日/单位扰动 */
  stormSens: number;
  /** 台风扰动对栖息偏好的影响：权重乘 exp(−stormAvoid·扰动) */
  stormAvoid: number;
  /** 扰动时层间调整率的附加值：μ_eff = μ + stormFlee·扰动（只重新分配） */
  stormFlee: number;
  /** 底栖：只能分布在海底所在的那一层 */
  benthic: boolean;
  /** 对深海沟（海底深于 1500 m）的水平偏好 0–1 */
  trenchPref: number;
  /** 水平扩散交换率，1/模拟日/每个相邻格 */
  Dh: number;
  /** 随洋流漂移的比例 0–1 */
  adv: number;
  enc: EncounterParams | null;
}

export interface Coupling {
  temperature: boolean;
  radiation: boolean;
  storms: boolean;
  /** 海底深度决定各层是否存在、占多大体积 */
  bathymetry: boolean;
  /** 格子之间的水平输运 */
  horizontal: boolean;
}

export interface StormResponse {
  /** 海面扰动传到三层的比例（游戏设定：内波和近惯性振荡把能量带到深处） */
  layerFactor: [number, number, number];
  /** 台风带来的有机物沉降脉冲对 R 补给的增益 */
  pulseGain: number;
  /** 沉降延迟链的时间常数，模拟日：海面 → L1 → L2 → L3 */
  pulseTau: [number, number, number];
  /** L1 的混合降温，°C/单位扰动 */
  coolL1: number;
}

export interface EcoConfig {
  version: string;
  /** species[0] 必须是基础饵料 R */
  species: SpeciesDef[];
  resource: {
    /** 完整层体积下的外部净补给，BU/模拟日 */
    J: [number, number, number];
    /** 完整层体积下的初始生物量，BU */
    initial: [number, number, number];
  };
  dt: number;
  Fmax: number;
  /** 代谢参考温度 °C */
  Tref: number;
  /** 背景辐射 RU */
  radBackground: number;
  /** 辐射源的水平和垂直衰减尺度 */
  radLh: number; radLv: number;
  storm: StormResponse;
  couple: Coupling;
}

export interface RadSource {
  id: string;
  name: string;
  /** 格子坐标（可以是小数） */
  x: number; y: number;
  /** 源的深度 m */
  depth: number;
  /** t0 时的强度 RU */
  S0: number;
  t0: number;
  /** 半衰期，模拟日；Infinity 表示不衰减 */
  halfLife: number;
}

export interface Storm {
  id: string;
  name: string;
  t0: number;
  /** 持续时间，模拟日 */
  duration: number;
  /** 起点（格子坐标）和移动速度（格/模拟日） */
  x0: number; y0: number; vx: number; vy: number;
  /** 半径，格 */
  radius: number;
  intensity: number;
}

export interface World {
  seed: number;
  nx: number; ny: number;
  /** 格子边长 km */
  dx: number;
  /** 海底深度 m，长度 nx·ny */
  floor: Float64Array;
  /**
   * 洋流流函数，定义在格点角上，(nx+1)·(ny+1)，单位 1/模拟日（已按格子面积归一化）。
   * 东侧面输运率 = psi[x+1][y+1] − psi[x+1][y]，北侧面 = psi[x][y+1] − psi[x+1][y+1]，
   * 所以每个格子的净输运恒为 0（网格上严格无辐散），边界 psi=0 表示闭合边界。
   */
  psi: Float64Array;
  /** 格心流速，只用于绘图，km/模拟日 */
  u: Float64Array; v: Float64Array;
  /** 基础温度 °C，[cell][layer] */
  Tbase: Float64Array;
  radSources: RadSource[];
  /** 自然台风（对照组和实验组共享） */
  storms: Storm[];
  landmarks: { name: string; x: number; y: number }[];
}

export type LayerTarget = 0 | 1 | 2 | 'all';

export interface FishingSetting {
  enabled: boolean;
  target: string;
  layer: LayerTarget;
  /** 0–1，F = u·Fmax */
  u: number;
  /** null = 全海域；否则只在以 (cx,cy) 为中心、半径 r 格的范围内 */
  region: { cx: number; cy: number; r: number } | null;
}

export interface Interventions {
  fishing: FishingSetting;
  /** 外部基础饵料补给倍率 0–2 */
  supplyMultiplier: number;
  /** 全海域温度距平 °C，−4 到 +4 */
  tempAnomaly: number;
}

export interface EcoState {
  t: number;
  steps: number;
  /** 生物量 BU，索引 (pool·ncell + cell)·3 + layer */
  X: Float64Array;
  cumCatch: Float64Array;
  /** 台风沉降延迟链状态（环境量，不是生物量），[cell][stage 0..2] */
  rain: Float64Array;
  /** 本组额外的台风和辐射源（干预产生的） */
  extraStorms: Storm[];
  extraSources: RadSource[];
}

/** 带模拟时间戳的干预记录。t 相对实验起点；可以改变持续干预，也可以追加一场台风或一个辐射源 */
export interface ScheduleEvent {
  t: number;
  label: string;
  interventions?: Interventions;
  addStorm?: Storm;
  addSource?: RadSource;
}
export type Schedule = ScheduleEvent[];

/** 一步内的环境快照 */
export interface EnvSnapshot {
  t: number;
  /** 各层体积比例 0–1 */
  vol: Float64Array;
  /** 海底所在层，-1 = 海底浅于 600 m（模型域外），3 = 深于 1500 m */
  floorLayer: Int8Array;
  T: Float64Array;
  I: Float64Array;
  dist: Float64Array;
  /** R 补给的台风脉冲倍率 */
  boost: Float64Array;
}

export interface Ledger {
  dt: number;
  /** 各类量都是本步量 BU，形状同 X */
  gain: Float64Array; predLoss: Float64Array; background: Float64Array; catch: Float64Array;
  radLoss: Float64Array; stormLoss: Float64Array; unretained: Float64Array; supply: Float64Array;
  vmig: Float64Array; hmig: Float64Array;
  /** 每格的实际摄食量（三层合计），索引 (cell·P + pred)·P + prey */
  Ccell: Float64Array;
  totalBefore: number; totalAfter: number;
}

export interface BudgetCheck {
  ok: boolean; delta: number; expected: number; error: number; tolerance: number;
  vmigError: number; hmigError: number;
}

export interface ValidationResult { ok: boolean; problems: string[] }
