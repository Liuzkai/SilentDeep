import { FISH, NLAYER, NPOOL, POOLS, type EcoConfig, type EcoState, type FishId, type Interventions, type LayerTarget } from './types';
import { NO_INTERVENTION, assertValid, validateInterventions } from './config';
import { cloneState, createInitialState, poolTotal } from './initial-state';
import { step } from './simulator';
import { checkBudget } from './ledger';

/** 带模拟时间戳的干预记录：从 t 起生效，直到下一条记录 */
export interface ScheduleEvent {
  t: number;
  interventions: Interventions;
  label: string;
}
export type Schedule = ScheduleEvent[];

export interface Sample {
  t: number;
  /** X[pool][layer] 快照 */
  X: number[][];
  /** 各库总量 */
  totals: number[];
  /** 本记录区间内的捕获速率 BU/模拟日（按库） */
  catchRate: number[];
  /** 累计捕获 BU（按库） */
  cumCatch: number[];
}

export interface ScenarioResult {
  config: EcoConfig;
  schedule: Schedule;
  startT: number;
  duration: number;
  samples: Sample[];
  final: EcoState;
  /** 每步账本误差的最大绝对值 */
  maxBudgetError: number;
  /** 最小库存（出现显著负值即异常） */
  minValue: number;
  anomalies: string[];
}

export interface RunOptions {
  initial?: EcoState;
  /** 记录间隔，模拟日 */
  recordEvery?: number;
  dt?: number;
}

const iv = (fishing: Partial<Interventions['fishing']> = {}, supplyMultiplier = 1): Interventions => ({
  fishing: { ...NO_INTERVENTION.fishing, ...fishing },
  supplyMultiplier,
});

/** 在给定时刻生效的干预 */
export function interventionAt(schedule: Schedule, t: number): Interventions {
  let cur = NO_INTERVENTION;
  for (const e of schedule) if (e.t <= t + 1e-9) cur = e.interventions;
  return cur;
}

/** 按干预日程运行固定时长。确定性：不使用任何随机数 */
export function runScenario(config: EcoConfig, schedule: Schedule, duration: number, opts: RunOptions = {}): ScenarioResult {
  schedule.forEach(e => assertValid(validateInterventions(e.interventions), `干预 @${e.t}`));
  const dt = opts.dt ?? config.dt;
  const recordEvery = opts.recordEvery ?? 1;
  let state = opts.initial ? cloneState(opts.initial) : createInitialState(config);
  const startT = state.t;
  const nSteps = Math.round(duration / dt);
  const recordSteps = Math.max(1, Math.round(recordEvery / dt));
  const samples: Sample[] = [];
  const anomalies: string[] = [];
  let maxBudgetError = 0, minValue = Infinity;
  let catchAcc = new Array(NPOOL).fill(0), accT = 0;

  const record = () => {
    samples.push({
      t: state.t,
      X: state.X.map(r => r.slice()),
      totals: POOLS.map((_, i) => poolTotal(state.X, i)),
      catchRate: catchAcc.map(c => (accT > 0 ? c / accT : 0)),
      cumCatch: POOLS.map((_, i) => poolTotal(state.cumCatch, i)),
    });
    catchAcc = new Array(NPOOL).fill(0); accT = 0;
  };
  record();
  for (let n = 0; n < nSteps; n++) {
    const cur = interventionAt(schedule, state.t - startT);
    const r = step(state, config, cur, dt, { check: false });
    const b = checkBudget(state.X, r.state.X, r.ledger);
    maxBudgetError = Math.max(maxBudgetError, Math.abs(b.error));
    if (!b.ok) anomalies.push(`t=${r.state.t.toFixed(2)} 账本误差 ${b.error.toExponential(2)} 超过容差 ${b.tolerance.toExponential(2)}`);
    for (let i = 0; i < NPOOL; i++) for (let k = 0; k < NLAYER; k++) {
      const v = r.state.X[i][k];
      if (!Number.isFinite(v)) anomalies.push(`t=${r.state.t.toFixed(2)} X[${POOLS[i]}][${k}] 非有限值`);
      minValue = Math.min(minValue, v);
      catchAcc[i] += r.ledger.catch[i][k];
    }
    accT += dt;
    state = r.state;
    if ((n + 1) % recordSteps === 0 || n === nSteps - 1) record();
    if (anomalies.length > 20) break;
  }
  if (minValue < -1e-9) anomalies.push(`出现负生物量 ${minValue}`);
  return { config, schedule, startT, duration, samples, final: state, maxBudgetError, minValue, anomalies };
}

// ---------------- 对照实验 ----------------

export type ExperimentId = 'A' | 'B' | 'C' | 'D' | 'E';

