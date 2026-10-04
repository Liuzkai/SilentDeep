import { FISH, NLAYER, NPOOL, type EcoConfig, type EcoState, type PoolLayer, type ValidationResult } from './types';
import { assertValid, validateConfig } from './config';

export const zeros = (): PoolLayer => Array.from({ length: NPOOL }, () => new Array(NLAYER).fill(0));
export const cloneMatrix = (m: PoolLayer): PoolLayer => m.map(r => r.slice());

/** 初始状态：鱼类 X[s,k] = 初始总量·p[s,k]；R 取配置的分层初值 */
export function createInitialState(config: EcoConfig): EcoState {
  assertValid(validateConfig(config), '配置');
  const X = zeros();
  for (let k = 0; k < NLAYER; k++) X[0][k] = config.R.initial[k];
  FISH.forEach((s, i) => {
    const f = config.fish[s];
    for (let k = 0; k < NLAYER; k++) X[i + 1][k] = f.initialTotal * f.p[k];
  });
  return { t: 0, steps: 0, X, cumCatch: zeros() };
}

export function cloneState(s: EcoState): EcoState {
  return { t: s.t, steps: s.steps, X: cloneMatrix(s.X), cumCatch: cloneMatrix(s.cumCatch) };
}

/** 浮点误差允许的极小负值（有记录的容差），超过即判为错误 */
export const NEG_TOL = 1e-9;

export function validateState(s: EcoState): ValidationResult {
  const problems: string[] = [];
  if (!Number.isFinite(s.t) || s.t < 0) problems.push(`t 非法：${s.t}`);
  if (s.X.length !== NPOOL || s.X.some(r => r.length !== NLAYER)) problems.push('X 形状必须是 5×3');
  s.X.forEach((row, i) => row.forEach((v, k) => {
    if (!Number.isFinite(v)) problems.push(`X[${i}][${k}] 不是有限值：${v}`);
    else if (v < -NEG_TOL) problems.push(`X[${i}][${k}] 为负：${v}`);
  }));
  s.cumCatch.forEach((row, i) => row.forEach((v, k) => {
    if (!Number.isFinite(v) || v < -NEG_TOL) problems.push(`cumCatch[${i}][${k}] 非法：${v}`);
  }));
  return { ok: problems.length === 0, problems };
}

export const total = (X: PoolLayer): number => X.reduce((a, r) => a + r[0] + r[1] + r[2], 0);
export const poolTotal = (X: PoolLayer, i: number): number => X[i][0] + X[i][1] + X[i][2];
