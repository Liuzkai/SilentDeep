import { FISH, NPOOL, type EcoConfig } from './types';

/**
 * 单层摄食需求速率 U[i][j]（BU/模拟日），i、j 均按 POOLS 索引。
 *   Food_i = Σ_j a[i,j]·X_j
 *   U[i,j] = q_i·X_i·a[i,j]·X_j / (H_i + Food_i)
 * 因此 Σ_j U[i,j] = q_i·X_i·Food_i/(H_i+Food_i) ≤ q_i·X_i，多种猎物共享同一个摄食上限。
 * x 是该层 5 个库的快照，函数不修改它。
 */
export function feedingDemand(x: readonly number[], config: EcoConfig): number[][] {
  const U = Array.from({ length: NPOOL }, () => new Array(NPOOL).fill(0));
  for (let i = 1; i < NPOOL; i++) {
    const f = config.fish[FISH[i - 1]];
    const Xi = x[i];
    if (Xi <= 0 || f.q === 0) continue;
    const row = config.a[i];
    let food = 0;
    for (let j = 0; j < NPOOL; j++) food += row[j] * Math.max(0, x[j]);
    if (food <= 0) continue;
    const k = f.q * Xi / (f.H + food);
    for (let j = 0; j < NPOOL; j++) if (row[j] > 0 && x[j] > 0) U[i][j] = k * row[j] * x[j];
  }
  return U;
}
