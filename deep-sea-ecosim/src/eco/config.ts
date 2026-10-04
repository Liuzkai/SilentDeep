// v0.2 参数集中在这里。全部是归一化演示参数，不是实测数据。
// R/A/B/C/D 的摄食参数与 v0.1 完全相同；环境响应参数和新增物种都是设计提案。
import type { Coupling, EcoConfig, Interventions, SpeciesDef, ValidationResult } from './types';

const none = { radSens: 0, radPref: 0, stormSens: 0, stormAvoid: 0, stormFlee: 0, benthic: false, trenchPref: 0, Dh: 0, adv: 0 };

export const SPECIES: SpeciesDef[] = [
  { ...none, id: 'R', name: '基础饵料', group: 'resource', initialPerColumn: 300, q: 0, H: 1, eta: 0, m: 0.004, mu: 0, p: [1 / 3, 1 / 3, 1 / 3], diet: {},
    thermal: null, radSens: 0.0002, stormSens: 0.001, Dh: 0.02, adv: 1.0, enc: null },
  { ...none, id: 'A', name: '灯笼鱼群', group: 'fish', initialPerColumn: 90, q: 0.040, H: 100, eta: 0.30, m: 0.0030, mu: 0.010, p: [0.70, 0.25, 0.05], diet: { R: 1 },
    thermal: { Topt: 5.0, Tsig: 5, Q10: 2.0 }, radSens: 0.0006, radPref: -0.6, stormSens: 0.0010, stormAvoid: 1.0, stormFlee: 0.02, Dh: 0.02, adv: 0.3, enc: { base: 0.8, noiseAttract: 0 } },
  { ...none, id: 'B', name: '底层虾群', group: 'fish', initialPerColumn: 90, q: 0.040, H: 100, eta: 0.30, m: 0.0030, mu: 0.010, p: [0.05, 0.25, 0.70], diet: { R: 1 },
    thermal: { Topt: 3.0, Tsig: 4, Q10: 2.0 }, radSens: 0.0006, radPref: -0.6, stormSens: 0.0003, stormAvoid: 0.5, stormFlee: 0.01, Dh: 0.02, adv: 0.1, enc: { base: 0.6, noiseAttract: 0 } },
  { ...none, id: 'C', name: '蝰鱼', group: 'fish', initialPerColumn: 20, q: 0.025, H: 40, eta: 0.25, m: 0.0015, mu: 0.005, p: [0.25, 0.50, 0.25], diet: { A: 1, B: 1 },
    thermal: { Topt: 4.0, Tsig: 5, Q10: 2.0 }, radSens: 0.0005, radPref: -0.8, stormSens: 0.0005, stormAvoid: 0.8, stormFlee: 0.01, Dh: 0.02, adv: 0.1, enc: { base: 0.25, noiseAttract: 0.3 } },
  { ...none, id: 'D', name: '睡鲨', group: 'fish', initialPerColumn: 5, q: 0.015, H: 15, eta: 0.20, m: 0.0008, mu: 0.005, p: [0.10, 0.30, 0.60], diet: { C: 1 },
    thermal: { Topt: 3.0, Tsig: 4, Q10: 2.0 }, radSens: 0.0004, radPref: -0.8, stormSens: 0.0003, stormAvoid: 0.8, stormFlee: 0.01, Dh: 0.03, adv: 0.05, enc: { base: 0.08, noiseAttract: 0.6 } },
  // —— 世界观变异生物（worldbuilding.md 第六节）——
  { ...none, id: 'J', name: '漂流群', tier: 'Ⅰ', group: 'mutant', initialPerColumn: 30, q: 0.050, H: 120, eta: 0.25, m: 0.0060, mu: 0.020, p: [0.50, 0.35, 0.15], diet: { R: 1 },
    thermal: { Topt: 6.0, Tsig: 6, Q10: 2.2 }, radSens: 0, radPref: 0.8, stormSens: 0.0020, Dh: 0.01, adv: 0.9, enc: { base: 0.5, noiseAttract: 0 } },
  { ...none, id: 'K', name: '铁颚蟹', tier: 'Ⅱ', group: 'mutant', initialPerColumn: 12, q: 0.030, H: 60, eta: 0.25, m: 0.0020, mu: 0.020, p: [1 / 3, 1 / 3, 1 / 3], diet: { R: 0.6, B: 0.4 },
    thermal: { Topt: 3.0, Tsig: 4, Q10: 2.0 }, radSens: 0.0002, radPref: 0.3, stormSens: 0.0005, benthic: true, Dh: 0.003, enc: { base: 0.15, noiseAttract: 0.2 } },
  { ...none, id: 'E', name: '深渊眼', tier: 'Ⅲ', group: 'mutant', initialPerColumn: 1.5, q: 0.012, H: 12, eta: 0.20, m: 0.0006, mu: 0.005, p: [0.05, 0.25, 0.70], diet: { C: 1, D: 0.5, K: 0.5 },
    thermal: { Topt: 2.5, Tsig: 3, Q10: 2.0 }, radSens: 0.0003, stormSens: 0.0002, stormAvoid: 1.0, trenchPref: 0.8, Dh: 0.01, enc: { base: 0.02, noiseAttract: 1.0 } },
  { ...none, id: 'W', name: '哀歌鲸', tier: 'Ⅳ', group: 'fish', initialPerColumn: 2, q: 0.010, H: 40, eta: 0.20, m: 0.0004, mu: 0.010, p: [0.60, 0.30, 0.10], diet: { A: 1, J: 0.8 },
    thermal: { Topt: 4.5, Tsig: 5, Q10: 2.0 }, radSens: 0.0008, radPref: -1.5, stormSens: 0.0003, stormAvoid: 2.0, stormFlee: 0.05, Dh: 0.05, adv: 0.2, enc: { base: 0.03, noiseAttract: 0 } },
];

