// 实时推进：界面每帧调用 frame(realSeconds)，这里决定执行多少个固定 dt 步。
// 速度只改变单位现实时间内的步数，不改变 dt，因此生态结果与帧率无关。
// 本文件不依赖 DOM，可以在测试里直接驱动。
import {
  NO_INTERVENTION, Simulator, cloneState, createInitialState, runScenario, POOLS, poolTotal,
  type EcoConfig, type EcoState, type Interventions, type Schedule, type StepLedger,
} from '../sim';

export interface HistoryPoint { t: number; totals: number[]; layers: number[][]; catchRate: number[] }
export interface LogEntry { t: number; label: string; interventions: Interventions }

/** 单帧最多执行的步数，防止切回标签页时卡死；超出部分丢弃（只影响推进快慢，不影响结果正确性） */
export const MAX_STEPS_PER_FRAME = 4000;

export class Driver {
  exp!: Simulator;
  ctrl!: Simulator;
  running = true;
  /** 模拟日 / 现实秒 */
  speed = 20;
  histExp: HistoryPoint[] = [];
  histCtrl: HistoryPoint[] = [];
  log: LogEntry[] = [];
  /** 预设的干预日程（相对 origin 的时间），到点自动应用并写入日志 */
  pending: Schedule = [];
  origin = 0;
  warmup = 0;
  presetName = '自由探索';
  private acc = 0;
  private catchAccExp = new Array(5).fill(0);
  private catchAccCtrl = new Array(5).fill(0);
  private accT = 0;
  private recordEvery = 1;
  private sinceRecord = 0;

  constructor(public config: EcoConfig) { this.reset(); }

  /** 重置到初始状态（或预热快照），两组从同一快照出发 */
  reset(opts: { warmup?: number; schedule?: Schedule; name?: string } = {}) {
    let snap: EcoState = createInitialState(this.config);
    this.warmup = opts.warmup ?? 0;
    if (this.warmup > 0) snap = runScenario(this.config, [], this.warmup, { initial: snap, recordEvery: this.warmup }).final;
    this.exp = new Simulator(this.config, cloneState(snap), NO_INTERVENTION);
    this.ctrl = new Simulator(this.config, cloneState(snap), NO_INTERVENTION);
    this.origin = snap.t;
    this.pending = (opts.schedule ?? []).slice().sort((a, b) => a.t - b.t);
    this.presetName = opts.name ?? '自由探索';
    this.histExp = []; this.histCtrl = []; this.log = [];
    this.acc = 0; this.accT = 0; this.sinceRecord = 0;
    this.catchAccExp.fill(0); this.catchAccCtrl.fill(0);
    this.log.push({ t: snap.t, label: this.warmup > 0 ? `从预热 ${this.warmup} 日的快照开始` : '从初始状态开始', interventions: NO_INTERVENTION });
    this.record();
    this.applyPending();
  }

  /** 日程自动改变干预时通知界面同步输入控件 */
  onInterventionChange: ((iv: Interventions) => void) | null = null;

  /** 用户在界面上修改干预：只作用于实验组，并记录模拟时间戳 */
  setInterventions(iv: Interventions, label: string) {
    this.exp.setInterventions(iv);
    this.log.push({ t: this.exp.state.t, label, interventions: iv });
  }

  private applyPending() {
    while (this.pending.length && this.pending[0].t <= this.exp.state.t - this.origin + 1e-9) {
      const e = this.pending.shift()!;
      this.setInterventions(e.interventions, e.label);
      this.onInterventionChange?.(e.interventions);
    }
  }

  stepOnce() {
    this.applyPending();
    this.exp.advance(1); this.ctrl.advance(1);
    for (let i = 0; i < 5; i++) {
      const l = this.exp.ledger!, c = this.ctrl.ledger!;
      this.catchAccExp[i] += l.catch[i][0] + l.catch[i][1] + l.catch[i][2];
      this.catchAccCtrl[i] += c.catch[i][0] + c.catch[i][1] + c.catch[i][2];
    }
    this.accT += this.config.dt;
    this.sinceRecord += this.config.dt;
    if (this.sinceRecord >= this.recordEvery - 1e-9) { this.sinceRecord = 0; this.record(); }
  }

  /** 返回本帧执行的步数 */
  frame(realSeconds: number): number {
    if (!this.running) return 0;
    this.acc += realSeconds * this.speed;
    let n = Math.floor(this.acc / this.config.dt + 1e-9);
    if (n > MAX_STEPS_PER_FRAME) { n = MAX_STEPS_PER_FRAME; this.acc = 0; } else this.acc -= n * this.config.dt;
    for (let i = 0; i < n; i++) this.stepOnce();
    return n;
  }

  private record() {
    const mk = (s: Simulator, acc: number[]): HistoryPoint => ({
      t: s.state.t,
      totals: POOLS.map((_, i) => poolTotal(s.state.X, i)),
      layers: s.state.X.map(r => r.slice()),
      catchRate: acc.map(c => (this.accT > 0 ? c / this.accT : 0)),
    });
    this.histExp.push(mk(this.exp, this.catchAccExp));
    this.histCtrl.push(mk(this.ctrl, this.catchAccCtrl));
    this.catchAccExp.fill(0); this.catchAccCtrl.fill(0); this.accT = 0;
    // 历史太长时降采样（只影响曲线显示，不影响生态状态）
    if (this.histExp.length > 6000) {
      this.histExp = this.histExp.filter((_, i) => i % 2 === 0);
      this.histCtrl = this.histCtrl.filter((_, i) => i % 2 === 0);
      this.recordEvery *= 2;
    }
  }

  get ledger(): StepLedger | null { return this.exp.ledger; }

  /** 可重放的实验记录：参数 + 预热 + 带时间戳的干预 */
  exportRecord() {
    return {
      model: '无岸 简化深海生态模拟器 v0.1',
      config: this.config,
      warmupDays: this.warmup,
      preset: this.presetName,
      interventions: this.log.map(e => ({ t: +(e.t - this.origin).toFixed(4), absT: +e.t.toFixed(4), label: e.label, interventions: e.interventions })),
      endT: this.exp.state.t,
    };
  }
}
