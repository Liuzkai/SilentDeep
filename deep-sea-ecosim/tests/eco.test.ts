import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG, ALL_OFF, ALL_ON, NO_INTERVENTION, cloneConfig, createWorld, singleCellWorld, createModel, createInitialState, step,
  checkBudget, validateState, speciesTotal, columnTotal, at, runSchedule, runExperiment, encounters, environment, layerVolumes,
  validateConfig, validateInterventions,
  type EcoConfig, type EcoState, type Interventions, type Storm, type World,
} from '../src/eco';
import * as v01 from '../src/sim';

const cfg = (couple = ALL_ON) => { const c = cloneConfig(DEFAULT_CONFIG); c.couple = { ...couple }; return c; };
/** 只保留 R/A/B/C/D、参数与 v0.1 相同的配置 */
const v01Config = (couple = ALL_OFF): EcoConfig => { const c = cfg(couple); c.species = c.species.slice(0, 5); return c; };
const fishing = (target: string, u: number, layer: 0 | 1 | 2 | 'all' = 'all'): Interventions => ({ ...NO_INTERVENTION, fishing: { enabled: true, target, layer, u, region: null } });
const run = (w: World, c: EcoConfig, n: number, iv: Interventions = NO_INTERVENTION, init?: EcoState) => {
  const m = createModel(w, c);
  let s = init ?? createInitialState(m, iv);
  const errs: number[] = [];
  for (let i = 0; i < n; i++) { const r = step(m, s, iv); const b = checkBudget(m, r.ledger); errs.push(b.ok ? 0 : 1); s = r.state; }
  return { m, s, fails: errs.reduce((a, b) => a + b, 0) };
};

describe('回归：关闭全部环境耦合的单格海域与 v0.1 逐位一致', () => {
  const cases: [string, v01.Interventions, Interventions, number][] = [
    ['无捕捞 2000 日', v01.NO_INTERVENTION, NO_INTERVENTION, 10000],
    ['捕捞 D u=0.6', { fishing: { enabled: true, target: 'D', layer: 'all', u: 0.6 }, supplyMultiplier: 1 }, fishing('D', 0.6), 5000],
    ['只捕 L1 的 A、补给 1.5×', { fishing: { enabled: true, target: 'A', layer: 0, u: 1 }, supplyMultiplier: 1.5 }, { ...fishing('A', 1, 0), supplyMultiplier: 1.5 }, 4000],
  ];
  for (const [name, iv1, iv2, n] of cases) it(name, () => {
    let a = v01.createInitialState(v01.DEFAULT_CONFIG);
    for (let i = 0; i < n; i++) a = v01.step(a, v01.DEFAULT_CONFIG, iv1).state;
    const { m, s } = run(singleCellWorld(), v01Config(), n, iv2);
    for (let i = 0; i < 5; i++) for (let k = 0; k < 3; k++) {
      expect(s.X[at(m, i, 0, k)]).toBe(a.X[i][k]);
      expect(s.cumCatch[at(m, i, 0, k)]).toBe(a.cumCatch[i][k]);
    }
  });
  it('单格海域打开所有耦合但环境取参考值（温度=Tref、无辐射源、无台风、平坦海底、热生态位关掉）时仍一致', () => {
    const w = singleCellWorld();
    const c = v01Config({ ...ALL_ON });
    c.radBackground = 0;
    for (const s of c.species) s.thermal = null;
    let a = v01.createInitialState(v01.DEFAULT_CONFIG);
    for (let i = 0; i < 3000; i++) a = v01.step(a, v01.DEFAULT_CONFIG, v01.NO_INTERVENTION).state;
    const { m, s } = run(w, c, 3000);
    for (let i = 0; i < 5; i++) for (let k = 0; k < 3; k++) expect(s.X[at(m, i, 0, k)]).toBe(a.X[i][k]);
  });
});