export const ALL_ON: Coupling = { temperature: true, radiation: true, storms: true, bathymetry: true, horizontal: true };
export const ALL_OFF: Coupling = { temperature: false, radiation: false, storms: false, bathymetry: false, horizontal: false };

export const DEFAULT_CONFIG: EcoConfig = {
  version: '0.2',
  species: SPECIES,
  resource: { J: [1.0, 0.8, 0.6], initial: [100, 100, 100] },
  dt: 0.2,
  Fmax: 0.02,
  Tref: 3.5,
  radBackground: 0.02,
  radLh: 2.5, radLv: 350,
  storm: { layerFactor: [0.35, 0.12, 0.04], pulseGain: 1.5, pulseTau: [3, 8, 15], coolL1: 1.2 },
  couple: { ...ALL_ON },
};

export const NO_INTERVENTION: Interventions = {
  fishing: { enabled: false, target: 'D', layer: 'all', u: 0, region: null },
  supplyMultiplier: 1,
  tempAnomaly: 0,
};

export const cloneConfig = (c: EcoConfig): EcoConfig => JSON.parse(JSON.stringify(c));

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validateConfig(c: EcoConfig): ValidationResult {
  const problems: string[] = [];
  const need = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); };
  need(c.species.length >= 1 && c.species[0].group === 'resource' && c.species[0].id === 'R', 'species[0] 必须是基础饵料 R');
  const ids = new Set<string>();
  for (const s of c.species) {
    need(!ids.has(s.id), `物种 id 重复：${s.id}`); ids.add(s.id);
    for (const k of ['initialPerColumn', 'q', 'H', 'eta', 'm', 'mu', 'radSens', 'stormSens', 'stormAvoid', 'stormFlee', 'trenchPref', 'Dh', 'adv'] as const)
      need(fin(s[k]) && s[k] >= 0, `${s.id}.${k} 必须是非负有限值`);
    need(fin(s.radPref), `${s.id}.radPref 必须是有限值`);
    need(s.H > 0, `${s.id}.H 必须 > 0`);
    need(s.eta <= 1, `${s.id}.eta 必须 ≤ 1`);
    need(s.adv <= 1 && s.trenchPref <= 1, `${s.id}.adv / trenchPref 必须 ≤ 1`);
    need(s.p.length === 3 && s.p.every(v => fin(v) && v >= 0) && Math.abs(s.p[0] + s.p[1] + s.p[2] - 1) < 1e-9, `${s.id}.p 必须是和为 1 的三个非负数`);
    if (s.thermal) need(fin(s.thermal.Topt) && fin(s.thermal.Tsig) && s.thermal.Tsig > 0 && fin(s.thermal.Q10) && s.thermal.Q10 > 0, `${s.id}.thermal 参数非法`);
    if (s.group === 'resource') need(Object.keys(s.diet).length === 0, 'R 不能摄食');
  }
  for (const s of c.species) for (const [prey, w] of Object.entries(s.diet)) {
    need(ids.has(prey), `${s.id} 的食物 ${prey} 不存在`);
    need(fin(w) && w >= 0, `${s.id}.diet.${prey} 必须是非负有限值`);
  }
  need(c.resource.J.every(v => fin(v) && v >= 0) && c.resource.initial.every(v => fin(v) && v >= 0), 'resource.J / initial 必须非负');
  need(fin(c.dt) && c.dt > 0 && c.dt <= 5, 'dt 必须在 (0,5]');
  need(fin(c.Fmax) && c.Fmax >= 0, 'Fmax 必须 ≥ 0');
  need(fin(c.radBackground) && c.radBackground >= 0 && c.radLh > 0 && c.radLv > 0, '辐射参数非法');
  need(c.storm.layerFactor.every(v => fin(v) && v >= 0) && c.storm.pulseTau.every(v => fin(v) && v > 0) && fin(c.storm.pulseGain) && c.storm.pulseGain >= 0, '台风参数非法');
  return { ok: problems.length === 0, problems };
}

export function validateInterventions(iv: Interventions, c: EcoConfig): ValidationResult {
  const problems: string[] = [];
  const f = iv.fishing;
  const sp = c.species.find(s => s.id === f.target);
  if (!sp || sp.group === 'resource') problems.push('捕捞目标必须是鱼类或变异生物');
  if (!(f.layer === 'all' || f.layer === 0 || f.layer === 1 || f.layer === 2)) problems.push('捕捞层必须是 0/1/2/all');
  if (!fin(f.u) || f.u < 0 || f.u > 1) problems.push('捕捞强度 u 必须在 [0,1]');
  if (f.region && !(fin(f.region.cx) && fin(f.region.cy) && fin(f.region.r) && f.region.r > 0)) problems.push('捕捞区域非法');
  if (!fin(iv.supplyMultiplier) || iv.supplyMultiplier < 0 || iv.supplyMultiplier > 2) problems.push('补给倍率必须在 [0,2]');
  if (!fin(iv.tempAnomaly) || iv.tempAnomaly < -4 || iv.tempAnomaly > 4) problems.push('温度距平必须在 [−4,+4] °C');
  return { ok: problems.length === 0, problems };
}

export function assertValid(r: ValidationResult, what: string) {
  if (!r.ok) throw new Error(`${what} 无效：\n- ${r.problems.join('\n- ')}`);
}

/** 捕食偏好矩阵 a[pred][prey]，按 species 顺序 */
export function dietMatrix(c: EcoConfig): Float64Array {
  const P = c.species.length, a = new Float64Array(P * P);
  c.species.forEach((s, i) => { for (const [prey, w] of Object.entries(s.diet)) a[i * P + c.species.findIndex(x => x.id === prey)] = w; });
  return a;
}
