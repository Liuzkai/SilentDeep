import { FISH, NLAYER, type EcoConfig, type Interventions, type PoolLayer } from './types';
import { zeros } from './initial-state';

/** 当前干预下每个库、每层的捕捞损失率 F（1/模拟日）。R 永远为 0 */
export function fishingRates(config: EcoConfig, iv: Interventions): PoolLayer {
  const F = zeros();
  const f = iv.fishing;
  if (!f.enabled || f.u <= 0) return F;
  const i = FISH.indexOf(f.target) + 1;
  for (let k = 0; k < NLAYER; k++) if (f.layer === 'all' || f.layer === k) F[i][k] = f.u * config.Fmax;
  return F;
}