describe('配置与海域', () => {
  it('默认配置合法；世界观物种都在', () => {
    expect(validateConfig(DEFAULT_CONFIG).ok).toBe(true);
    expect(DEFAULT_CONFIG.species.map(s => s.id)).toEqual(['R', 'A', 'B', 'C', 'D', 'J', 'K', 'E', 'W']);
  });
  it('拒绝不存在的食物、越界干预', () => {
    const c = cfg(); c.species[3].diet = { Z: 1 };
    expect(validateConfig(c).ok).toBe(false);
    expect(validateInterventions({ ...NO_INTERVENTION, tempAnomaly: 9 }, DEFAULT_CONFIG).ok).toBe(false);
    expect(validateInterventions(fishing('R', 0.5), DEFAULT_CONFIG).ok).toBe(false);
  });
  it('同一种子生成同一片海；不同种子不同', () => {
    const a = createWorld({ seed: 5 }), b = createWorld({ seed: 5 }), c = createWorld({ seed: 6 });
    expect(Array.from(a.floor)).toEqual(Array.from(b.floor));
    expect(a.storms).toEqual(b.storms);
    expect(Array.from(a.floor)).not.toEqual(Array.from(c.floor));
  });
  it('洋流场在网格上严格无辐散：每个格子流入 = 流出', () => {
    const w = createWorld(), m = createModel(w, cfg());
    for (let c = 0; c < m.N; c++) {
      let out = 0, inn = 0;
      for (let d = 0; d < 4; d++) {
        out += m.flow[c * 4 + d];
        const n = m.nbr[c * 4 + d]; if (n < 0) continue;
        for (let e = 0; e < 4; e++) if (m.nbr[n * 4 + e] === c) inn += m.flow[n * 4 + e];
      }
      expect(Math.abs(out - inn)).toBeLessThan(1e-12);
    }
  });
});

describe('非负、有限、账本（完整海域，所有耦合开启）', () => {
  it('默认海域 1000 日：每步账本平衡、无负值、海底以下没有生物量', () => {
    const w = createWorld(), c = cfg();
    const r = runSchedule(createModel(w, c), [], 1000, { recordEvery: 100 });
    expect(r.anomalies).toEqual([]);
    expect(r.minValue).toBeGreaterThanOrEqual(0);
    expect(validateState(r.model, r.final).ok).toBe(true);
  });
  it('极端扰动：超强台风 + 强辐射 + 极高捕捞 + 升温 4 °C，仍无负值、账本平衡', () => {
    const w = createWorld(), c = cfg(); c.Fmax = 5;
    for (const s of c.species) { s.radSens *= 200; s.stormSens *= 200; }
    const m = createModel(w, c);
    const storm: Storm = { id: 'x', name: 'x', t0: 5, duration: 20, x0: 20, y0: 8, vx: -1, vy: 0, radius: 8, intensity: 3 };
    let s = createInitialState(m, NO_INTERVENTION);
    s.extraStorms = [storm];
    s.extraSources = [{ id: 'z', name: 'z', x: 12, y: 8, depth: 1000, S0: 30, t0: 0, halfLife: Infinity }];
    const iv = { ...fishing('C', 1), tempAnomaly: 4 };
    for (let n = 0; n < 500; n++) {
      const r = step(m, s, iv);
      expect(checkBudget(m, r.ledger).ok).toBe(true);
      s = r.state;
    }
    expect(validateState(m, s).ok).toBe(true);
  });
  it('层间交换和水平输运只搬运生物量：关闭摄食与损失后各物种总量不变', () => {
    const w = createWorld(), c = cfg();
    for (const s of c.species) { s.q = 0; s.m = 0; s.radSens = 0; s.stormSens = 0; }
    c.resource.J = [0, 0, 0];
    const m = createModel(w, c);
    let s = createInitialState(m, NO_INTERVENTION);
    const t0 = c.species.map((_, i) => speciesTotal(m, s.X, i));
    for (let n = 0; n < 2000; n++) s = step(m, s, NO_INTERVENTION).state;
    c.species.forEach((_, i) => expect(speciesTotal(m, s.X, i)).toBeCloseTo(t0[i], 8));
  });
  it('无外部输入（J=0、无台风脉冲）时总量不增加', () => {
    const w = createWorld(), c = cfg(); c.resource.J = [0, 0, 0];
    const m = createModel(w, c);
    let s = createInitialState(m, NO_INTERVENTION), prev = Infinity;
    for (let n = 0; n < 1500; n++) { const r = step(m, s, NO_INTERVENTION); expect(r.ledger.totalAfter).toBeLessThanOrEqual(Math.min(prev, r.ledger.totalBefore) * (1 + 1e-13)); prev = r.ledger.totalAfter; s = r.state; }
  });
  it('全海域为零的物种不会复活', () => {
    const w = createWorld(), c = cfg(), m = createModel(w, c);
    const s = createInitialState(m, NO_INTERVENTION);
    const iW = m.idx.W;
    for (let g = iW * m.N * 3; g < (iW + 1) * m.N * 3; g++) s.X[g] = 0;
    const { s: e } = run(w, c, 1000, NO_INTERVENTION, s);
    expect(speciesTotal(m, e.X, iW)).toBe(0);
  });
});

