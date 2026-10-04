import { FISH, NLAYER, NPOOL, type EcoConfig, type Interventions, type PoolLayer, type StepLedger } from './types';
import { feedingDemand } from './feeding';
import { fishingRates } from './fishing';
import { zeros, cloneMatrix } from './initial-state';

/** 每个库的背景损失率 m_j */
export const lossRates = (config: EcoConfig): number[] => [config.R.m, ...FISH.map(s => config.fish[s].m)];

/**
 * 第五节：同一快照计算所有通量，统一提交。只做摄食、背景损失、捕捞与 R 补给，不含层间交换。
 * 返回更新后的 X_next 和本步账本的通量部分。
 */
export function fluxStep(X: PoolLayer, config: EcoConfig, iv: Interventions, h: number) {
  const m = lossRates(config);
  const F = fishingRates(config, iv);
  const U: number[][][] = [], C: number[][][] = [];
  const remove = zeros(), predLoss = zeros(), background = zeros(), catchQ = zeros();
  const gain = zeros(), unretained = zeros(), supply = zeros();
  const next = zeros();

  for (let k = 0; k < NLAYER; k++) {
    const x = X.map(r => r[k]);
    // 1. 需求速率
    const Uk = feedingDemand(x, config);
    const Ck = Array.from({ length: NPOOL }, () => new Array(NPOOL).fill(0));
    // 2. 每个库的总流出速率，按指数形式得到本步移除量，再按比例分摊给各去向
    for (let j = 0; j < NPOOL; j++) {
      let predRate = 0;
      for (let i = 0; i < NPOOL; i++) predRate += Uk[i][j];
      const Xj = x[j];
      const out = predRate + m[j] * Xj + F[j][k] * Xj;
      if (Xj <= 0 || out <= 0) continue;
      const rem = -Xj * Math.expm1(-(out / Xj) * h);
      const scale = rem / out;
      remove[j][k] = rem;
      for (let i = 0; i < NPOOL; i++) Ck[i][j] = Uk[i][j] * scale;
      predLoss[j][k] = predRate * scale;
      background[j][k] = m[j] * Xj * scale;
      catchQ[j][k] = F[j][k] * Xj * scale;
    }
    // 3. 统一更新：鱼类用实际摄食量 C 获得收益，R 获得外部补给
    for (let i = 1; i < NPOOL; i++) {
      let eaten = 0;
      for (let j = 0; j < NPOOL; j++) eaten += Ck[i][j];
      const eta = config.fish[FISH[i - 1]].eta;
      gain[i][k] = eta * eaten;
      unretained[i][k] = (1 - eta) * eaten;
    }
    supply[0][k] = config.R.J[k] * iv.supplyMultiplier * h;
    for (let j = 0; j < NPOOL; j++) next[j][k] = x[j] - remove[j][k] + gain[j][k] + supply[j][k];
    U.push(Uk); C.push(Ck);
  }
  return { next, U, C, remove, predLoss, background, catch: catchQ, gain, unretained, supply };
}

export type FluxResult = ReturnType<typeof fluxStep>;

/** 把通量结果和迁移结果合成一份完整的步账本 */
export function makeLedger(before: PoolLayer, flux: FluxResult, migration: PoolLayer, after: PoolLayer, h: number): StepLedger {
  return {
    dt: h, U: flux.U, C: flux.C,
    remove: flux.remove, predLoss: flux.predLoss, background: flux.background, catch: flux.catch,
    gain: flux.gain, unretained: flux.unretained, supply: flux.supply,
    migration, before: cloneMatrix(before), afterFlux: flux.next, after: cloneMatrix(after),
  };
}
