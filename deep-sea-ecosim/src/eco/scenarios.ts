// 日程运行与对照实验。确定性：同样的世界种子、参数和日程得到同样的结果。
import { NLAYER, type EcoConfig, type EcoState, type Interventions, type Schedule, type World } from './types';
import { NO_INTERVENTION, assertValid, validateInterventions } from './config';
import { cloneState, createInitialState, createModel, step, type Model } from './step';
import { checkBudget, speciesTotal } from './ledger';

export interface Sample { t: number; totals: number[]; catchRate: number[]; cumCatch: number[] }

export interface RunResult {
  model: Model;
  samples: Sample[];
  final: EcoState;
  startT: number;
  maxBudgetError: number;
  minValue: number;
  anomalies: string[];
  log: { t: number; label: string }[];
}

/** 把日程里到点的事件应用到状态和当前干预上（返回新的当前干预） */
export function applyDue(st: EcoState, schedule: Schedule, cursor: { i: number }, origin: number, cur: Interventions, log?: { t: number; label: string }[]): Interventions {
  while (cursor.i < schedule.length && schedule[cursor.i].t <= st.t - origin + 1e-9) {
    const e = schedule[cursor.i++];
    if (e.interventions) cur = e.interventions;
    if (e.addStorm) st.extraStorms = [...st.extraStorms, { ...e.addStorm, t0: e.addStorm.t0 + origin }];
    if (e.addSource) st.extraSources = [...st.extraSources, { ...e.addSource, t0: e.addSource.t0 + origin }];
    log?.push({ t: st.t, label: e.label });
  }
  return cur;
}

export function runSchedule(m: Model, schedule: Schedule, duration: number, opts: { initial?: EcoState; recordEvery?: number; dt?: number; check?: boolean } = {}): RunResult {
  const sch = schedule.slice().sort((a, b) => a.t - b.t);
  sch.forEach(e => e.interventions && assertValid(validateInterventions(e.interventions, m.config), `干预 @${e.t}`));
  const dt = opts.dt ?? m.config.dt;
  let st = opts.initial ? cloneState(opts.initial) : createInitialState(m, NO_INTERVENTION);
  const startT = st.t, nSteps = Math.round(duration / dt), every = Math.max(1, Math.round((opts.recordEvery ?? 1) / dt));
  const samples: Sample[] = [], anomalies: string[] = [], log: { t: number; label: string }[] = [];
  let maxErr = 0, minV = Infinity;
  let catchAcc = new Array(m.P).fill(0), accT = 0;
  const record = () => {
    samples.push({ t: st.t, totals: m.sp.map((_, i) => speciesTotal(m, st.X, i)), catchRate: catchAcc.map(v => accT > 0 ? v / accT : 0), cumCatch: m.sp.map((_, i) => speciesTotal(m, st.cumCatch, i)) });
    catchAcc = new Array(m.P).fill(0); accT = 0;
  };
  record();
  let cur = NO_INTERVENTION;
  const cursor = { i: 0 };
  for (let n = 0; n < nSteps; n++) {
    cur = applyDue(st, sch, cursor, startT, cur, log);
    const r = step(m, st, cur, dt);
    if (opts.check !== false) {
      const b = checkBudget(m, r.ledger);
      maxErr = Math.max(maxErr, Math.abs(b.error), b.vmigError, b.hmigError);
      if (!b.ok) anomalies.push(`t=${r.state.t.toFixed(2)} 账本误差 ${b.error.toExponential(2)}（容差 ${b.tolerance.toExponential(2)}）迁移 ${b.vmigError.toExponential(1)}/${b.hmigError.toExponential(1)}`);
    }
    for (let g = 0; g < r.state.X.length; g++) { const v = r.state.X[g]; if (v < minV) minV = v; if (!Number.isFinite(v)) { anomalies.push(`t=${r.state.t.toFixed(2)} 出现非有限值`); break; } }
    for (let i = 0; i < m.P; i++) catchAcc[i] += speciesTotal(m, r.ledger.catch, i);
    accT += dt;
    st = r.state;
    if ((n + 1) % every === 0 || n === nSteps - 1) record();
    if (anomalies.length > 20) break;
  }
  if (minV < -1e-9) anomalies.push(`出现负生物量 ${minV}`);
  return { model: m, samples, final: st, startT, maxBudgetError: maxErr, minValue: minV, anomalies, log };
}

// ---------------- 对照实验 ----------------

export type ExperimentId = 'A' | 'B' | 'C' | 'D' | 'E' | 'T' | 'H' | 'N';

const iv = (p: Partial<Interventions> = {}, fishing: Partial<Interventions['fishing']> = {}): Interventions =>
  ({ ...NO_INTERVENTION, ...p, fishing: { ...NO_INTERVENTION.fishing, ...fishing } });

export interface ExperimentSpec { id: ExperimentId; name: string; description: string; treatment: Schedule }

