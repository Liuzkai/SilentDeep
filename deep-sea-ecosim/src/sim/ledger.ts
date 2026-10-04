import { NPOOL, type BudgetCheck, type PoolLayer, type StepLedger } from './types';
import { total } from './initial-state';

const sum = (m: PoolLayer) => m.reduce((a, r) => a + r[0] + r[1] + r[2], 0);

/**
 * 第五节 4：开放系统生物量收支
 *   Total_next − Total_prev = Σ J·h − 背景损失 − 捕获 − 未保留摄食
 * 容差与总库存规模相关：只吸收浮点舍入，不掩盖计算错误。
 */
export function checkBudget(previous: PoolLayer, next: PoolLayer, ledger: StepLedger): BudgetCheck {
  const before = total(previous), after = total(next);
  const delta = after - before;
  const expected = sum(ledger.supply) - sum(ledger.background) - sum(ledger.catch) - sum(ledger.unretained);
  const error = delta - expected;
  const tolerance = 1e-10 * Math.max(1, before, after);
  // 层间交换对每个物种总量的改变
  let migrationError = 0;
  for (let i = 0; i < NPOOL; i++) migrationError = Math.max(migrationError, Math.abs(ledger.migration[i][0] + ledger.migration[i][1] + ledger.migration[i][2]));
  return { ok: Math.abs(error) <= tolerance && migrationError <= tolerance, delta, expected, error, tolerance, migrationError };
}

/** 选中物种的收支明细（全层合计，BU/步） */
export function poolBreakdown(l: StepLedger, i: number) {
  const r = (m: PoolLayer) => m[i][0] + m[i][1] + m[i][2];
  return {
    gain: r(l.gain), supply: r(l.supply), predLoss: r(l.predLoss), background: r(l.background),
    catch: r(l.catch), migration: r(l.migration),
    net: r(l.after) - r(l.before),
    perLayer: [0, 1, 2].map(k => ({
      gain: l.gain[i][k], supply: l.supply[i][k], predLoss: l.predLoss[i][k], background: l.background[i][k],
      catch: l.catch[i][k], migration: l.migration[i][k], net: l.after[i][k] - l.before[i][k],
    })),
  };
}

/** 食物网通量 C/h（BU/模拟日），全层合计，[pred][prey] */
export function webFlux(l: StepLedger): number[][] {
  const W = Array.from({ length: NPOOL }, () => new Array(NPOOL).fill(0));
  for (const Ck of l.C) for (let i = 0; i < NPOOL; i++) for (let j = 0; j < NPOOL; j++) W[i][j] += Ck[i][j] / l.dt;
  return W;
}
