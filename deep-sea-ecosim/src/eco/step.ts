// v0.2 统一更新：每个 (格子, 层) 仍然是 v0.1 的第五节通量计算，另外加上
//   · 温度：摄食上限与背景损失乘代谢系数 Q10^((T−Tref)/10)，摄食再乘热生态位 φ(T)
//   · 辐射：额外损失率 radSens·I
//   · 台风：额外损失率 stormSens·扰动；R 补给乘沉降脉冲倍率
//   · 海底深度：层体积比例 vol ∈ [0,1]，半饱和量按体积换算成密度；vol=0 的层不存在
// 然后做层间再分配（目标分布受环境调整）和格子之间的水平输运（洋流 + 带偏向的扩散）。
// 所有过程都从同一份快照计算后统一提交；关闭全部耦合时，浮点运算顺序与 v0.1 相同。
import { NLAYER, type EcoConfig, type EcoState, type EnvSnapshot, type Interventions, type Ledger, type SpeciesDef, type World } from './types';
import { dietMatrix, assertValid, validateConfig } from './config';
import { advanceRain, environment, layerVolumes } from './environment';

export interface Model {
  world: World;
  config: EcoConfig;
  sp: SpeciesDef[];
  P: number;
  N: number;
  a: Float64Array;
  idx: Record<string, number>;
  vv: ReturnType<typeof layerVolumes>;
  /** 相邻格：每格最多 4 个，-1 表示没有；nbr[c*4+d] */
  nbr: Int32Array;
  /** 从 c 流向第 d 个相邻格的洋流输运率（≥0，1/模拟日），flow[c*4+d] */
  flow: Float64Array;
}

export function createModel(world: World, config: EcoConfig): Model {
  assertValid(validateConfig(config), '配置');
  const N = world.nx * world.ny, P = config.species.length;
  const idx: Record<string, number> = {};
  config.species.forEach((s, i) => { idx[s.id] = i; });
  const nbr = new Int32Array(N * 4).fill(-1), flow = new Float64Array(N * 4);
  const W = world.nx + 1, psi = (i: number, j: number) => world.psi[j * W + i];
  for (let y = 0; y < world.ny; y++) for (let x = 0; x < world.nx; x++) {
    const c = y * world.nx + x;
    // 四个面的法向输运率（正 = 向 +x 或 +y）：由流函数差分得到，所以每个格子的净输运恒为 0
    const east = psi(x + 1, y + 1) - psi(x + 1, y);
    const west = psi(x, y + 1) - psi(x, y);
    const north = psi(x, y + 1) - psi(x + 1, y + 1);
    const south = psi(x, y) - psi(x + 1, y);
    const faces: [number, number, number][] = [[x + 1, y, east], [x - 1, y, -west], [x, y + 1, north], [x, y - 1, -south]];
    faces.forEach(([nx_, ny_, f], d) => {
      if (nx_ < 0 || ny_ < 0 || nx_ >= world.nx || ny_ >= world.ny) return;
      nbr[c * 4 + d] = ny_ * world.nx + nx_;
      flow[c * 4 + d] = Math.max(0, f);
    });
  }
  return { world, config, sp: config.species, P, N, a: dietMatrix(config), idx, vv: layerVolumes(world, config), nbr, flow };
}

export const at = (m: Model, i: number, c: number, k: number) => (i * m.N + c) * NLAYER + k;

/**
 * 物种 i 在 (c,k) 的栖息适宜度对数 S。只含已开启的耦合，全部关闭时恒为 0。
 * 用于层间目标分布（权重 × e^S）和水平扩散的偏向（c→n 的速率 × e^((S_n−S_c)/2)）。
 */
function habitat(m: Model, env: EnvSnapshot, s: SpeciesDef, c: number, k: number): number {
  const cp = m.config.couple, o = c * NLAYER + k;
  let S = 0;
  if (cp.temperature && s.thermal) { const z = (env.T[o] - s.thermal.Topt) / s.thermal.Tsig; S -= z * z; }
  if (cp.radiation && s.radPref !== 0) S += s.radPref * env.I[o] / (1 + env.I[o]);
  if (cp.storms && s.stormAvoid !== 0) S -= s.stormAvoid * env.dist[o];
  if (cp.bathymetry && s.trenchPref !== 0 && m.world.floor[c] > 1500) S += s.trenchPref;
  return S;
}

