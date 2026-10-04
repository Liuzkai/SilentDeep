// 生物量 → 可视化实例数量。纯函数，不依赖 Three.js，只读生态状态。
// 实例只是抽样表现，不是真实鱼的计数；换预算只改变画面密度，不改变生态状态。
import { FISH, NLAYER, type PoolLayer } from '../sim';

/** 每个可视实例代表的生物量（BU/实例），固定值：生物量下降时鱼群会变稀，而不是被重新归一化成满屏 */
export const BU_PER_INSTANCE: Record<string, number> = { A: 0.18, B: 0.18, C: 0.06, D: 0.02 };

export interface Allocation {
  /** counts[fishIdx][layer] */
  counts: number[][];
  /** 是否因为总预算上限而整体降采样 */
  capped: boolean;
  /** 很低但非零（不足一个实例）的物种×层 */
  low: boolean[][];
}

export function allocateInstances(X: Readonly<PoolLayer>, budget: number, visible: Record<string, boolean> = {}): Allocation {
  const raw = FISH.map((s, i) => Array.from({ length: NLAYER }, (_, k) => (visible[s] === false ? 0 : X[i + 1][k] / BU_PER_INSTANCE[s])));
  const sum = raw.flat().reduce((a, b) => a + b, 0);
  const capped = sum > budget;
  const f = capped ? budget / sum : 1;
  const low = raw.map(r => r.map(v => v > 0 && v * f < 1));
  // 低生物量但非零：保留 1 个实例作为可见提示（界面同时标注"低生物量"）
  const counts = raw.map((r, i) => r.map((v, k) => (v <= 0 ? 0 : low[i][k] ? 1 : Math.floor(v * f))));
  return { counts, capped, low };
}