describe('海底深度', () => {
  it('海底浅于 600 m 的格子没有生物量；只到 L1 的格子 L2、L3 为零', () => {
    const w = createWorld(), m = createModel(w, cfg());
    const r = runSchedule(m, [], 300, { recordEvery: 300 });
    const vv = layerVolumes(w, m.config);
    let shallow = 0, partial = 0;
    for (let c = 0; c < m.N; c++) {
      if (vv.floorLayer[c] === -1) { shallow++; for (let i = 0; i < m.P; i++) expect(columnTotal(m, r.final.X, i, c)).toBe(0); }
      if (vv.floorLayer[c] === 0) { partial++; for (let i = 0; i < m.P; i++) { expect(r.final.X[at(m, i, c, 1)]).toBe(0); expect(r.final.X[at(m, i, c, 2)]).toBe(0); } }
    }
    expect(shallow).toBeGreaterThan(0);
    expect(partial).toBeGreaterThan(0);
  });
  it('底栖的铁颚蟹只出现在海底所在的层', () => {
    const w = createWorld(), m = createModel(w, cfg());
    const r = runSchedule(m, [], 500, { recordEvery: 500 });
    const iK = m.idx.K, vv = m.vv;
    for (let c = 0; c < m.N; c++) {
      const fl = Math.min(2, vv.floorLayer[c]);
      if (fl < 0) continue;
      const col = columnTotal(m, r.final.X, iK, c);
      if (col > 1e-6) expect(r.final.X[at(m, iK, c, fl)] / col).toBeGreaterThan(0.95);
    }
  });
});

describe('环境响应（机制方向，单格隔离测试）', () => {
  const oneCell = (floor = 1500, T = 3.5): World => ({ ...singleCellWorld(), floor: new Float64Array([floor]), Tbase: new Float64Array([T, T, T]) });
  it('辐射：只开辐射耦合时，辐射源越强，敏感物种的辐射损失越大，且只记在 radLoss', () => {
    const c = v01Config({ ...ALL_OFF, radiation: true });
    const w = oneCell();
    const loss = (S: number) => {
      const m = createModel({ ...w, radSources: [{ id: 's', name: 's', x: 0, y: 0, depth: 1050, S0: S, t0: -1, halfLife: Infinity }] }, c);
      const s0 = createInitialState(m, NO_INTERVENTION);
      const r = step(m, s0, NO_INTERVENTION);
      return speciesTotal(m, r.ledger.radLoss, m.idx.A);
    };
    expect(loss(0)).toBeGreaterThan(0);          // 背景辐射
    expect(loss(2)).toBeGreaterThan(loss(0.5));
  });
  it('温度：偏离最适温度时摄食下降；Q10 使背景损失随温度上升', () => {
    const c = v01Config({ ...ALL_OFF, temperature: true });
    const ledgerAt = (T: number) => { const m = createModel(oneCell(1500, T), c); return step(m, createInitialState(m, NO_INTERVENTION), NO_INTERVENTION).ledger; };
    const cold = ledgerAt(1), opt = ledgerAt(5), hot = ledgerAt(12);
    const m = createModel(oneCell(), c);
    const gainA = (l: typeof cold) => speciesTotal(m, l.gain, m.idx.A);
    expect(gainA(opt)).toBeGreaterThan(gainA(hot));
    expect(gainA(opt)).toBeGreaterThan(gainA(cold));
    expect(speciesTotal(m, hot.background, m.idx.A)).toBeGreaterThan(speciesTotal(m, cold.background, m.idx.A));
  });
  it('台风：扰动期间出现 stormLoss；之后通过延迟链给 R 带来补给脉冲（先 L1 后 L3）', () => {
    const c = v01Config({ ...ALL_OFF, storms: true });
    const w: World = { ...oneCell(), storms: [{ id: 's', name: 's', t0: 1, duration: 4, x0: 0, y0: 0, vx: 0, vy: 0, radius: 3, intensity: 1.5 }] };
    const m = createModel(w, c);
    let s = createInitialState(m, NO_INTERVENTION);
    let stormLoss = 0; const peak = [0, 0, 0], peakT = [0, 0, 0];
    for (let n = 0; n < 1000; n++) {
      const r = step(m, s, NO_INTERVENTION);
      stormLoss += speciesTotal(m, r.ledger.stormLoss, m.idx.A);
      for (let k = 0; k < 3; k++) { const b = r.env.boost[k]; if (b > peak[k]) { peak[k] = b; peakT[k] = r.state.t; } }
      s = r.state;
    }
    expect(stormLoss).toBeGreaterThan(0);
    expect(peak.every(p => p > 1)).toBe(true);
    expect(peakT[0]).toBeLessThan(peakT[1]);
    expect(peakT[1]).toBeLessThan(peakT[2]);
    // 脉冲结束后回到 1
    expect(s.rain.every(v => v < 1e-3)).toBe(true);
  });
  it('层体积：海底在 L2 中间时 L2 只有一半体积，L3 不存在', () => {
    const w = oneCell(1050);
    const vv = layerVolumes(w, cfg());
    expect(Array.from(vv.vol)).toEqual([1, 0.5, 0]);
  });
});

