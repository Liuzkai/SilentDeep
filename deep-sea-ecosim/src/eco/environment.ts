// 环境场：每一步由 (world, 状态里的台风/辐射源, 干预, t) 算出一份快照。
// 环境量不是生物量，不进入生物量账本。
import { LAYER_BOTTOM, LAYER_MID, LAYER_TOP, NLAYER, type EcoConfig, type EcoState, type EnvSnapshot, type Interventions, type RadSource, type Storm, type World } from './types';

/** 各层体积比例：海底以下的部分不存在。海底浅于 600 m 时整柱都在模型域外 */
export function layerVolumes(world: World, config: EcoConfig): { vol: Float64Array; floorLayer: Int8Array } {
  const N = world.nx * world.ny, vol = new Float64Array(N * NLAYER), floorLayer = new Int8Array(N);
  for (let c = 0; c < N; c++) {
    const f = world.floor[c];
    floorLayer[c] = f < LAYER_TOP[0] ? -1 : f >= LAYER_BOTTOM[2] ? 3 : f < LAYER_BOTTOM[0] ? 0 : f < LAYER_BOTTOM[1] ? 1 : 2;
    for (let k = 0; k < NLAYER; k++) {
      vol[c * NLAYER + k] = config.couple.bathymetry ? Math.max(0, Math.min(1, (f - LAYER_TOP[k]) / (LAYER_BOTTOM[k] - LAYER_TOP[k]))) : 1;
    }
    if (!config.couple.bathymetry) floorLayer[c] = 3;
  }
  return { vol, floorLayer };
}

/** 台风在 t 时刻的海面扰动强度（0 = 无），带起止的平滑包络 */
export function stormSurface(s: Storm, x: number, y: number, t: number): number {
  const tau = t - s.t0;
  if (tau < 0 || tau > s.duration) return 0;
  const env = Math.sin(Math.PI * tau / s.duration);
  const cx = s.x0 + s.vx * tau, cy = s.y0 + s.vy * tau;
  const r2 = ((x - cx) ** 2 + (y - cy) ** 2) / (s.radius * s.radius);
  return s.intensity * env * Math.exp(-r2);
}

export function stormCenter(s: Storm, t: number): [number, number] | null {
  const tau = t - s.t0;
  if (tau < 0 || tau > s.duration) return null;
  return [s.x0 + s.vx * tau, s.y0 + s.vy * tau];
}

export function sourceStrength(s: RadSource, t: number): number {
  if (t < s.t0) return 0;
  return Number.isFinite(s.halfLife) ? s.S0 * Math.pow(0.5, (t - s.t0) / s.halfLife) : s.S0;
}

/** 某一时刻全部生效的台风和辐射源 */
export const activeStorms = (world: World, st: EcoState) => [...world.storms, ...st.extraStorms];
export const activeSources = (world: World, st: EcoState) => [...world.radSources, ...st.extraSources];
/** 当前时刻正在海面上的台风（其余台风对本步没有影响，先筛掉省计算） */
const liveStorms = (world: World, st: EcoState) => activeStorms(world, st).filter(s => st.t >= s.t0 && st.t <= s.t0 + s.duration);

/**
 * 环境快照。耦合开关关闭时，对应环境量取参考值：
 * 温度 = Tref（代谢修正为 1、热生态位为最适），辐射 = 0，扰动 = 0，补给脉冲倍率 = 1。
 */
export function environment(world: World, config: EcoConfig, st: EcoState, iv: Interventions, vv: ReturnType<typeof layerVolumes>): EnvSnapshot {
  const N = world.nx * world.ny, t = st.t;
  const T = new Float64Array(N * NLAYER), I = new Float64Array(N * NLAYER), dist = new Float64Array(N * NLAYER), boost = new Float64Array(N * NLAYER);
  const storms = config.couple.storms ? liveStorms(world, st) : [];
  const sources = config.couple.radiation ? activeSources(world, st).map(s => ({ s, S: sourceStrength(s, t) })).filter(x => x.S > 0) : [];
  const sf = config.storm;
  for (let y = 0; y < world.ny; y++) for (let x = 0; x < world.nx; x++) {
    const c = y * world.nx + x;
    let surf = 0;
    for (const s of storms) surf += stormSurface(s, x, y, t);
    for (let k = 0; k < NLAYER; k++) {
      const o = c * NLAYER + k;
      const d = sf.layerFactor[k] * surf;
      dist[o] = d;
      // 温度：基础场 + 全局距平 − 台风混合降温（只作用于 L1）
      T[o] = config.couple.temperature ? world.Tbase[o] + iv.tempAnomaly - (k === 0 ? sf.coolL1 * d : 0) : config.Tref;
      // 辐射：背景 + 各源按水平、垂直距离指数衰减
      if (config.couple.radiation) {
        let r = config.radBackground;
        for (const { s, S } of sources) {
          const dh = Math.hypot(x - s.x, y - s.y), dv = Math.abs(LAYER_MID[k] - s.depth);
          r += S * Math.exp(-dh / config.radLh - dv / config.radLv);
        }
        I[o] = r;
      }
      // 台风沉降脉冲：延迟链第 k 级对应第 k 层
      boost[o] = config.couple.storms ? 1 + sf.pulseGain * st.rain[c * NLAYER + k] : 1;
    }
  }
  return { t, vol: vv.vol, floorLayer: vv.floorLayer, T, I, dist, boost };
}

/**
 * 推进台风沉降延迟链（环境量）：海面扰动 → 第 1 级 → 第 2 级 → 第 3 级，一阶线性，各级有自己的时间常数。
 * 精确指数积分对每一级分开做（输入在一步内视为常数）。
 */
export function advanceRain(world: World, config: EcoConfig, st: EcoState, h: number): Float64Array {
  const out = new Float64Array(st.rain.length);
  if (!config.couple.storms) return out;
  const storms = liveStorms(world, st);
  const tau = config.storm.pulseTau;
  for (let y = 0; y < world.ny; y++) for (let x = 0; x < world.nx; x++) {
    const c = y * world.nx + x;
    let surf = 0;
    for (const s of storms) surf += stormSurface(s, x, y, st.t);
    let input = surf;
    for (let k = 0; k < NLAYER; k++) {
      const o = c * NLAYER + k, a = Math.exp(-h / tau[k]);
      out[o] = st.rain[o] * a + input * (1 - a);
      input = st.rain[o];
    }
  }
  return out;
}
