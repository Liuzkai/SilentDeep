import { FISH, NLAYER, type EcoConfig, type PoolLayer } from './types';
import { zeros, cloneMatrix } from './initial-state';

/**
 * 第六节：层间分布向目标分布 p 缓慢趋近。
 *   T_s = Σ_k X[s,k]；θ_s = 1 − exp(−μ_s·h)
 *   X'[s,k] = (1−θ_s)·X[s,k] + θ_s·p[s,k]·T_s
 * 三层从同一快照同时计算，只重新分配、不创造也不销毁生物量。R 不参与。
 * 这不是游泳路径或觅食行为模型。
 */
export function migrate(X: PoolLayer, config: EcoConfig, h: number): { X: PoolLayer; delta: PoolLayer } {
  const out = cloneMatrix(X);
  const delta = zeros();
  FISH.forEach((s, idx) => {
    const i = idx + 1, f = config.fish[s];
    const T = X[i][0] + X[i][1] + X[i][2];
    const theta = -Math.expm1(-f.mu * h);
    for (let k = 0; k < NLAYER; k++) {
      out[i][k] = (1 - theta) * X[i][k] + theta * f.p[k] * T;
      delta[i][k] = out[i][k] - X[i][k];
    }
  });
  return { X: out, delta };
}
