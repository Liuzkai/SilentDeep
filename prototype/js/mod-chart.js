/* CHART 战略海图（参考 03：黑底坐标网格、彩色圆圈标势力、到处是小字标注、底部图例）
 * 没去过的区域是空白，声呐探测过的格子才填上；惯导误差显示为可能位置区域
 * APPROACH 进港程序图：水道、安全深度、转向点 */

(() => {
const S = SD.state;
const GRID = 24;           // 每格 km 数用 CELL 表示
const CELL = 2;
const explored = new Set();
const key = (i, j) => i + ',' + j;

// 已知地标与势力范围（示意数据）
const MARKS = [
  { x: 14, y: 10, r: 9, name: '舰队协约 巡逻区', cls: '' },
  { x: -18, y: -8, r: 7, name: '锈帮 猎场', cls: 'hot' },
  { x: -6, y: 18, r: 5, name: '哀歌鲸 洄游带', cls: '' },
  { x: 20, y: -16, r: 6, name: '??? 巨兽领地', cls: 'hot' },
];
const POIS = [
  { x: 8, y: -6, name: '渡鸦环礁', type: 'port' },
  { x: -12, y: 12, name: '7号钻井平台', type: 'port' },
  { x: 2, y: 24, name: '灯塔信号?', type: 'signal' },
  { x: -3, y: -3, name: '海山 KILO', type: 'landmark' },
];
const CURRENTS = [[-20, 0, 20, 6], [-10, -20, 6, -2]];

// 声呐探测：本艇周围一定半径内的格子标记为已探索
function reveal() {
  const r = S.breakers.SONAR.on ? 3 : 1;
  const ci = Math.round(S.own.x / CELL), cj = Math.round(S.own.y / CELL);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (i * i + j * j <= r * r) explored.add(key(ci + i, cj + j));
}
// 开局给一点已探索区域
for (let i = -4; i <= 2; i++) for (let j = -6; j <= 1; j++) explored.add(key(i, j));

SD.register({
  code: 'CHART', cn: '战略海图', ph: 'amber', fkey: 'F9',
  create(root) {
    root.innerHTML = `
      <div class="mod-title"><span>CHART // 战略海图 · 惯导</span><span class="dim">[F] 地标校准  拖动平移</span></div>
      <div class="mod-body side">
        <div style="position:relative"><canvas class="fill"></canvas></div>
        <div class="panel ch-panel"></div>
      </div>`;
    const cv = root.querySelector('canvas'), panel = root.querySelector('.ch-panel');
    let ox = 0, oy = 0, drag = null, hover = null;

    cv.addEventListener('mousedown', e => drag = { x: e.clientX, y: e.clientY, ox, oy });
    window.addEventListener('mouseup', () => drag = null);
    cv.addEventListener('mousemove', e => {
      const r = cv.getBoundingClientRect();
      if (drag) { const k = r.width / (GRID * CELL * 2); ox = drag.ox - (e.clientX - drag.x) / k; oy = drag.oy + (e.clientY - drag.y) / k; }
      hover = [e.clientX - r.left, e.clientY - r.top];
    });
    cv.addEventListener('mouseleave', () => hover = null);

    panel.addEventListener('pointerdown', e => {
      const a = e.target.dataset.act; if (!a) return;
      SD.audio.key();
      if (a === 'fix') SD.navFix();
      if (a === 'center') { ox = oy = 0; }
      if (a === 'app') SD.openModule('APPROACH');
    });

    function drawPanel() {
      const near = POIS.map(p => ({ ...p, d: SD.dist(S.own.x, S.own.y, p.x, p.y) })).sort((a, b) => a.d - b.d)[0];
      SD.html(panel, `
        <div class="kv">
          <span>POS</span><span>${S.own.x.toFixed(1)} / ${S.own.y.toFixed(1)}</span>
          <span>NAV ERR</span><span class="${S.navErr > 3 ? 'hot' : ''}">±${S.navErr.toFixed(2)} KM</span>
          <span>EXPLORED</span><span>${explored.size} 格</span>
        </div>
        <div class="sep"></div>
        <div class="cn">最近地标：${near.name}<br>距离 ~${near.d.toFixed(1)} KM</div>
        <div><span class="btn" data-act="fix">FIX 校准</span><span class="btn" data-act="center">回中</span></div>
        <div><span class="btn" data-act="app">APPROACH ▶</span></div>
        <div class="sep"></div>
        <div class="cn" style="line-height:1.4">
          <div>◯ 势力范围 · <span class="hot">◯</span> 危险</div>
          <div>■ 聚落港口 · ◇ 地标</div>
          <div>≈ 洋流 · ░ 未探索</div>
          <div>⬭ 惯导可能位置</div>
        </div>`);
    }

    function draw() {
      const { ctx, w, h } = SD.fitCanvas(cv);
      const col = SD.phColor(root), rgb = SD.phRGB(root);
      const k = Math.min(w, h) / (GRID * CELL * 1.6), cx = w / 2, cy = h / 2;
      const P = (x, y) => [cx + (x - ox) * k, cy - (y - oy) * k];
      ctx.fillStyle = '#050805'; ctx.fillRect(0, 0, w, h);
      ctx.font = '12px VT323, monospace';
      // 未探索区域用字符噪点填充，已探索的只画网格
      const span = Math.ceil(Math.max(w, h) / k / CELL / 2) + 1;
      const ci0 = Math.round(ox / CELL), cj0 = Math.round(oy / CELL);
      for (let i = ci0 - span; i <= ci0 + span; i++) for (let j = cj0 - span; j <= cj0 + span; j++) {
        const [x, y] = P(i * CELL - CELL / 2, j * CELL + CELL / 2);
        if (!explored.has(key(i, j))) {
          ctx.fillStyle = `rgba(${rgb},.07)`; ctx.fillRect(x, y, CELL * k, CELL * k);
          if ((i * 7 + j * 13) % 5 === 0) { ctx.fillStyle = `rgba(${rgb},.12)`; ctx.fillText('░', x + 2, y + 10); }
        }
      }
      // 大网格线 + 坐标
      ctx.strokeStyle = `rgba(${rgb},.18)`; ctx.fillStyle = `rgba(${rgb},.5)`;
      for (let g = -60; g <= 60; g += 10) {
        const [x] = P(g, 0), [, y] = P(0, g);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        ctx.fillText(g, x + 2, 10); ctx.fillText(g, 2, y - 2);
      }
      // 洋流
      ctx.save(); ctx.strokeStyle = `rgba(${rgb},.45)`; ctx.setLineDash([8, 6]);
      for (const [x0, y0, x1, y1] of CURRENTS) { const a = P(x0, y0), b = P(x1, y1); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); ctx.fillText('≈≈ 洋流', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 4); }
      ctx.restore();
      // 势力圈
      for (const m of MARKS) {
        const [x, y] = P(m.x, m.y);
        ctx.strokeStyle = m.cls ? 'rgba(255,74,58,.7)' : `rgba(${rgb},.6)`; ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath(); ctx.arc(x, y, m.r * k, 0, Math.PI * 2); ctx.stroke();
        ctx.font = '12px "Fusion Pixel 12px Monospaced SC", monospace';
        ctx.fillText(m.name, x - m.r * k * .6, y - m.r * k - 4);
      }
      // 地标
      for (const p of POIS) {
        const [x, y] = P(p.x, p.y); ctx.fillStyle = col; ctx.strokeStyle = col;
        if (p.type === 'port') ctx.fillRect(x - 4, y - 4, 8, 8);
        else if (p.type === 'signal') { ctx.beginPath(); ctx.arc(x, y, 3 + (Date.now() / 200 % 8), 0, Math.PI * 2); ctx.stroke(); }
        else { ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.stroke(); }
        ctx.fillText(p.name, x + 7, y + 4);
      }
      // 航迹 + 本艇 + 惯导误差区
      ctx.fillStyle = `rgba(${rgb},.6)`;
      for (const p of S.track) { const [x, y] = P(p.x, p.y); ctx.fillRect(x, y, 1.5, 1.5); }
      const [sx, sy] = P(S.own.x, S.own.y);
      ctx.save(); ctx.strokeStyle = S.navErr > 3 ? 'rgba(255,74,58,.7)' : `rgba(${rgb},.7)`; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.ellipse(sx, sy, S.navErr * k * 1.3, S.navErr * k, SD.rad(S.hdg), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(${rgb},.08)`; ctx.fill(); ctx.restore();
      ctx.fillStyle = col; ctx.fillRect(sx - 2, sy - 2, 5, 5); ctx.fillText('SS-鲸落', sx + 6, sy - 6);
      // 鼠标读数
      if (hover) {
        const mx = (hover[0] - cx) / k + ox, my = -(hover[1] - cy) / k + oy;
        ctx.fillStyle = col; ctx.fillText(`${mx.toFixed(1)}, ${my.toFixed(1)}${explored.has(key(Math.round(mx / CELL), Math.round(my / CELL))) ? '' : '  未探索'}`, hover[0] + 10, hover[1] - 8);
      }
    }
    let t = 0; drawPanel();
    return {
      tick(dt) { draw(); t += dt; if (t > .5) { t = 0; drawPanel(); } },
      key(e) { if (e.key === 'f') { SD.navFix(); return true; } },
    };
  },
});

// 经过已知地标时收缩惯导误差
SD.navFix = () => {
  const near = POIS.map(p => SD.dist(S.own.x, S.own.y, p.x, p.y)).sort((a, b) => a - b)[0];
  if (near < 6) { S.navErr = .3; SD.say('领航', '地标回波确认，惯导已校准'); SD.audio.beep(1200, .1); }
  else SD.say('领航', `附近没有可用地标（最近 ${near.toFixed(1)} 公里）。误差继续累积`);
};
SD.chartTick = reveal;

// ---------- APPROACH 进港程序图 ----------
SD.register({
  code: 'APPROACH', cn: '进港程序图', ph: 'amber', fkey: '',
  create(root) {
    root.innerHTML = `<div class="mod-title"><span>APPROACH // 渡鸦环礁 · 北水道</span><span class="dim">图号 RVN-02 · 可交易</span></div>
      <div class="mod-body art" style="overflow:auto"></div>`;
    const body = root.querySelector('.mod-body');
    body.innerHTML =
`             <span class="cn">入口</span> ▼ IAF  深度≥80m
    ~~~~~~~~~~~~│~~~~~~~~~~~~~~~~~~~~~~~
    ▓▓▓▓▓▓▓▓    │    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
    ▓▓▓▓▓▓▓▓    │ 120m ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
    ▓▓▓▓▓▓▓▓▓   ●WP1  HDG 172 ▓▓▓▓▓▓
    ▓▓▓▓▓▓▓▓▓▓   ╲          ▓▓▓▓▓▓▓
    ▓▓▓▓▓▓▓▓▓▓▓   ╲  <span class="hot">×沉船</span>  ▓▓▓▓▓▓▓
    ▓▓▓▓▓▓▓▓▓▓▓▓   ●WP2 HDG 214 ▓▓▓▓
    ▓▓▓▓▓▓▓▓▓▓▓▓▓   │  <span class="hot">!! 40m 浅滩</span> ▓▓
    ▓▓▓▓▓▓▓▓▓▓▓▓▓   │  ▓▓▓▓▓▓▓▓▓▓▓▓▓
    ▓▓▓▓▓▓▓▓▓▓▓▓▓   ●WP3 上浮至 30m
    ▓▓▓▓▓▓▓▓▓▓▓▓▓  ┌┴┐ ▓▓▓▓▓▓▓▓▓▓▓▓▓
    ▓▓▓▓▓▓▓▓▓▓▓▓▓  │■│ <span class="cn">泊位 · 敲击 3 短 2 长</span>
    ▓▓▓▓▓▓▓▓▓▓▓▓▓  └─┘ ▓▓▓▓▓▓▓▓▓▓▓▓▓

 <span class="cn">WP  航向  深度   备注</span>
 IAF  172  ≥80m  <span class="cn">保持静默</span>
 WP1  214  ≥60m  <span class="cn">沉船以东通过</span>
 WP2  180  45m   <span class="cn">低速 3kn 以下</span>
 WP3  ---  30m   <span class="cn">发识别敲击，等回应</span>`;
    return {};
  },
});
})();