export interface ExperimentSpec {
  id: ExperimentId;
  name: string;
  description: string;
  /** 实验组日程，t 相对实验起点（预热之后） */
  treatment: Schedule;
}

export interface ExperimentParams {
  /** 捕捞强度 u */
  u?: number;
  /** 实验 C 的目标 A 或 B */
  forageTarget?: FishId;
  layer?: LayerTarget;
  /** 干预开始时刻（相对实验起点），模拟日 */
  start?: number;
  /** 实验 D 的停止时刻 */
  stop?: number;
  /** 实验 E 的补给倍率 */
  supply?: number;
}

export function experimentSpec(id: ExperimentId, p: ExperimentParams = {}): ExperimentSpec {
  const u = p.u ?? (id === 'D' ? 0.3 : 0.5), layer = p.layer ?? 'all', start = p.start ?? 100, stop = p.stop ?? 1500;
  const fish = (target: FishId) => iv({ enabled: true, target, layer, u });
  switch (id) {
    case 'A': return { id, name: 'A 无捕捞基线', description: '实验组与对照组都不干预，用于确认两组计算完全一致', treatment: [] };
    case 'B': return { id, name: 'B 持续捕捞 D', description: `t=${start} 起持续捕捞 D，u=${u}（F=${u}·Fmax）`, treatment: [{ t: start, interventions: fish('D'), label: `开始捕捞 D u=${u}` }] };
    case 'C': {
      const t = p.forageTarget ?? 'A';
      return { id, name: `C 持续捕捞 ${t}`, description: `t=${start} 起持续捕捞 ${t}，u=${u}`, treatment: [{ t: start, interventions: fish(t), label: `开始捕捞 ${t} u=${u}` }] };
    }
    case 'D': return {
      // 默认 u 比 B 低：u 过高时 D 在停捕前已被压到 1e-9 量级，停捕后的回升在数千日内都看不出来
      id, name: 'D 捕捞 D 后停止', description: `t=${start} 起捕捞 D，t=${stop} 停止（F 归零，不补鱼）`,
      treatment: [{ t: start, interventions: fish('D'), label: `开始捕捞 D u=${u}` }, { t: stop, interventions: NO_INTERVENTION, label: '停止捕捞' }],
    };
    case 'E': {
      const s = p.supply ?? 0.5;
      return { id, name: 'E 降低基础饵料补给', description: `t=${start} 起外部补给倍率降到 ${s}`, treatment: [{ t: start, interventions: iv({}, s), label: `补给倍率 ${s}` }] };
    }
  }
}

export interface ExperimentResult {
  spec: ExperimentSpec;
  warmupDays: number;
  /** 两组共用的预热快照 */
  snapshot: EcoState;
  control: ScenarioResult;
  treatment: ScenarioResult;
}

/**
 * 对照实验：先无捕捞预热（真实计算），得到同一快照；
 * 再从这份快照分别运行对照组（无干预）和实验组（只改指定变量），时长、dt、参数完全相同。
 */
export function runExperiment(config: EcoConfig, id: ExperimentId, duration: number, opts: { warmup?: number; recordEvery?: number; params?: ExperimentParams } = {}): ExperimentResult {
  const spec = experimentSpec(id, opts.params);
  const warmupDays = opts.warmup ?? 0;
  let snapshot = createInitialState(config);
  if (warmupDays > 0) snapshot = runScenario(config, [], warmupDays, { initial: snapshot, recordEvery: warmupDays }).final;
  const recordEvery = opts.recordEvery ?? 1;
  const control = runScenario(config, [], duration, { initial: snapshot, recordEvery });
  const treatment = runScenario(config, spec.treatment, duration, { initial: snapshot, recordEvery });
  return { spec, warmupDays, snapshot: cloneState(snapshot), control, treatment };
}

/** 导出 CSV：每行一个记录时刻，包含每个库每层的生物量、捕获速率、累计捕获 */
export function toCSV(r: ScenarioResult, group = ''): string {
  const head = ['group', 't', ...POOLS.flatMap(p => [0, 1, 2].map(k => `${p}_L${k + 1}`)), ...POOLS.map(p => `${p}_total`), ...FISH.map(p => `${p}_catch_rate`), ...FISH.map(p => `${p}_cum_catch`)];
  const rows = r.samples.map(s => [group, s.t.toFixed(2), ...s.X.flatMap(row => row.map(v => v.toPrecision(8))), ...s.totals.map(v => v.toPrecision(8)),
    ...s.catchRate.slice(1).map(v => v.toPrecision(6)), ...s.cumCatch.slice(1).map(v => v.toPrecision(8))].join(','));
  return [head.join(','), ...rows].join('\n') + '\n';
}
