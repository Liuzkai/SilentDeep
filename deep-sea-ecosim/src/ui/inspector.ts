// 选中物种的收支明细，以及分层生物量与捕获量表
import { FISH, POOLS, poolBreakdown, poolTotal, type EcoState, type StepLedger } from '../sim';
import { SPECIES_CSS } from '../view/common';
import { fmt } from './charts';

const rate = (v: number, dt: number) => v / dt;
const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v));

/** 收支明细：全部换算成 BU/模拟日（本步量 / dt），并给出每层分解 */
export function renderInspector(el: HTMLElement, pool: string, ledger: StepLedger | null) {
  const i = POOLS.indexOf(pool as never);
  if (!ledger) { el.innerHTML = '<p class="muted">还没有推进，按"单步"或"继续"。</p>'; return; }
  const b = poolBreakdown(ledger, i), dt = ledger.dt;
  const rows: [string, number, string][] = i === 0
    ? [['外部补给 J', b.supply, 'in'], ['被摄食损失', -b.predLoss, 'out'], ['背景损失', -b.background, 'out']]
    : [['摄食收益 η·ΣC', b.gain, 'in'], ['被捕食损失', -b.predLoss, 'out'], ['背景损失', -b.background, 'out'], ['捕捞损失', -b.catch, 'out'], ['层间交换（合计）', b.migration, 'mig']];
  const per = (k: number) => b.perLayer[k];
  const cols = i === 0
    ? ['supply', 'predLoss', 'background'] as const
    : ['gain', 'predLoss', 'background', 'catch', 'migration'] as const;
  const neg = new Set(['predLoss', 'background', 'catch']);
  el.innerHTML = `
    <table class="ledger">
      <thead><tr><th style="color:${SPECIES_CSS[pool]}">${pool} 全层合计</th><th>BU/模拟日</th></tr></thead>
      <tbody>${rows.map(([n, v, c]) => `<tr class="${c}"><td>${n}</td><td>${sign(rate(v, dt))}</td></tr>`).join('')}
      <tr class="net"><td>最终净变化</td><td>${sign(rate(b.net, dt))}</td></tr></tbody>
    </table>
    <table class="ledger small">
      <thead><tr><th>层</th>${cols.map(c => `<th>${({ gain: '收益', supply: '补给', predLoss: '被食', background: '背景', catch: '捕捞', migration: '交换' } as Record<string, string>)[c]}</th>`).join('')}<th>净</th></tr></thead>
      <tbody>${[0, 1, 2].map(k => `<tr><td>L${k + 1}</td>${cols.map(c => `<td>${sign(rate((neg.has(c) ? -1 : 1) * per(k)[c], dt))}</td>`).join('')}<td>${sign(rate(per(k).net, dt))}</td></tr>`).join('')}</tbody>
    </table>
    <p class="muted">单位 BU/模拟日 = 本步量 ÷ dt（${dt} 日）。层间交换各层之和为 0，只重新分配。</p>`;
}

/** 分层生物量 + 本期 / 累计捕获 */
export function renderLayers(el: HTMLElement, s: EcoState, ledger: StepLedger | null, lowFlags: boolean[][] | null) {
  const dt = ledger?.dt ?? 1;
  const head = `<tr><th></th><th>L1</th><th>L2</th><th>L3</th><th>合计</th><th>本期捕获<br><span class="muted">BU/日</span></th><th>累计捕获<br><span class="muted">BU</span></th></tr>`;
  const rows = POOLS.map((p, i) => {
    const tot = poolTotal(s.X, i);
    const cells = s.X[i].map((v, k) => {
      const low = i > 0 && lowFlags?.[i - 1]?.[k];
      return `<td class="${v === 0 ? 'zero' : ''}">${fmt(v)}${low ? ' <span class="tag">低</span>' : ''}</td>`;
    }).join('');
    const cr = i === 0 ? '—' : fmt(ledger ? (ledger.catch[i][0] + ledger.catch[i][1] + ledger.catch[i][2]) / dt : 0);
    const cc = i === 0 ? '—' : fmt(poolTotal(s.cumCatch, i));
    return `<tr><th style="color:${SPECIES_CSS[p]}">${p}</th>${cells}<td>${fmt(tot)}${i > 0 && tot === 0 ? ' <span class="tag zero">0</span>' : ''}</td><td>${cr}</td><td>${cc}</td></tr>`;
  }).join('');
  el.innerHTML = `<table class="layers">${head}${rows}</table>`;
}

export { FISH };