/**
 * 每步预先算好 S(i,c,k) 和 e^S，层间分布和水平扩散都查这张表。
 * S 恰好为 0 的位置 e^S 也恰好为 1。
 */
function habitatTable(m: Model, env: EnvSnapshot): { S: Float64Array; eS: Float64Array } {
  const L = m.P * m.N * NLAYER, S = new Float64Array(L), eS = new Float64Array(L).fill(1);
  for (let i = 1; i < m.P; i++) {
    const s = m.sp[i];
    for (let c = 0; c < m.N; c++) for (let k = 0; k < NLAYER; k++) {
      const v = habitat(m, env, s, c, k);
      if (v !== 0) { const g = at(m, i, c, k); S[g] = v; eS[g] = Math.exp(v); }
    }
  }
  return { S, eS };
}

/** 物种 i 在格子 c 的目标层分布；返回 false 表示本格没有可栖息的层 */
function targetDist(m: Model, env: EnvSnapshot, ht: { S: Float64Array; eS: Float64Array }, i: number, c: number, out: number[]): boolean {
  const s = m.sp[i], vol = env.vol;
  let plain = !s.benthic;
  const w = [0, 0, 0];
  const fl = Math.min(2, env.floorLayer[c]);
  for (let k = 0; k < NLAYER; k++) {
    const v = vol[c * NLAYER + k], g = at(m, i, c, k);
    if (v !== 1 || ht.S[g] !== 0) plain = false;
    w[k] = s.p[k] * v * ht.eS[g] * (s.benthic && k !== fl ? 0 : 1);
  }
  // 没有任何环境调整时直接用配置的 p，保证与 v0.1 逐位一致
  if (plain) { out[0] = s.p[0]; out[1] = s.p[1]; out[2] = s.p[2]; return true; }
  const sum = w[0] + w[1] + w[2];
  if (!(sum > 0)) return false;
  out[0] = w[0] / sum; out[1] = w[1] / sum; out[2] = w[2] / sum;
  return true;
}

/** 初始状态：鱼类按目标分布 × 水柱水量摆放，R 按层体积摆放 */
export function createInitialState(m: Model, iv: Interventions): EcoState {
  const st: EcoState = { t: 0, steps: 0, X: new Float64Array(m.P * m.N * NLAYER), cumCatch: new Float64Array(m.P * m.N * NLAYER), rain: new Float64Array(m.N * NLAYER), extraStorms: [], extraSources: [] };
  const env = environment(m.world, m.config, st, iv, m.vv);
  const ht = habitatTable(m, env);
  const pd = [0, 0, 0];
  for (let c = 0; c < m.N; c++) {
    const colFrac = (env.vol[c * 3] + env.vol[c * 3 + 1] + env.vol[c * 3 + 2]) / 3;
    for (let k = 0; k < NLAYER; k++) st.X[at(m, 0, c, k)] = m.config.resource.initial[k] * env.vol[c * 3 + k];
    for (let i = 1; i < m.P; i++) {
      if (!targetDist(m, env, ht, i, c, pd)) continue;
      for (let k = 0; k < NLAYER; k++) st.X[at(m, i, c, k)] = m.sp[i].initialPerColumn * colFrac * pd[k];
    }
  }
  return st;
}

export const cloneState = (s: EcoState): EcoState => ({
  t: s.t, steps: s.steps, X: s.X.slice(), cumCatch: s.cumCatch.slice(), rain: s.rain.slice(),
  extraStorms: s.extraStorms.map(x => ({ ...x })), extraSources: s.extraSources.map(x => ({ ...x })),
});

/** 捕捞损失率 F(i,c,k) */
function fishingRate(m: Model, iv: Interventions, i: number, c: number, k: number): number {
  const f = iv.fishing;
  if (!f.enabled || f.u <= 0 || m.sp[i].id !== f.target) return 0;
  if (!(f.layer === 'all' || f.layer === k)) return 0;
  if (f.region) {
    const x = c % m.world.nx, y = (c / m.world.nx) | 0;
    if ((x - f.region.cx) ** 2 + (y - f.region.cy) ** 2 > f.region.r * f.region.r) return 0;
  }
  return f.u * m.config.Fmax;
}

