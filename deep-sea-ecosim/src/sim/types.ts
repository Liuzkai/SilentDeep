// 生态核心类型。本目录不依赖 Three.js、DOM、帧率或相机。

/** 生物量库顺序固定：R 基础饵料，A/B 小型摄食鱼，C 中型捕食鱼，D 大型捕食鱼 */
export const POOLS = ['R', 'A', 'B', 'C', 'D'] as const;
export type PoolId = (typeof POOLS)[number];
export const FISH = ['A', 'B', 'C', 'D'] as const;
export type FishId = (typeof FISH)[number];

export const NPOOL = 5;
export const NLAYER = 3;
export const LAYER_NAMES = ['L1', 'L2', 'L3'] as const;
export const LAYER_DEPTHS: readonly (readonly [number, number])[] = [[600, 900], [900, 1200], [1200, 1500]];

/** 5×3 矩阵：X[pool][layer]，单位 BU（归一化碳生物量，不是千克也不是条数） */
export type PoolLayer = number[][];

export interface FishParams {
  /** 初始总生物量，BU */
  initialTotal: number;
  /** 单位捕食者生物量的最大摄食率，1/模拟日 */
  q: number;
  /** 半饱和饵料量，BU */
  H: number;
  /** 摄食转化为活体生物量的比例，无量纲 */
  eta: number;
  /** 背景生物量损失率，1/模拟日 */
  m: number;
  /** 层间分布调整率，1/模拟日 */
  mu: number;
  /** 三层目标分布权重，和为 1 */
  p: [number, number, number];
}

export interface ResourceParams {
  /** R 的初始分层生物量，BU */
  initial: [number, number, number];
  /** 外部净补给，BU/模拟日 */
  J: [number, number, number];
  /** 背景损失率，1/模拟日 */
  m: number;
}

export interface EcoConfig {
  /** 捕食偏好矩阵 a[捕食者][被摄食对象]，索引按 POOLS；R 行必须全为 0 */
  a: number[][];
  fish: Record<FishId, FishParams>;
  R: ResourceParams;
  /** 默认生态时间步，模拟日 */
  dt: number;
  /** 捕捞强度 u=1 时的捕捞损失率，1/模拟日 */
  Fmax: number;
}

export interface EcoState {
  /** 模拟时间，模拟日 */
  t: number;
  /** 已执行步数 */
  steps: number;
  X: PoolLayer;
  /** 累计捕获量，BU，[pool][layer]（R 始终为 0） */
  cumCatch: PoolLayer;
}

/** 捕捞层选择：0/1/2 或 'all' */
export type LayerTarget = 0 | 1 | 2 | 'all';

export interface FishingSetting {
  enabled: boolean;
  target: FishId;
  layer: LayerTarget;
  /** 0–1，控制持续损失率 F = u·Fmax，不是每次捕获百分比 */
  u: number;
}

export interface Interventions {
  fishing: FishingSetting;
  /** 外部基础饵料补给倍率，0–2 */
  supplyMultiplier: number;
}

/** 单步收支明细。通量均为本步量（BU），不是速率 */
export interface StepLedger {
  dt: number;
  /** 需求速率 U[layer][pred][prey]，BU/模拟日 */
  U: number[][][];
  /** 实际摄食量 C[layer][pred][prey]，BU/步 */
  C: number[][][];
  /** 每个库每层的移除量（捕食+背景+捕捞） */
  remove: PoolLayer;
  /** 被捕食损失 */
  predLoss: PoolLayer;
  background: PoolLayer;
  catch: PoolLayer;
  /** 鱼类摄食收益 eta·ΣC，R 行为 0 */
  gain: PoolLayer;
  /** 未保留的摄食部分 (1-eta)·ΣC */
  unretained: PoolLayer;
  /** R 的外部补给 J·h */
  supply: PoolLayer;
  /** 层间交换净变化（R 行为 0） */
  migration: PoolLayer;
  /** 本步开始时的库存 */
  before: PoolLayer;
  /** 生态更新后、层间交换前 */
  afterFlux: PoolLayer;
  /** 最终库存 */
  after: PoolLayer;
}

export interface BudgetCheck {
  ok: boolean;
  /** 实际总变化 */
  delta: number;
  /** 账本预期变化 J·h − 背景 − 捕获 − 未保留 */
  expected: number;
  error: number;
  tolerance: number;
  /** 层间交换对每个物种总量的改变（应为 ~0） */
  migrationError: number;
}

export interface ValidationResult {
  ok: boolean;
  problems: string[];
}
