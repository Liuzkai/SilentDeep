// 生物量时间曲线（Canvas 2D）。实线为实验组，虚线为对照组。
import { POOLS } from '../sim';
import { SPECIES_CSS } from '../view/common';
import type { HistoryPoint, LogEntry } from './driver';

/** origin：横轴显示为相对实验起点（预热之后）的模拟日 */
export interface ChartOpts { showControl: boolean; log: boolean; visible: Record<string, boolean>; origin: number }

export function drawChart(cv: HTMLCanvasElement, exp: HistoryPoint[], ctrl: HistoryPoint[], events: LogEntry[], o: ChartOpts) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const L = 44, R = 10, T = 10, B = 22, pw = W - L - R, ph = H - T - B;
  if (exp.length < 2) return;
  const t0 = exp[0].t, t1 = exp[exp.length - 1].t;
  const pools = POOLS.map((_, i) => i).filter(i => o.visible[POOLS[i]] !== false);
  let ymax = 0, ymin = Infinity;
  for (const h of [exp, o.showControl ? ctrl : []]) for (const p of h) for (const i of pools) { ymax = Math.max(ymax, p.totals[i]); if (p.totals[i] > 0) ymin = Math.min(ymin, p.totals[i]); }
  ymax = ymax * 1.05 || 1;
  const lo = o.log ? Math.max(1e-3, Math.pow(10, Math.floor(Math.log10(Math.max(ymin, 1e-3))))) : 0;
  const Y = (v: number) => o.log ? T + ph * (1 - (Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(ymax) - Math.log10(lo))) : T + ph * (1 - v / ymax);
  const X = (t: number) => L + pw * (t - t0) / Math.max(1e-9, t1 - t0);

  // 网格与刻度
  g.strokeStyle = '#1d2b3a'; g.fillStyle = '#7f95a8'; g.font = '11px ui-monospace, Menlo, monospace'; g.lineWidth = 1;
  const yt = o.log ? logTicks(lo, ymax) : niceTicks(0, ymax, 5);
  for (const v of yt) { const y = Y(v); g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.fillText(fmt(v), 4, y + 4); }
  for (const t of niceTicks(t0 - o.origin, t1 - o.origin, 6)) { const x = X(t + o.origin); g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke(); g.fillText(t.toFixed(0), x - 10, H - 6); }
  g.fillText('BU', 4, T + 2);
  g.fillText('模拟日', W - R - 40, H - 6);

  // 干预时刻
  g.setLineDash([2, 3]); g.strokeStyle = '#8a6d3b';
  for (const e of events.slice(1)) { if (e.t < t0 || e.t > t1) continue; const x = X(e.t); g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke(); }
  g.setLineDash([]);

  const line = (h: HistoryPoint[], i: number, dash: number[]) => {
    g.strokeStyle = SPECIES_CSS[POOLS[i]]; g.setLineDash(dash); g.lineWidth = dash.length ? 1 : 1.6; g.globalAlpha = dash.length ? .7 : 1;
    g.beginPath();
    const step = Math.max(1, Math.floor(h.length / (pw * 1.5)));
    for (let n = 0; n < h.length; n += step) { const p = h[n]; n === 0 ? g.moveTo(X(p.t), Y(p.totals[i])) : g.lineTo(X(p.t), Y(p.totals[i])); }
    const last = h[h.length - 1]; g.lineTo(X(last.t), Y(last.totals[i]));
    g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
  };
  if (o.showControl) for (const i of pools) line(ctrl, i, [4, 3]);
  for (const i of pools) line(exp, i, []);
}

function niceTicks(a: number, b: number, n: number) {
  const span = b - a || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => span / s <= n) || mag * 10;
  const out = []; for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(v);
  return out;
}
function logTicks(lo: number, hi: number) { const out = []; for (let v = lo; v <= hi * 1.001; v *= 10) out.push(v); return out; }
export const fmt = (v: number) => v === 0 ? '0' : Math.abs(v) < 0.01 ? v.toExponential(1) : Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
