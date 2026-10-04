import { NLAYER, NPOOL, type EcoConfig, type EcoState, type Interventions, type StepLedger } from './types';
import { fluxStep, makeLedger } from './flux-step';
import { migrate } from './migration';
import { checkBudget } from './ledger';
import { cloneMatrix, validateState } from './initial-state';
import { assertValid, validateInterventions } from './config';

export interface StepOptions {
  /** 关闭层间交换（只用于测试隔离过程） */
  noMigration?: boolean;
  /** 每步校验账本和状态，失败时抛错。默认开启 */
  check?: boolean;
}

/**
 * 推进一个生态步：先统一计算通量并提交（第五节），再做层间再分配（第六节）。
 * 纯函数：不修改传入的 state，返回新状态与本步账本。
 */
export function step(state: EcoState, config: EcoConfig, interventions: Interventions, dt: number = config.dt, opts: StepOptions = {}): { state: EcoState; ledger: StepLedger } {
  if (!(Number.isFinite(dt) && dt > 0)) throw new Error(`dt 非法：${dt}`);
  const flux = fluxStep(state.X, config, interventions, dt);
  const mig = opts.noMigration ? { X: cloneMatrix(flux.next), delta: flux.next.map(r => r.map(() => 0)) } : migrate(flux.next, config, dt);
  const ledger = makeLedger(state.X, flux, mig.delta, mig.X, dt);
  const cumCatch = cloneMatrix(state.cumCatch);
  for (let i = 0; i < NPOOL; i++) for (let k = 0; k < NLAYER; k++) cumCatch[i][k] += flux.catch[i][k];
  const next: EcoState = { t: state.t + dt, steps: state.steps + 1, X: mig.X, cumCatch };
  if (opts.check !== false) {
    const b = checkBudget(state.X, next.X, ledger);
    if (!b.ok) throw new Error(`生物量账本不平：t=${next.t.toFixed(3)} error=${b.error} tol=${b.tolerance} migErr=${b.migrationError}`);
    assertValid(validateState(next), `t=${next.t.toFixed(3)} 的状态`);
  }
  return { state: next, ledger };
}

/** 固定步长推进器：界面每帧决定执行多少步，但 dt 固定，结果与帧率无关 */
export class Simulator {
  state: EcoState;
  ledger: StepLedger | null = null;
  constructor(public config: EcoConfig, initial: EcoState, public interventions: Interventions) {
    assertValid(validateInterventions(interventions), '干预');
    this.state = initial;
  }
  setInterventions(iv: Interventions) {
    assertValid(validateInterventions(iv), '干预');
    this.interventions = iv;
  }
  advance(n = 1) {
    for (let s = 0; s < n; s++) {
      const r = step(this.state, this.config, this.interventions, this.config.dt);
      this.state = r.state; this.ledger = r.ledger;
    }
  }
}
