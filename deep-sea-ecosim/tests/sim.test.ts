import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG, NO_INTERVENTION, cloneConfig, createInitialState, feedingDemand, fluxStep, migrate, step,
  checkBudget, validateState, validateConfig, validateInterventions, total, poolTotal, runScenario, runExperiment,
  FISH, NLAYER, NPOOL, POOLS, type EcoConfig, type EcoState, type Interventions,
} from '../src/sim';

const cfg = () => cloneConfig(DEFAULT_CONFIG);
const fishing = (target: 'A' | 'B' | 'C' | 'D', u: number, layer: 0 | 1 | 2 | 'all' = 'all'): Interventions =>
  ({ fishing: { enabled: true, target, layer, u }, supplyMultiplier: 1 });
const relErr = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i])) / Math.hypot(...b);
const flat = (s: EcoState) => s.X.flat();

function runSteps(config: EcoConfig, n: number, iv: Interventions = NO_INTERVENTION, init?: EcoState, opts = {}) {
  let s = init ?? createInitialState(config);
  const ledgers = [];
  for (let i = 0; i < n; i++) { const r = step(s, config, iv, config.dt, opts); ledgers.push({ prev: s, ...r }); s = r.state; }
  return { state: s, ledgers };
}

describe('配置与状态校验', () => {
  it('默认配置合法', () => expect(validateConfig(DEFAULT_CONFIG).ok).toBe(true));
  it('拒绝分布权重和不为 1、负值、NaN', () => {
    const c = cfg(); c.fish.A.p = [0.5, 0.5, 0.5];
    expect(validateConfig(c).ok).toBe(false);
    const c2 = cfg(); c2.fish.C.q = -1; expect(validateConfig(c2).ok).toBe(false);
    const c3 = cfg(); c3.R.J[1] = NaN; expect(validateConfig(c3).ok).toBe(false);
    const c4 = cfg(); c4.a[0][1] = 1; expect(validateConfig(c4).ok).toBe(false);
  });
  it('拒绝越界干预', () => {
    expect(validateInterventions(fishing('D', 1.5)).ok).toBe(false);
    expect(validateInterventions({ ...NO_INTERVENTION, supplyMultiplier: 3 }).ok).toBe(false);
    expect(validateInterventions({ ...NO_INTERVENTION, supplyMultiplier: Infinity }).ok).toBe(false);
  });
  it('初始状态为 15 个量，符合 初始总量·p', () => {
    const s = createInitialState(DEFAULT_CONFIG);
    expect(s.X.length).toBe(5); expect(s.X.every(r => r.length === 3)).toBe(true);
    expect(s.X[1]).toEqual([90 * 0.70, 90 * 0.25, 90 * 0.05].map(v => expect.closeTo(v, 12)));
    expect(s.X[0]).toEqual([100, 100, 100]);
  });
});

describe('1. 非负性与有限值', () => {
  it('正常运行 2000 日', () => {
    const r = runScenario(DEFAULT_CONFIG, [], 2000, { recordEvery: 100 });
    expect(r.anomalies).toEqual([]);
    expect(r.minValue).toBeGreaterThanOrEqual(0);
    expect(validateState(r.final).ok).toBe(true);
  });
  it('极高捕捞压力（Fmax 放大 1000 倍、u=1）下不出现负值或 NaN', () => {
    const c = cfg(); c.Fmax = 20;
    for (const t of FISH) {
      const { state } = runSteps(c, 500, fishing(t, 1));
      expect(validateState(state).ok).toBe(true);
      expect(Math.min(...flat(state))).toBeGreaterThanOrEqual(0);
    }
  });
  it('极大 dt（5 日）也不出现负值', () => {
    const c = cfg(); c.dt = 5; c.Fmax = 5;
    const { state } = runSteps(c, 200, fishing('C', 1));
    expect(Math.min(...flat(state))).toBeGreaterThanOrEqual(0);
  });
});