describe('遭遇概率（游戏层）', () => {
  it('概率在 [0,1]；只读，不改变生态状态', () => {
    const w = createWorld(), m = createModel(w, cfg());
    const s = createInitialState(m, NO_INTERVENTION);
    const before = s.X.slice();
    const env = environment(w, m.config, s, NO_INTERVENTION, m.vv);
    const e = encounters(m, s, env, { x: 12, y: 8, depth: 1000, noise: 110, hours: 6 });
    expect(e.every(r => r.p >= 0 && r.p <= 1 && Number.isFinite(r.rate))).toBe(true);
    expect(Array.from(s.X)).toEqual(Array.from(before));
    expect(e.map(r => r.id)).toContain('ECHO');
    expect(e.map(r => r.id)).toContain('LEVIATHAN');
  });
  it('生物量为零时遭遇概率为零；噪声越大，会被噪声吸引的物种概率越高', () => {
    const w = createWorld(), m = createModel(w, cfg());
    const s = createInitialState(m, NO_INTERVENTION);
    const env = environment(w, m.config, s, NO_INTERVENTION, m.vv);
    const q = { x: 12, y: 8, depth: 1300, hours: 6 };
    const quiet = encounters(m, s, env, { ...q, noise: 95 }), loud = encounters(m, s, env, { ...q, noise: 125 });
    const pick = (a: typeof quiet, id: string) => a.find(r => r.id === id)!.p;
    expect(pick(loud, 'E')).toBeGreaterThan(pick(quiet, 'E'));
    expect(pick(loud, 'A')).toBe(pick(quiet, 'A'));   // 灯笼鱼群不被噪声吸引
    const iD = m.idx.D; for (let g = iD * m.N * 3; g < (iD + 1) * m.N * 3; g++) s.X[g] = 0;
    expect(pick(encounters(m, s, env, { ...q, noise: 125 }), 'D')).toBe(0);
  });
  it('海底浅于模型域的格子遭遇概率为零', () => {
    const w = createWorld(), m = createModel(w, cfg());
    const s = createInitialState(m, NO_INTERVENTION), env = environment(w, m.config, s, NO_INTERVENTION, m.vv);
    const c = Array.from(m.vv.floorLayer).findIndex(f => f === -1);
    const e = encounters(m, s, env, { x: c % w.nx, y: (c / w.nx) | 0, depth: 700, noise: 110, hours: 6 });
    expect(e.filter(r => !r.derived).every(r => r.p === 0)).toBe(true);
  });
});

describe('时间步与确定性', () => {
  it('完整海域 200 日：dt=0.2 vs 0.1 相对向量误差 < 1%', () => {
    const w = createWorld();
    const fin = (dt: number) => { const c = cfg(); c.dt = dt; return runSchedule(createModel(w, c), [], 200, { recordEvery: 200, check: false }).final.X; };
    const a = fin(0.2), b = fin(0.1);
    let num = 0, den = 0; for (let g = 0; g < a.length; g++) { num += (a[g] - b[g]) ** 2; den += b[g] ** 2; }
    const e = Math.sqrt(num / den);
    console.log(`[v0.2 dt 敏感性] 200 日 dt=0.2 vs 0.1 相对向量误差 = ${(e * 100).toFixed(4)}%`);
    expect(e).toBeLessThan(0.01);
  });
  it('对照实验：两组共用预热快照；基线两组逐位一致；台风实验只改变实验组', () => {
    const w = createWorld();
    const a = runExperiment(w, cfg(), 'A', 200, { warmup: 100 });
    expect(Array.from(a.control.final.X)).toEqual(Array.from(a.treatment.final.X));
    const h = runExperiment(w, cfg(), 'H', 200, { warmup: 100 });
    expect(Array.from(h.control.final.X)).toEqual(Array.from(a.control.final.X));
    expect(Array.from(h.treatment.final.X)).not.toEqual(Array.from(h.control.final.X));
    expect(h.treatment.anomalies).toEqual([]);
  });
});

describe('模块边界', () => {
  it('src/eco 不引用 DOM、Canvas、view、ui、Math.random', () => {
    const dir = join(__dirname, '../src/eco');
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/from ['"](three|\.\.\/view|\.\.\/ui)/);
      expect(src, f).not.toMatch(/\b(window|document|requestAnimationFrame|performance|HTMLCanvasElement)\b/);
      expect(src, f).not.toMatch(/Math\.random/);
    }
  });
});
