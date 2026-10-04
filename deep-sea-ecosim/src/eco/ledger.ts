// 生物量账本与状态校验
import { NLAYER, type BudgetCheck, type EcoState, type Ledger, type ValidationResult } from './types';
import { type Model, at, sum } from './step';

/**
 * 开放系统收支：
 *   ΔTotal = 补给 − 背景 − 捕获 − 辐射损失 − 台风损失 − 未保留摄食
 * 层间交换和水平输运只搬运生物量，各物种合计必须为 0。
 */
export function checkBudget(m: Model, ledger: Ledger): BudgetCheck {
  const delta = ledger.totalAfter - ledger.totalBefore;
  const expected = sum(ledger.supply) - sum(ledger.background) - sum(ledger.catch) - sum(ledger.radLoss) - sum(ledger.stormLoss) - sum(ledger.unretained);
  const error = delta - expected;
  const tolerance = 1e-10 * Math.max(1, ledger.totalBefore, ledger.totalAfter);
  let vmigError = 0, hmigError = 0;
  for (let i = 0; i < m.P; i++) {
    let v = 0, h = 0;
    for (let c = 0; c < m.N; c++) for (let k = 0; k < NLAYER; k++) { const g = at(m, i, c, k); v += ledger.vmig[g]; h += ledger.hmig[g]; }
    vmigError = Math.max(vmigError, Math.abs(v)); hmigError = Math.max(hmigError, Math.abs(h));
  }
  return { ok: Math.abs(error) <= tolerance && vmigError <= tolerance && hmigError <= tolerance, delta, expected, error, tolerance, vmigError, hmigError };
}

export const NEG_TOL = 1e-9;

export function validateState(m: Model, s: EcoState): ValidationResult {
  const problems: string[] = [];
  if (!Number.isFinite(s.t) || s.t < 0) problems.push(`t 非法：${s.t}`);
  for (let g = 0; g < s.X.length; g++) {
    const v = s.X[g];
    if (!Number.isFinite(v)) { problems.push(`X[${g}] 不是有限值`); break; }
    if (v < -NEG_TOL) { problems.push(`X[${g}] 为负：${v}`); break; }
  }
  // 不存在的层（海底以下）不能有生物量
  for (let i = 0; i < m.P && problems.length < 5; i++) for (let c = 0; c < m.N; c++) for (let k = 0; k < NLAYER; k++)
    if (m.vv.vol[c * 3 + k] <= 0 && s.X[at(m, i, c, k)] !== 0) problems.push(`${m.sp[i].id} 出现在海底以下 cell=${c} L${k + 1}`);
  return { ok: problems.length === 0, problems };
}

/** 物种 i 的全海域总量 */
export function speciesTotal(m: Model, X: Float64Array, i: number): number {
  let s = 0; const base = i * m.N * NLAYER;
  for (let g = base; g < base + m.N * NLAYER; g++) s += X[g];
  return s;
}

/** 物种 i 在格子 c 的水柱合计 */
export function columnTotal(m: Model, X: Float64Array, i: number, c: number): number {
  const g = at(m, i, c, 0);
  return X[g] + X[g + 1] + X[g + 2];
}