describe('2. 摄食上限', () => {
  it('Σ_j U[i,j] ≤ q_i·X_i，且实际摄食 ≤ U·dt', () => {
    const c = cfg();
    // 构造猎物极其丰富的层
    const x = [1e6, 50, 50, 10, 3];
    const U = feedingDemand(x, c);
    FISH.forEach((s, idx) => {
      const i = idx + 1;
      const sumU = U[i].reduce((a, b) => a + b, 0);
      expect(sumU).toBeLessThanOrEqual(c.fish[s].q * x[i] * (1 + 1e-12));
    });
    const { ledgers } = runSteps(c, 300);
    for (const l of ledgers) for (let k = 0; k < NLAYER; k++) for (let i = 0; i < NPOOL; i++) for (let j = 0; j < NPOOL; j++)
      expect(l.ledger.C[k][i][j]).toBeLessThanOrEqual(l.ledger.U[k][i][j] * l.ledger.dt * (1 + 1e-12) + 1e-15);
  });
  it('C 同时吃 A 和 B 时共享一个上限，不是每种猎物一份', () => {
    const c = cfg();
    const x = [0, 1e5, 1e5, 10, 0];
    const U = feedingDemand(x, c);
    expect(U[3][1] + U[3][2]).toBeLessThanOrEqual(c.fish.C.q * 10);
    expect(U[3][1] + U[3][2]).toBeGreaterThan(0.99 * c.fish.C.q * 10);
  });
  it('食物为零时摄食为零', () => {
    const U = feedingDemand([0, 10, 10, 10, 10], cfg());
    expect(U[1][0]).toBe(0); expect(U[2][0]).toBe(0);
    expect(feedingDemand([10, 0, 0, 10, 0], cfg())[3].every(v => v === 0)).toBe(true);
  });
});

describe('3. 猎物库存约束', () => {
  it('多个捕食者 + 捕捞共同作用时，每个库的总移除 ≤ 步初库存，且分项之和 = 移除量', () => {
    const c = cfg(); c.Fmax = 50; c.dt = 2;
    c.fish.C.q = 50; // 让 A、B 面临远超库存的需求
    const s0 = createInitialState(c);
    const f = fluxStep(s0.X, c, fishing('A', 1), c.dt);
    for (let j = 0; j < NPOOL; j++) for (let k = 0; k < NLAYER; k++) {
      expect(f.remove[j][k]).toBeLessThanOrEqual(s0.X[j][k] * (1 + 1e-12));
      let eaten = 0; for (let i = 0; i < NPOOL; i++) eaten += f.C[k][i][j];
      expect(eaten + f.background[j][k] + f.catch[j][k]).toBeCloseTo(f.remove[j][k], 10);
    }
  });
});

describe('4. 生物量账本', () => {
  it('逐步满足 ΔTotal = ΣJh − 背景 − 捕获 − 未保留（含捕捞与补给变化）', () => {
    const c = cfg();
    const schedule = [fishing('D', 0.7), fishing('A', 1, 0), { ...NO_INTERVENTION, supplyMultiplier: 1.7 }];
    let s = createInitialState(c);
    for (let n = 0; n < 3000; n++) {
      const r = step(s, c, schedule[Math.floor(n / 1000)], c.dt, { check: false });
      const b = checkBudget(s.X, r.state.X, r.ledger);
      expect(Math.abs(b.error)).toBeLessThanOrEqual(b.tolerance);
      expect(b.migrationError).toBeLessThanOrEqual(b.tolerance);
      s = r.state;
    }
  });
});

