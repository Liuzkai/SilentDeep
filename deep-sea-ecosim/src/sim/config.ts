// 所有生态参数集中在这里。数值是归一化演示参数，不是真实鱼类测量数据。
import { FISH, NPOOL, POOLS, type EcoConfig, type FishId, type Interventions, type ValidationResult } from './types';

export const DEFAULT_CONFIG: EcoConfig = Object.freeze({
  //      R  A  B  C  D
  a: [
    [0, 0, 0, 0, 0], // R 不摄食
    [1, 0, 0, 0, 0], // A
    [1, 0, 0, 0, 0], // B
    [0, 1, 1, 0, 0], // C
    [0, 0, 0, 1, 0], // D
  ],
  fish: {
    A: { initialTotal: 90, q: 0.040, H: 100, eta: 0.30, m: 0.0030, mu: 0.010, p: [0.70, 0.25, 0.05] },
    B: { initialTotal: 90, q: 0.040, H: 100, eta: 0.30, m: 0.0030, mu: 0.010, p: [0.05, 0.25, 0.70] },
    C: { initialTotal: 20, q: 0.025, H: 40, eta: 0.25, m: 0.0015, mu: 0.005, p: [0.25, 0.50, 0.25] },
    D: { initialTotal: 5, q: 0.015, H: 15, eta: 0.20, m: 0.0008, mu: 0.005, p: [0.10, 0.30, 0.60] },
  },
  R: { initial: [100, 100, 100], J: [1.0, 0.8, 0.6], m: 0.004 },
  dt: 0.2,
  Fmax: 0.02,
}) as EcoConfig;

export const NO_INTERVENTION: Interventions = Object.freeze({
  fishing: Object.freeze({ enabled: false, target: 'D' as FishId, layer: 'all' as const, u: 0 }),
  supplyMultiplier: 1,
}) as Interventions;

/** 深拷贝配置，避免修改默认值 */
export function cloneConfig(c: EcoConfig): EcoConfig {
  return JSON.parse(JSON.stringify(c)) as EcoConfig;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 配置校验：有限值、非负、范围、分布权重和为 1、R 不摄食 */
export function validateConfig(c: EcoConfig): ValidationResult {
  const problems: string[] = [];
  const need = (cond: boolean, msg: string) => { if (!cond) problems.push(msg); };

  need(Array.isArray(c.a) && c.a.length === NPOOL && c.a.every(r => Array.isArray(r) && r.length === NPOOL), 'a 必须是 5×5 矩阵');
  if (problems.length === 0) {
    c.a.forEach((row, i) => row.forEach((v, j) => need(finite(v) && v >= 0, `a[${POOLS[i]}][${POOLS[j]}] 必须是非负有限值`)));
    need(c.a[0].every(v => v === 0), 'R 行必须全为 0（基础饵料不摄食）');
  }
  for (const s of FISH) {
    const f = c.fish?.[s];
    if (!f) { problems.push(`缺少物种 ${s} 的参数`); continue; }
    need(finite(f.initialTotal) && f.initialTotal >= 0, `${s}.initialTotal 必须 ≥ 0`);
    need(finite(f.q) && f.q >= 0, `${s}.q 必须 ≥ 0`);
    need(finite(f.H) && f.H > 0, `${s}.H 必须 > 0`);
    need(finite(f.eta) && f.eta >= 0 && f.eta <= 1, `${s}.eta 必须在 [0,1]`);
    need(finite(f.m) && f.m >= 0, `${s}.m 必须 ≥ 0`);
    need(finite(f.mu) && f.mu >= 0, `${s}.mu 必须 ≥ 0`);
    need(Array.isArray(f.p) && f.p.length === 3 && f.p.every(v => finite(v) && v >= 0), `${s}.p 必须是 3 个非负有限值`);
    if (Array.isArray(f.p) && f.p.length === 3) {
      const sum = f.p[0] + f.p[1] + f.p[2];
      need(Math.abs(sum - 1) < 1e-9, `${s}.p 之和必须为 1（当前 ${sum}）`);
    }
  }
  need(Array.isArray(c.R?.initial) && c.R.initial.length === 3 && c.R.initial.every(v => finite(v) && v >= 0), 'R.initial 必须是 3 个非负有限值');
  need(Array.isArray(c.R?.J) && c.R.J.length === 3 && c.R.J.every(v => finite(v) && v >= 0), 'R.J 必须是 3 个非负有限值');
  need(finite(c.R?.m) && c.R.m >= 0, 'R.m 必须 ≥ 0');
  need(finite(c.dt) && c.dt > 0 && c.dt <= 5, 'dt 必须在 (0, 5]');
  need(finite(c.Fmax) && c.Fmax >= 0, 'Fmax 必须 ≥ 0');
  return { ok: problems.length === 0, problems };
}

/** 干预校验：界面输入先过这里 */
export function validateInterventions(iv: Interventions): ValidationResult {
  const problems: string[] = [];
  const f = iv.fishing;
  if (!FISH.includes(f.target)) problems.push(`捕捞目标必须是 A/B/C/D`);
  if (!(f.layer === 'all' || f.layer === 0 || f.layer === 1 || f.layer === 2)) problems.push('捕捞层必须是 0/1/2/all');
  if (!finite(f.u) || f.u < 0 || f.u > 1) problems.push('捕捞强度 u 必须在 [0,1]');
  if (!finite(iv.supplyMultiplier) || iv.supplyMultiplier < 0 || iv.supplyMultiplier > 2) problems.push('补给倍率必须在 [0,2]');
  return { ok: problems.length === 0, problems };
}

export function assertValid(r: ValidationResult, what: string): void {
  if (!r.ok) throw new Error(`${what} 无效：\n- ${r.problems.join('\n- ')}`);
}
