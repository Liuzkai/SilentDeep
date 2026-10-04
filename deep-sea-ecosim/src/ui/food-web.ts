// 食物网视图：箭头从食物指向消费者，粗细来自本步实际摄食通量 C/h（BU/模拟日，全层合计）
import { POOLS, webFlux, type StepLedger } from '../sim';
import { SPECIES_CSS } from '../view/common';

// 节点位置（比例坐标）：营养级自下而上
const POS: Record<string, [number, number]> = { R: [.5, .88], A: [.25, .58], B: [.75, .58], C: [.5, .33], D: [.5, .1] };
const NAME: Record<string, string> = { R: '基础饵料', A: '上层小型摄食鱼', B: '下层小型摄食鱼', C: '中型捕食鱼', D: '大型捕食鱼' };

export function drawFoodWeb(svg: SVGSVGElement, a: number[][], ledger: StepLedger | null, totals: number[]) {
  const W = svg.clientWidth || 300, H = svg.clientHeight || 220;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const flux = ledger ? webFlux(ledger) : a.map(r => r.map(() => 0));
  let maxF = 0; for (const r of flux) for (const v of r) maxF = Math.max(maxF, v);
  const P = (p: string) => [POS[p][0] * W, POS[p][1] * H];
  let s = `<defs>${POOLS.map(p => `<marker id="ah-${p}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${SPECIES_CSS[p]}"/></marker>`).join('')}</defs>`;
  for (let i = 1; i < 5; i++) for (let j = 0; j < 5; j++) {
    if (a[i][j] <= 0) continue;
    const [x1, y1] = P(POOLS[j]), [x2, y2] = P(POOLS[i]);
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy), r = 22;
    const sx = x1 + dx / d * r, sy = y1 + dy / d * r, ex = x2 - dx / d * (r + 4), ey = y2 - dy / d * (r + 4);
    const f = flux[i][j];
    // 线宽 ∝ √通量，便于同时看清大小通量；0 通量时画成虚线
    const w = maxF > 0 ? 0.6 + 7 * Math.sqrt(f / maxF) : 0.6;
    s += `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${SPECIES_CSS[POOLS[j]]}" stroke-opacity=".8" stroke-width="${w.toFixed(2)}" ${f > 0 ? '' : 'stroke-dasharray="3 3"'} marker-end="url(#ah-${POOLS[j]})"/>`;
    s += `<text x="${(sx + ex) / 2 + 6}" y="${(sy + ey) / 2}" class="fw-flux">${f.toPrecision(3)}</text>`;
  }
  for (const p of POOLS) {
    const [x, y] = P(p), i = POOLS.indexOf(p);
    s += `<g><circle cx="${x}" cy="${y}" r="20" fill="#0c1826" stroke="${SPECIES_CSS[p]}" stroke-width="2"/>
      <text x="${x}" y="${y + 4}" text-anchor="middle" class="fw-id" fill="${SPECIES_CSS[p]}">${p}</text>
      <text x="${x + 26}" y="${y - 4}" class="fw-name">${NAME[p]}</text>
      <text x="${x + 26}" y="${y + 10}" class="fw-bu">${totals[i].toPrecision(4)} BU</text></g>`;
  }
  svg.innerHTML = s;
}
