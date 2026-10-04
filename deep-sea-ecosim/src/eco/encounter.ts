// 游戏层：把生态状态换算成"遭遇概率"。游戏里不出现具体生物体，只出现声呐接触的概率。
// 本模块只读生态状态，不改变任何生物量（遭遇不会从库存里扣除任何东西）。
import { NLAYER, type EnvSnapshot, type EcoState } from './types';
import { type Model, at } from './step';

export interface EncounterQuery {
  /** 本艇所在格子坐标 */
  x: number; y: number;
  /** 本艇深度 m */
  depth: number;
  /** 本艇辐射噪声 dB（游戏里 ELEC 界面的噪声值） */
  noise: number;
  /** 时间窗，小时 */
  hours: number;
}

export interface EncounterResult {
  id: string;
  name: string;
  tier?: string;
  /** 每小时期望接触次数 */
  rate: number;
  /** 时间窗内至少一次接触的概率 */
  p: number;
  /** 主要贡献来自哪一层 */
  layer: number;
  /** 密度相对参考值 */
  rel: number;
  derived?: boolean;
}

/** 声呐对其他层的相对灵敏度：同层 1，相邻层 0.3，隔一层 0.08 */
const LAYER_W = [1, 0.3, 0.08];
/** 噪声吸引的参考值：100 dB 以下不额外吸引 */
const NOISE_REF = 100;

export function layerOfDepth(depth: number): number {
  return depth < 900 ? 0 : depth < 1200 ? 1 : 2;
}

/** 参考密度：完整水柱初始均摊到三层的密度 */
const refDensity = (m: Model, i: number) => m.sp[i].initialPerColumn / 3;

/**
 * 各物种的遭遇概率。
 *   λ_i = base_i · Σ_k w_k·(ρ_ik / ρ_ref,i) · (1 + noiseAttract_i · max(0, noise − 100)/10)
 *   P = 1 − exp(−λ·hours)
 * ρ 是层内密度（BU / 层体积比例）。再加两个由生态状态派生的事件：回声体、利维坦。
 */
export function encounters(m: Model, st: EcoState, env: EnvSnapshot, q: EncounterQuery): EncounterResult[] {
  const xi = Math.max(0, Math.min(m.world.nx - 1, Math.round(q.x))), yi = Math.max(0, Math.min(m.world.ny - 1, Math.round(q.y)));
  const c = yi * m.world.nx + xi, kb = layerOfDepth(q.depth);
  const noiseX = Math.max(0, q.noise - NOISE_REF) / 10;
  const out: EncounterResult[] = [];
  const dens = (i: number, k: number) => { const v = env.vol[c * 3 + k]; return v > 0 ? st.X[at(m, i, c, k)] / v : 0; };

  for (let i = 1; i < m.P; i++) {
    const s = m.sp[i]; if (!s.enc) continue;
    let acc = 0, best = 0, bestK = kb;
    for (let k = 0; k < NLAYER; k++) {
      const w = LAYER_W[Math.abs(k - kb)] * dens(i, k) / refDensity(m, i);
      acc += w; if (w > best) { best = w; bestK = k; }
    }
    const rate = s.enc.base * acc * (1 + s.enc.noiseAttract * noiseX);
    out.push({ id: s.id, name: s.name, tier: s.tier, rate, p: 1 - Math.exp(-rate * q.hours), layer: bestK, rel: acc });
  }

  // 回声体（Ⅲ）：不是生物量库。它模仿中大型捕食者的声纹来猎食，被噪声吸引。
  // 游戏设定：它出现的机会跟"可模仿的对象"（C、D）的密度和本艇噪声成正比，并在辐射区更活跃。
  const iC = m.idx.C, iD = m.idx.D;
  if (iC != null && iD != null) {
    let mimic = 0;
    for (let k = 0; k < NLAYER; k++) mimic += LAYER_W[Math.abs(k - kb)] * (dens(iC, k) / refDensity(m, iC) + dens(iD, k) / refDensity(m, iD)) / 2;
    const rad = env.I[c * 3 + kb];
    const rate = 0.01 * mimic * (1 + 1.5 * noiseX) * (1 + 2 * rad);
    out.push({ id: 'ECHO', name: '回声体', tier: 'Ⅲ', rate, p: 1 - Math.exp(-rate * q.hours), layer: kb, rel: mimic, derived: true });
  }

  // 利维坦（Ⅴ）：区域性传说。只在深海沟附近、生物量丰富、并被强噪声吸引时出现。
  // 它出现时声呐上所有信号都会消失（游戏表现，由游戏层处理）。
  let bio = 0, ref = 0;
  for (let i = 1; i < m.P; i++) for (let k = 0; k < NLAYER; k++) { bio += dens(i, k); }
  for (let i = 1; i < m.P; i++) ref += m.sp[i].initialPerColumn;
  const trench = m.world.floor[c] > 1800 ? 1 : m.world.floor[c] > 1500 ? 0.25 : 0.02;
  const lvRate = 0.0015 * trench * Math.pow(Math.max(0, bio / ref), 2) * (1 + 3 * noiseX * noiseX);
  out.push({ id: 'LEVIATHAN', name: '利维坦', tier: 'Ⅴ', rate: lvRate, p: 1 - Math.exp(-lvRate * q.hours), layer: 2, rel: bio / ref, derived: true });
  return out;
}

/** 某物种在全海域每个格子、本艇深度处的遭遇率（用于概率热力图） */
export function encounterField(m: Model, st: EcoState, env: EnvSnapshot, id: string, depth: number, noise: number, hours: number): Float64Array {
  const f = new Float64Array(m.N);
  for (let c = 0; c < m.N; c++) {
    const r = encounters(m, st, env, { x: c % m.world.nx, y: (c / m.world.nx) | 0, depth, noise, hours }).find(e => e.id === id);
    f[c] = r ? r.p : 0;
  }
  return f;
}