const newLedger = (m: Model, h: number): Ledger => {
  const L = m.P * m.N * NLAYER, z = () => new Float64Array(L);
  return { dt: h, gain: z(), predLoss: z(), background: z(), catch: z(), radLoss: z(), stormLoss: z(), unretained: z(), supply: z(), vmig: z(), hmig: z(), Ccell: new Float64Array(m.N * m.P * m.P), totalBefore: 0, totalAfter: 0 };
};

export interface StepOptions { check?: boolean }

export function step(m: Model, st: EcoState, iv: Interventions, h: number = m.config.dt): { state: EcoState; ledger: Ledger; env: EnvSnapshot } {
  if (!(Number.isFinite(h) && h > 0)) throw new Error(`dt 非法：${h}`);
  const { P, N, sp, a, config } = m, cp = config.couple;
  const env = environment(m.world, config, st, iv, m.vv);
  const X = st.X, L = newLedger(m, h);
  const X1 = new Float64Array(X.length);

  // 物种级的温度系数只和 (c,k) 有关，放进循环里算
  const U = new Float64Array(P * P), x = new Float64Array(P), qe = new Float64Array(P), me = new Float64Array(P);
  const Ck = new Float64Array(P * P), rem = new Float64Array(P);
  const Fk = new Float64Array(P);
  for (let c = 0; c < N; c++) for (let k = 0; k < NLAYER; k++) {
    const o = c * NLAYER + k, vol = env.vol[o];
    for (let i = 0; i < P; i++) x[i] = X[at(m, i, c, k)];
    if (vol <= 0) { for (let i = 0; i < P; i++) X1[at(m, i, c, k)] = x[i]; continue; }
    // 温度修正（关闭时严格等于原参数）
    for (let i = 0; i < P; i++) {
      const s = sp[i];
      if (cp.temperature && s.thermal) {
        const Mt = Math.pow(s.thermal.Q10, (env.T[o] - config.Tref) / 10);
        const z = (env.T[o] - s.thermal.Topt) / s.thermal.Tsig;
        qe[i] = s.q * Mt * Math.exp(-z * z); me[i] = s.m * Mt;
      } else { qe[i] = s.q; me[i] = s.m; }
    }
    // ① 摄食需求 U[i][j]：H 按层体积换算，vol=1 时就是 v0.1 公式
    U.fill(0);
    for (let i = 1; i < P; i++) {
      const Xi = x[i];
      if (Xi <= 0 || qe[i] === 0) continue;
      let food = 0;
      for (let j = 0; j < P; j++) food += a[i * P + j] * Math.max(0, x[j]);
      if (food <= 0) continue;
      const kk = qe[i] * Xi / (sp[i].H * vol + food);
      for (let j = 0; j < P; j++) if (a[i * P + j] > 0 && x[j] > 0) U[i * P + j] = kk * a[i * P + j] * x[j];
    }
    // ② 统一移除：捕食 + 背景 + 捕捞 + 辐射 + 台风，共享同一份库存
    Ck.fill(0); rem.fill(0);
    for (let j = 0; j < P; j++) Fk[j] = fishingRate(m, iv, j, c, k);
    for (let j = 0; j < P; j++) {
      const Xj = x[j];
      let pred = 0;
      for (let i = 0; i < P; i++) pred += U[i * P + j];
      const F = Fk[j];
      const rr = cp.radiation ? sp[j].radSens * env.I[o] : 0;
      const sr = cp.storms ? sp[j].stormSens * env.dist[o] : 0;
      const out = pred + me[j] * Xj + F * Xj + rr * Xj + sr * Xj;
      if (Xj <= 0 || out <= 0) continue;
      const r = -Xj * Math.expm1(-(out / Xj) * h);
      const scale = r / out;
      const g = at(m, j, c, k);
      rem[j] = r;
      for (let i = 0; i < P; i++) Ck[i * P + j] = U[i * P + j] * scale;
      L.predLoss[g] = pred * scale;
      L.background[g] = me[j] * Xj * scale;
      L.catch[g] = F * Xj * scale;
      L.radLoss[g] = rr * Xj * scale;
      L.stormLoss[g] = sr * Xj * scale;
    }
    // ③ 统一提交
    for (let i = 0; i < P; i++) {
      const g = at(m, i, c, k);
      let gain = 0, supply = 0;
      if (i > 0) {
        let eaten = 0;
        for (let j = 0; j < P; j++) eaten += Ck[i * P + j];
        gain = sp[i].eta * eaten;
        L.unretained[g] = (1 - sp[i].eta) * eaten;
      } else {
        supply = config.resource.J[k] * vol * iv.supplyMultiplier * env.boost[o] * h;
      }
      L.gain[g] = gain; L.supply[g] = supply;
      X1[g] = x[i] - rem[i] + gain + supply;
    }
    for (let q = 0; q < P * P; q++) L.Ccell[c * P * P + q] += Ck[q];
  }

  // ④ 层间再分配：目标分布受温度、辐射、台风、底栖约束调整；台风时调整加快
  const ht = habitatTable(m, env);
  const X2 = X1.slice();
  const pd = [0, 0, 0];
  for (let i = 1; i < P; i++) {
    const s = sp[i];
    for (let c = 0; c < N; c++) {
      const g0 = at(m, i, c, 0), g1 = g0 + 1, g2 = g0 + 2;
      const T = X1[g0] + X1[g1] + X1[g2];
      if (!(T > 0)) continue;
      if (!targetDist(m, env, ht, i, c, pd)) continue;
      const dmax = cp.storms ? Math.max(env.dist[c * 3], env.dist[c * 3 + 1], env.dist[c * 3 + 2]) : 0;
      const theta = -Math.expm1(-(s.mu + s.stormFlee * dmax) * h);
      for (let k = 0; k < NLAYER; k++) {
        const g = g0 + k;
        X2[g] = (1 - theta) * X1[g] + theta * pd[k] * T;
        L.vmig[g] = X2[g] - X1[g];
      }
    }
  }

  // ⑤ 水平输运：每个源格的总外流速率用指数形式得到移出量，再按比例分给各相邻格（守恒、非负）
  // 底栖物种沿海底爬行：从本格的海底层移到相邻格的海底层（两边海底所在层可能不同）
  let X3 = X2;
  if (cp.horizontal && N > 1) {
    X3 = X2.slice();
    const r = new Float64Array(4), dk = new Int32Array(4);
    for (let i = 0; i < P; i++) {
      const s = sp[i];
      if (s.Dh === 0 && s.adv === 0) continue;
      for (let c = 0; c < N; c++) for (let k = 0; k < NLAYER; k++) {
        const g = at(m, i, c, k), Xc = X2[g], vc = env.vol[c * 3 + k];
        if (!(Xc > 0) || vc <= 0) continue;
        const eSc = ht.eS[g];
        let R = 0;
        for (let d = 0; d < 4; d++) {
          r[d] = 0;
          const n = m.nbr[c * 4 + d]; if (n < 0) continue;
          const kn = s.benthic ? Math.min(2, env.floorLayer[n]) : k;
          if (kn < 0) continue;
          dk[d] = kn;
          const vn = env.vol[n * 3 + kn]; if (vn <= 0) continue;
          const gate = Math.min(vc, vn) / vc;
          // 扩散偏向适宜度更高的格子：速率 × e^((S_n − S_c)/2)，成对的正反速率之比正好是 e^(S_n−S_c)
          const diff = s.Dh > 0 ? s.Dh * gate * Math.sqrt(ht.eS[at(m, i, n, kn)] / eSc) : 0;
          r[d] = diff + s.adv * m.flow[c * 4 + d] * gate;
          R += r[d];
        }
        if (R <= 0) continue;
        const moved = -Xc * Math.expm1(-R * h);
        X3[g] -= moved; L.hmig[g] -= moved;
        for (let d = 0; d < 4; d++) if (r[d] > 0) {
          const gn = at(m, i, m.nbr[c * 4 + d], dk[d]), q = moved * r[d] / R;
          X3[gn] += q; L.hmig[gn] += q;
        }
      }
    }
  }

  const cum = st.cumCatch.slice();
  for (let g = 0; g < cum.length; g++) cum[g] += L.catch[g];
  L.totalBefore = sum(X); L.totalAfter = sum(X3);
  const next: EcoState = { t: st.t + h, steps: st.steps + 1, X: X3, cumCatch: cum, rain: advanceRain(m.world, config, st, h), extraStorms: st.extraStorms, extraSources: st.extraSources };
  return { state: next, ledger: L, env };
}

export function sum(a: Float64Array): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