describe('5. 无外部输入', () => {
  it('J=0 时系统总量不增加', () => {
    const c = cfg(); c.R.J = [0, 0, 0];
    let s = createInitialState(c);
    for (let n = 0; n < 2000; n++) { const r = step(s, c, NO_INTERVENTION); expect(total(r.state.X)).toBeLessThanOrEqual(total(s.X) * (1 + 1e-14)); s = r.state; }
  });
  it('补给倍率为 0 等价于 J=0', () => {
    const c = cfg(); c.R.J = [0, 0, 0];
    const a = runSteps(c, 500).state;
    const b = runSteps(cfg(), 500, { ...NO_INTERVENTION, supplyMultiplier: 0 }).state;
    expect(relErr(flat(a), flat(b))).toBeLessThan(1e-14);
  });
  it('捕食者没有可食用对象时摄食收益为零', () => {
    const c = cfg();
    const s = createInitialState(c);
    s.X[3] = [0, 0, 0]; // 移除 C，D 无食物
    const f = fluxStep(s.X, c, NO_INTERVENTION, c.dt);
    expect(f.gain[4]).toEqual([0, 0, 0]);
    expect(f.C.every(Ck => Ck[4].every(v => v === 0))).toBe(true);
    // 没有收益时只会减少
    f.next[4].forEach((v, k) => expect(v).toBeLessThan(s.X[4][k]));
  });
});

describe('6. 零库存', () => {
  it('全层为零的物种不会复活', () => {
    const c = cfg(); const s = createInitialState(c); s.X[4] = [0, 0, 0];
    const { state } = runSteps(c, 2000, NO_INTERVENTION, s);
    expect(state.X[4]).toEqual([0, 0, 0]);
  });
  it('单层为零但其他层有量时，可以通过层间交换增加，且记在 migration 里', () => {
    const c = cfg(); const s = createInitialState(c); s.X[2] = [0, 0, 60];
    const r = step(s, c, NO_INTERVENTION);
    expect(r.state.X[2][0]).toBeGreaterThan(0);
    expect(r.ledger.gain[2][0]).toBe(0);
    expect(r.ledger.migration[2][0]).toBeCloseTo(r.state.X[2][0], 14);
  });
});

describe('7. 交换与遍历顺序', () => {
  it('只开启层间交换时各物种总量不变', () => {
    const c = cfg();
    let X = createInitialState(c).X;
    X[1] = [0, 0, 90]; X[4] = [5, 0, 0];
    const totals = POOLS.map((_, i) => poolTotal(X, i));
    for (let n = 0; n < 5000; n++) X = migrate(X, c, c.dt).X;
    POOLS.forEach((_, i) => expect(poolTotal(X, i)).toBeCloseTo(totals[i], 10));
    // 趋近目标分布
    c.fish.A.p.forEach((p, k) => expect(X[1][k] / totals[1]).toBeCloseTo(p, 2));
  });
  it('交换 A、B 的参数与矩阵索引后，结果按对应关系一致', () => {
    const c = cfg();
    c.fish.A = { ...c.fish.A, q: 0.05, H: 80, p: [0.6, 0.3, 0.1] }; // 让 A、B 不对称
    c.a[3] = [0, 1, 0.5, 0, 0];
    const sw = cloneConfig(c);
    [sw.fish.A, sw.fish.B] = [c.fish.B, c.fish.A];
    const perm = [0, 2, 1, 3, 4];
    sw.a = perm.map(i => perm.map(j => c.a[i][j]));
    const s1 = createInitialState(c), s2 = createInitialState(sw);
    const r1 = runSteps(c, 1000, fishing('A', 0.6), s1).state;
    const r2 = runSteps(sw, 1000, fishing('B', 0.6), s2).state;
    perm.forEach((pi, i) => r1.X[pi].forEach((v, k) => expect(r2.X[i][k]).toBeCloseTo(v, 10)));
  });
});