export function experimentSpec(id: ExperimentId, world: World, p: { u?: number; target?: string; start?: number; stop?: number; supply?: number; dT?: number } = {}): ExperimentSpec {
  const start = p.start ?? 100;
  const fish = (target: string, u: number) => iv({}, { enabled: true, target, layer: 'all', u });
  switch (id) {
    case 'A': return { id, name: 'A 基线', description: '两组都不干预（自然台风季、辐射源、温度场照常）', treatment: [] };
    case 'B': { const u = p.u ?? 0.1; return { id, name: '持续捕捞 D', description: `t=${start} 起全海域捕捞 D，u=${u}`, treatment: [{ t: start, interventions: fish('D', u), label: `开始捕捞 D u=${u}` }] }; }
    case 'C': { const t = p.target ?? 'A', u = p.u ?? 0.3; return { id, name: `持续捕捞 ${t}`, description: `t=${start} 起全海域捕捞 ${t}，u=${u}`, treatment: [{ t: start, interventions: fish(t, u), label: `开始捕捞 ${t} u=${u}` }] }; }
    case 'D': { const u = p.u ?? 0.1, stop = p.stop ?? 1500; return { id, name: '捕捞 D 后停止', description: `t=${start}–${stop} 捕捞 D，u=${u}`, treatment: [{ t: start, interventions: fish('D', u), label: `开始捕捞 D u=${u}` }, { t: stop, interventions: NO_INTERVENTION, label: '停止捕捞' }] }; }
    case 'E': { const s = p.supply ?? 0.5; return { id, name: '降低基础饵料补给', description: `t=${start} 起补给倍率 ${s}`, treatment: [{ t: start, interventions: iv({ supplyMultiplier: s }), label: `补给 ${s}×` }] }; }
    case 'T': { const d = p.dT ?? 2; return { id, name: `海水升温 ${d > 0 ? '+' : ''}${d} °C`, description: `t=${start} 起全海域温度距平 ${d} °C`, treatment: [{ t: start, interventions: iv({ tempAnomaly: d }), label: `温度距平 ${d} °C` }] }; }
    case 'H': return {
      id, name: '一场超强台风', description: `t=${start} 起一场强度 2.0 的台风自东向西穿过海域中部`,
      treatment: [{ t: start, label: '超强台风生成', addStorm: { id: 'X1', name: '超强台风', t0: start, duration: 7, x0: world.nx + 2, y0: world.ny / 2, vx: -(world.nx + 6) / 7, vy: 0, radius: 4.5, intensity: 2.0 } }],
    };
    case 'N': return {
      id, name: '新的辐射泄漏', description: `t=${start} 起海域中部 L2 出现一个半衰期 800 日的辐射源`,
      treatment: [{ t: start, label: '辐射泄漏', addSource: { id: 'leak', name: '辐射泄漏', x: Math.round(world.nx * .55), y: Math.round(world.ny * .45), depth: 1050, S0: 3, t0: start, halfLife: 800 } }],
    };
  }
}

export interface ExperimentResult { spec: ExperimentSpec; warmup: number; snapshot: EcoState; control: RunResult; treatment: RunResult }

/** 同一预热快照 → 对照组（无干预）与实验组（只改指定变量），时长和 dt 相同 */
export function runExperiment(world: World, config: EcoConfig, id: ExperimentId, duration: number, opts: { warmup?: number; recordEvery?: number; params?: Parameters<typeof experimentSpec>[2] } = {}): ExperimentResult {
  const m = createModel(world, config);
  const spec = experimentSpec(id, world, opts.params);
  const warmup = opts.warmup ?? 0;
  let snap = createInitialState(m, NO_INTERVENTION);
  if (warmup > 0) snap = runSchedule(m, [], warmup, { initial: snap, recordEvery: warmup }).final;
  const recordEvery = opts.recordEvery ?? 1;
  return { spec, warmup, snapshot: cloneState(snap), control: runSchedule(m, [], duration, { initial: snap, recordEvery }), treatment: runSchedule(m, spec.treatment, duration, { initial: snap, recordEvery }) };
}

export function toCSV(r: RunResult, group: string, header = true): string {
  const ids = r.model.sp.map(s => s.id);
  const head = ['group', 't', ...ids.map(i => `${i}_total`), ...ids.slice(1).map(i => `${i}_catch_rate`), ...ids.slice(1).map(i => `${i}_cum_catch`)].join(',');
  const rows = r.samples.map(s => [group, (s.t - r.startT).toFixed(2), ...s.totals.map(v => v.toPrecision(8)), ...s.catchRate.slice(1).map(v => v.toPrecision(6)), ...s.cumCatch.slice(1).map(v => v.toPrecision(8))].join(','));
  return (header ? head + '\n' : '') + rows.join('\n') + '\n';
}

export { NLAYER };
