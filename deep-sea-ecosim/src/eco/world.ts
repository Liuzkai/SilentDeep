// 海域生成：海底深度、洋流、基础温度、辐射源、自然台风、地标。
// 全部由种子决定（独立随机数流），同一种子得到同一片海。
import type { RadSource, Storm, World } from './types';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface WorldOptions {
  seed?: number;
  nx?: number;
  ny?: number;
  /** 格子边长 km */
  dx?: number;
  /** 自然台风的生成时长，模拟日 */
  stormHorizon?: number;
}

const sq = (v: number) => v * v;
const g2 = (x: number, y: number, cx: number, cy: number, sx: number, sy = sx) => Math.exp(-(sq((x - cx) / sx) + sq((y - cy) / sy)));

/**
 * 默认海域：西侧是大陆坡（浅），中部深水平原，东南有一条海沟，散布几座海山。
 * 深度范围约 450–2600 m；浅于 600 m 的格子在模型三层之外，没有生物量。
 */
export function createWorld(o: WorldOptions = {}): World {
  const seed = o.seed ?? 37114, nx = o.nx ?? 24, ny = o.ny ?? 16, dx = o.dx ?? 10;
  const rng = mulberry32(seed);
  const N = nx * ny;
  const floor = new Float64Array(N), u = new Float64Array(N), v = new Float64Array(N), Tbase = new Float64Array(N * 3);
  // 流函数：一个顺时针大环流（北部向东、南部向西）加一个小涡，边界为 0
  const psi = new Float64Array((nx + 1) * (ny + 1));
  const PSI0 = 0.35;   // 1/模拟日 量级：最大面输运约为格子库存的 0.1/日
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const X = i / nx, Y = j / ny;
    psi[j * (nx + 1) + i] = PSI0 * Math.sin(Math.PI * X) * Math.sin(Math.PI * Y) * (1 + 0.35 * Math.sin(2 * Math.PI * X) * Math.sin(Math.PI * Y));
  }
  const P = (i: number, j: number) => psi[j * (nx + 1) + i];

  // 海山和海沟的位置随种子变化，但整体格局固定，便于和游戏海图对应
  const mounts = Array.from({ length: 4 }, () => ({ x: 4 + rng() * (nx - 8), y: 2 + rng() * (ny - 4), s: 1.2 + rng() * 1.6, h: 700 + rng() * 700 }));
  const trench = { x: nx * 0.72 + (rng() - .5) * 2, y: ny * 0.7 + (rng() - .5) * 2, ang: 0.5 + rng() * .4 };
  const vent = { x: trench.x - 1.5 + rng() * 3, y: trench.y - 1 + rng() * 2 };

  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const c = y * nx + x;
    // 大陆坡：西边浅
    let d = 1750 - 1400 * Math.exp(-x / 3.2);
    // 海山
    for (const m of mounts) d -= m.h * g2(x, y, m.x, m.y, m.s);
    // 海沟：沿一条斜线的狭长深槽
    const along = (x - trench.x) * Math.cos(trench.ang) + (y - trench.y) * Math.sin(trench.ang);
    const across = -(x - trench.x) * Math.sin(trench.ang) + (y - trench.y) * Math.cos(trench.ang);
    d += 950 * Math.exp(-sq(across / 1.3)) * Math.exp(-sq(along / 6));
    // 小尺度起伏
    d += (rng() - .5) * 80;
    floor[c] = Math.max(200, d);

    // 格心流速（仅供绘图）：由四个角的流函数差分得到，换算成 km/模拟日
    u[c] = ((P(x, y + 1) + P(x + 1, y + 1)) - (P(x, y) + P(x + 1, y))) / 2 * dx;
    v[c] = -((P(x + 1, y) + P(x + 1, y + 1)) - (P(x, y) + P(x, y + 1))) / 2 * dx;

    // 基础温度：层越深越冷；北侧（y 小）暖流略暖；热液喷口附近 L3 升温
    const warm = 0.8 * Math.exp(-sq(((y + .5) / ny - 0.2) / 0.18));
    const hv = 2.5 * g2(x, y, vent.x, vent.y, 1.1);
    Tbase[c * 3] = 5.5 + warm;
    Tbase[c * 3 + 1] = 4.2 + warm * .5 + hv * .15;
    Tbase[c * 3 + 2] = 3.0 + hv;
  }

  const radSources: RadSource[] = [
    // 战时沉没的核潜艇残骸：衰减很慢
    { id: 'wreck', name: '沉没核潜艇 K-19X', x: Math.round(nx * 0.35), y: Math.round(ny * 0.3), depth: 1300, S0: 1.2, t0: -1e9, halfLife: Infinity },
    // 海沟里的战前废料倾倒点
    { id: 'dump', name: '战前核废料倾倒区', x: Math.round(trench.x + 1), y: Math.round(trench.y), depth: 1500, S0: 0.8, t0: -1e9, halfLife: Infinity },
  ];

  const storms = naturalStorms(rng, nx, ny, o.stormHorizon ?? 20000);

  const landmarks = [
    { name: '渡鸦环礁', x: 2, y: Math.round(ny * 0.3) },
    { name: '7号钻井平台', x: 3, y: Math.round(ny * 0.75) },
    { name: '海沟', x: Math.round(trench.x), y: Math.round(trench.y) },
    { name: '热液喷口', x: Math.round(vent.x), y: Math.round(vent.y) },
    ...mounts.map((m, i) => ({ name: `海山 ${'KLMN'[i]}`, x: Math.round(m.x), y: Math.round(m.y) })),
  ];

  return { seed, nx, ny, dx, floor, psi, u, v, Tbase, radSources, storms, landmarks };
}

/** 自然台风季：平均每 ~150 日一次，自东向西穿过海域。对照组和实验组共享同一份 */
function naturalStorms(rng: () => number, nx: number, ny: number, horizon: number): Storm[] {
  const out: Storm[] = [];
  let t = 60 + rng() * 120, n = 0;
  while (t < horizon) {
    const y0 = 2 + rng() * (ny - 4), dur = 4 + rng() * 5;
    out.push({
      id: `N${++n}`, name: `台风 ${n}`, t0: t, duration: dur,
      x0: nx + 2, y0, vx: -(nx + 6) / dur, vy: (rng() - .5) * 1.5,
      radius: 2.5 + rng() * 2.5, intensity: 0.6 + rng() * 0.8,
    });
    t += 90 + rng() * 120;
  }
  return out;
}

/** 单格、平坦、全层完整的海域：用于和 v0.1 做逐位回归 */
export function singleCellWorld(): World {
  return {
    seed: 0, nx: 1, ny: 1, dx: 10,
    floor: new Float64Array([1500]), psi: new Float64Array(4), u: new Float64Array(1), v: new Float64Array(1),
    Tbase: new Float64Array([3.5, 3.5, 3.5]), radSources: [], storms: [], landmarks: [],
  };
}