describe('8. 捕捞记账', () => {
  it('F=0 时捕获量为零', () => {
    const { ledgers, state } = runSteps(cfg(), 500, fishing('D', 0));
    expect(ledgers.every(l => l.ledger.catch.flat().every(v => v === 0))).toBe(true);
    expect(state.cumCatch.flat().every(v => v === 0)).toBe(true);
  });
  it('只保留固定 F 时 B(t) = B(0)·exp(−F·t)，且捕获量 = B(0) − B(t)', () => {
    const c = cfg();
    for (const s of FISH) { c.fish[s].q = 0; c.fish[s].m = 0; c.fish[s].mu = 0; }
    c.R.J = [0, 0, 0]; c.R.m = 0;
    const s0 = createInitialState(c);
    const u = 0.8, F = u * c.Fmax;
    const days = 300, n = Math.round(days / c.dt);
    const { state } = runSteps(c, n, fishing('C', u), s0);
    for (let k = 0; k < NLAYER; k++) {
      const expected = s0.X[3][k] * Math.exp(-F * days);
      expect(state.X[3][k]).toBeCloseTo(expected, 10);
      expect(state.cumCatch[3][k]).toBeCloseTo(s0.X[3][k] - state.X[3][k], 10);
    }
    // 其他库不受影响
    expect(state.X[4]).toEqual(s0.X[4]);
  });
  it('只捕捞指定层', () => {
    const r = step(createInitialState(DEFAULT_CONFIG), DEFAULT_CONFIG, fishing('B', 1, 2));
    expect(r.ledger.catch[2][0]).toBe(0); expect(r.ledger.catch[2][1]).toBe(0); expect(r.ledger.catch[2][2]).toBeGreaterThan(0);
  });
  it('停止捕捞只把 F 归零，不恢复库存', () => {
    const c = cfg();
    const a = runSteps(c, 1000, fishing('D', 1)).state;
    const r = step(a, c, NO_INTERVENTION);
    expect(r.ledger.catch.flat().every(v => v === 0)).toBe(true);
    expect(poolTotal(r.state.X, 4)).toBeLessThan(poolTotal(createInitialState(c).X, 4));
  });
});

describe('9. 时间步敏感性', () => {
  it('默认状态无捕捞 200 日：dt=0.2 与 dt=0.1 的相对向量误差 < 1%', () => {
    const c1 = cfg(), c2 = cfg(); c2.dt = 0.1;
    const a = runScenario(c1, [], 200, { recordEvery: 200 }).final;
    const b = runScenario(c2, [], 200, { recordEvery: 200 }).final;
    const e = relErr(flat(a), flat(b));
    console.log(`[dt 敏感性] 200 日 dt=0.2 vs 0.1 相对向量误差 = ${(e * 100).toFixed(4)}%`);
    expect(e).toBeLessThan(0.01);
  });
});

describe('10. 长时间运行与表现层独立', () => {
  it('5000 日无捕捞：无异常，账本误差在容差内，报告各物种状态', () => {
    const r = runScenario(DEFAULT_CONFIG, [], 5000, { recordEvery: 500 });
    expect(r.anomalies).toEqual([]);
    const f = r.samples[r.samples.length - 1];
    console.log('[5000 日]', POOLS.map((p, i) => `${p}=${f.totals[i].toFixed(3)}`).join(' '), `maxBudgetError=${r.maxBudgetError.toExponential(2)}`);
    expect(r.maxBudgetError).toBeLessThan(1e-9);
  });
  it('相同条件下，不同的"每帧步数"切分得到完全相同的结果', () => {
    // 模拟界面：不同帧率下每帧推进的步数不同，但总步数和 dt 相同
    const c = cfg();
    const run = (chunks: number[]) => {
      let s = createInitialState(c);
      for (const n of chunks) for (let i = 0; i < n; i++) s = step(s, c, fishing('D', 0.4)).state;
      return s;
    };
    const a = run(new Array(1000).fill(1));
    const b = run([7, 13, 300, 180, 500]);
    expect(flat(b)).toEqual(flat(a));
  });
  it('对照实验：两组共用预热快照；无干预实验两组完全一致', () => {
    const e = runExperiment(DEFAULT_CONFIG, 'A', 300, { warmup: 200 });
    expect(e.snapshot.t).toBeCloseTo(200, 9);
    expect(e.control.samples[0].X).toEqual(e.treatment.samples[0].X);
    expect(flat(e.control.final)).toEqual(flat(e.treatment.final));
  });
});
