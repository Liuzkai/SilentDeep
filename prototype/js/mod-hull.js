/* HULL 舰体侧面分布图：舱段、装备系统、进水与损管
 * 舱段里的系统状态直接读其他界面的数据（断路器、发射管、反应堆），这里只是换个视角看同一艘艇
 * 进水是演示用的：LEAK 命令或界面按钮触发，关水密门能止住蔓延，派损管能慢慢排水 */

(() => {
const S = SD.state;
const CRUSH = 560, SAFE = 450;

// 舱段：x0/x1 是沿艇长方向的比例（0 = 艇艏，1 = 艇艉）
S.hull = [
  { id: 1, code: 'BOW', name: '艏部声呐舱', x0: .00, x1: .10, flood: 0, sealed: false },
  { id: 2, code: 'TORP', name: '鱼雷舱', x0: .10, x1: .24, flood: 0, sealed: false },
  { id: 3, code: 'CTRL', name: '指挥舱', x0: .24, x1: .40, flood: 0, sealed: false },
  { id: 4, code: 'CREW', name: '生活舱 · 藻类农场', x0: .40, x1: .54, flood: 0, sealed: false },
  { id: 5, code: 'RX', name: '反应堆舱', x0: .54, x1: .70, flood: 0, sealed: false },
  { id: 6, code: 'ENG', name: '轮机舱', x0: .70, x1: .86, flood: 0, sealed: false },
  { id: 7, code: 'AFT', name: '艉部 · 推进', x0: .86, x1: 1.0, flood: 0, sealed: false },
];
S.dc = null;           // 损管队当前所在舱段 id
S.hullInt = 100;       // 艇壳完整度 %

// 每个舱段里有哪些系统，状态从全局数据里读
const st = (ok, txt) => ({ ok, txt });
const brk = k => S.breakers[k].on ? st(1, 'ONLINE') : st(0, 'OFF');
const SYSTEMS = {
  BOW: () => [['艏部球形声呐阵', brk('SONAR')], ['UQC 水下电话', st(1, 'OK')], ['主动声呐换能器', SD.exposure > 0 ? st(2, 'PING') : st(1, 'STBY')]],
  TORP: () => [
    ...Object.entries(S.tubes).map(([k, t]) => [`发射管 ${k}`, t.dmg ? st(0, 'JAMMED') : st(t.state === 'READY' ? 2 : t.state === 'EMPTY' ? 3 : 1, `${t.type || '—'} ${SD.TUBE_STATE_CN[t.state]}`)]),
    ['鱼雷管预热', brk('TUBE')],
    ['弹药舱', st(1, Object.values(S.magazine).reduce((a, b) => a + b, 0) + ' 枚')],
  ],
  CTRL: () => [['TACNET-7 主机', st(1, 'OK')], ['CON-1 / CON-2', st(1, 'OK')], ['CON-3', brk('CON3')], ['CON-4', st(0, 'FAIL')], ['潜望镜', st(0, '37 年未升起')], ['惯导平台', st(3, `±${S.navErr.toFixed(1)}KM`)]],
  CREW: () => [['生命维持 · CO₂ 洗涤', brk('LIFE')], ['藻类农场照明', brk('ALGAE')], ['淡水蒸馏', brk('DESAL')], ['医务室', st(1, 'OK')]],
  RX: () => [['压水堆', st(S.reactor > 85 ? 2 : 1, `${S.reactor}%`)], ['主冷却泵', st(S.reactor > 70 ? 2 : 1, S.reactor > 70 ? '高速 · 噪声大' : '低速')], ['燃料棒', st(3, '剩余 ~11 年')], ['屏蔽层', st(1, 'OK')]],
  ENG: () => [['主汽轮机', st(1, `${Math.round(S.reactor * 1.2)} MW`)], ['发电机 A / B', st(3, 'A OK · B DEGRADED')], ['主母线', SD.powerUsed() > S.reactor * 1.2 ? st(0, 'OVERLOAD') : st(1, 'NOMINAL')]],
  AFT: () => [['七叶螺旋桨', S.breakers.PROP.on ? st(1, `${S.spd.toFixed(1)}KN`) : st(0, 'STOP')], ['方向舵 / 艉水平舵', st(1, 'OK')], ['拖曳阵列', st(3, 'DEGRADED')]],
};
const ST_CLS = ['hot', '', 'hot', 'dim'];    // 0 故障/关闭 1 正常 2 注意 3 降级

// 进水：被淹的舱会慢慢灌满；没关水密门会往相邻舱蔓延；损管队所在舱慢慢排水
SD.leak = id => {
  const c = S.hull.find(h => h.id === +id) || S.hull[Math.random() * S.hull.length | 0];
  c.leak = true; c.flood = Math.max(c.flood, .05);
  SD.audio.alarm(); SD.spike(6, 10, '进水');
  SD.say('损管', `${c.id} 号舱进水！${c.name}`);
  SD.emit('hull');
};
SD.addSystem(sdt => {
  let changed = false;
  for (const [i, c] of S.hull.entries()) {
    if (c.leak) { c.flood = Math.min(1, c.flood + sdt * .0012 * (S.depth / 200)); changed = true; }
    if (S.dc === c.id && c.flood > 0) {
      c.flood = Math.max(0, c.flood - sdt * .0016);
      if (c.leak && c.flood < .3 && Math.random() < .002 * sdt) { c.leak = false; SD.say('损管', `${c.id} 号舱漏点已堵住`); }
      changed = true;
    }
    // 水密门没关，灌到一半以上开始往两边漫
    if (c.flood > .5 && !c.sealed) for (const n of [S.hull[i - 1], S.hull[i + 1]]) {
      if (n && !n.sealed && n.flood < c.flood - .2) { n.flood += sdt * .0006; changed = true; }
    }
  }
  const depthStress = Math.max(0, S.depth - SAFE) / (CRUSH - SAFE);
  S.hullInt = SD.clamp(100 - S.hull.reduce((a, c) => a + c.flood * 8, 0) - depthStress * 30, 0, 100);
  if (changed) SD.emit('hull');
});

SD.register({
  code: 'HULL', cn: '舰体分布图', ph: 'green', fkey: 'F6',
  create(root) {
    root.innerHTML = `
      <div class="mod-title"><span>HULL // SS-鲸落 舰体侧面 · 装备分布</span><span class="hl-int"></span></div>
      <div class="mod-body" style="display:grid;grid-template-rows:minmax(120px,1fr) minmax(0,8.5em);gap:6px">
        <div style="position:relative"><canvas class="fill"></canvas></div>
        <div class="hl-panel" style="display:grid;grid-template-columns:1fr 12em;gap:10px;min-height:0"></div>
      </div>`;
    const cv = root.querySelector('canvas'), panel = root.querySelector('.hl-panel'), intEl = root.querySelector('.hl-int');
    let sel = 3, hover = null, geo = null;

    const hit = e => {
      if (!geo) return null;
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (y < geo.top - 30 || y > geo.bot + 10) return null;
      const u = (x - geo.x0) / geo.len;
      const c = S.hull.find(h => u >= h.x0 && u < h.x1);
      return c ? c.id : null;
    };
    cv.addEventListener('mousemove', e => { hover = hit(e); cv.style.cursor = hover ? 'pointer' : ''; });
    cv.addEventListener('mouseleave', () => hover = null);
    cv.addEventListener('pointerdown', e => { const id = hit(e); if (id) { sel = id; SD.audio.key(); drawPanel(); } });

    panel.addEventListener('pointerdown', e => {
      const a = e.target.dataset.act; if (!a) return;
      const c = S.hull.find(h => h.id === sel);
      SD.audio.key();
      if (a === 'seal') { c.sealed = !c.sealed; SD.audio.relay(); SD.audio.click(.35, 180); SD.spike(4, 3, '水密门'); SD.say('损管', `${c.id} 号舱水密门${c.sealed ? '关闭' : '打开'}`); }
      if (a === 'dc') { S.dc = S.dc === c.id ? null : c.id; SD.say('损管', S.dc ? `损管队前往 ${c.id} 号舱` : '损管队待命'); }
      if (a === 'leak') SD.leak(c.id);
      drawPanel();
    });

    function drawPanel() {
      const c = S.hull.find(h => h.id === sel);
      const rows = SYSTEMS[c.code]().map(([n, s]) => `<tr><td class="cnf">${n}</td><td class="${ST_CLS[s.ok]}">${s.txt}</td></tr>`).join('');
      SD.html(panel, `
        <div style="overflow:auto">
          <div><span class="inv">${c.id}</span> <span class="cnf">${c.name}</span> <span class="dim">${c.code}</span></div>
          <table class="data" style="margin-top:3px">${rows}</table>
        </div>
        <div class="panel" style="border-left:1px solid rgba(var(--ph-rgb),.35);padding-left:8px">
          <div class="kv">
            <span>FLOOD</span><span class="${c.flood > .05 ? 'hot' : ''}">${Math.round(c.flood * 100)}%${c.leak ? ' <span class="blink">LEAK</span>' : ''}</span>
            <span>DOORS</span><span>${c.sealed ? 'SEALED' : 'OPEN'}</span>
            <span>DC TEAM</span><span>${S.dc === c.id ? 'ON SITE' : S.dc ? 'IN ' + S.dc : 'STBY'}</span>
          </div>
          <div style="margin-top:4px"><span class="btn cnf ${c.sealed ? "on" : ""}" data-act="seal">水密门</span><span class="btn cnf ${S.dc === c.id ? "on" : ""}" data-act="dc">派损管</span></div>
          <div><span class="btn cnf" data-act="leak">模拟进水</span></div>
        </div>`);
    }

    function draw() {
      const { ctx, w, h } = SD.fitCanvas(cv);
      const col = SD.phColor(root), rgb = SD.phRGB(root);
      ctx.clearRect(0, 0, w, h);
      const len = w - 60, x0 = 30, mid = h * .58, rad = Math.min(h * .2, len * .075);
      const top = mid - rad, bot = mid + rad;
      geo = { x0, len, top, bot };
      const X = u => x0 + u * len;
      // 艇体半高：艏部圆钝，艉部收成锥形
      const halfH = u => u < .08 ? rad * Math.sqrt(1 - ((.08 - u) / .08) ** 2) : u > .78 ? rad * Math.max(.12, 1 - ((u - .78) / .22) ** 1.4) : rad;

      // 水深背景：安全深度 / 压溃深度刻度
      ctx.font = '12px VT323, monospace';
      const stress = SD.clamp((S.depth - SAFE) / (CRUSH - SAFE), 0, 1);

      // 舱段填充（进水用斜线水位表示）
      for (const c of S.hull) {
        const a = X(c.x0), b = X(c.x1);
        ctx.save();
        ctx.beginPath();
        for (let u = c.x0; u <= c.x1 + .0001; u += .005) ctx.lineTo(X(u), mid - halfH(u));
        for (let u = c.x1; u >= c.x0 - .0001; u -= .005) ctx.lineTo(X(u), mid + halfH(u));
        ctx.closePath(); ctx.clip();
        const on = c.id === sel, hv = c.id === hover;
        ctx.fillStyle = `rgba(${rgb},${on ? .16 : hv ? .1 : .04})`; ctx.fillRect(a, top - 2, b - a, bot - top + 4);
        if (c.flood > 0) {
          const wl = bot - (bot - top) * c.flood;
          ctx.fillStyle = 'rgba(255,74,58,.28)'; ctx.fillRect(a, wl, b - a, bot - wl);
          ctx.strokeStyle = 'rgba(255,74,58,.8)'; ctx.beginPath();
          for (let x = a; x < b; x += 4) ctx.lineTo(x, wl + Math.sin(x * .3 + Date.now() / 300) * 1.2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 艇体轮廓
      ctx.strokeStyle = stress > 0 ? `rgba(255,74,58,${.5 + stress * .5})` : col; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let u = 0; u <= 1; u += .004) ctx.lineTo(X(u), mid - halfH(u));
      for (let u = 1; u >= 0; u -= .004) ctx.lineTo(X(u), mid + halfH(u));
      ctx.closePath(); ctx.stroke();
      // 深度越大，艇壳应力线越密（在安全深度以下才开始出现）
      if (stress > 0) {
        ctx.save(); ctx.strokeStyle = `rgba(255,74,58,${stress * .6})`; ctx.lineWidth = 1;
        const n = Math.round(4 + stress * 20);
        for (let i = 0; i < n; i++) { const u = .1 + Math.random() * .7, x = X(u); ctx.beginPath(); ctx.moveTo(x, mid - rad); ctx.lineTo(x + SD.rand(-4, 4), mid - rad + 5); ctx.stroke(); }
        ctx.restore();
      }

      // 指挥台围壳 + 桅杆
      const sx0 = X(.27), sx1 = X(.37), sh = rad * 1.05;
      ctx.lineWidth = 1.2; ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(sx0, top + 1); ctx.lineTo(sx0 + 8, top - sh); ctx.lineTo(sx1, top - sh); ctx.lineTo(sx1 + 6, top + 1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(.30), top - sh); ctx.lineTo(X(.30), top - sh - 12); ctx.moveTo(X(.33), top - sh); ctx.lineTo(X(.33), top - sh - 8); ctx.stroke();
      // 围壳舵
      ctx.beginPath(); ctx.moveTo(sx0 + 12, top - sh * .55); ctx.lineTo(sx0 - 6, top - sh * .5); ctx.stroke();
      // 艉舵和螺旋桨
      const tx = X(1);
      ctx.beginPath(); ctx.moveTo(X(.93), mid - halfH(.93)); ctx.lineTo(X(.97), mid - rad * 1.1); ctx.lineTo(tx - 4, mid - rad * 1.1); ctx.lineTo(tx - 6, mid - 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(.93), mid + halfH(.93)); ctx.lineTo(X(.97), mid + rad * 1.1); ctx.lineTo(tx - 4, mid + rad * 1.1); ctx.lineTo(tx - 6, mid + 2); ctx.stroke();
      const spin = S.breakers.PROP.on ? Date.now() / 1000 * S.spd : 0;
      for (let i = 0; i < 3; i++) { const yy = Math.sin(spin + i * 2.1) * rad * .5; ctx.beginPath(); ctx.moveTo(tx + 2, mid); ctx.lineTo(tx + 6, mid + yy); ctx.stroke(); }
      // 拖曳阵列线缆
      ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = `rgba(${rgb},.45)`;
      ctx.beginPath(); ctx.moveTo(tx + 6, mid); ctx.quadraticCurveTo(tx + 20, mid + rad * .6, w, mid + rad * .9); ctx.stroke(); ctx.restore();

      // 舱壁（关了水密门画成实线加粗）
      for (const c of S.hull.slice(0, -1)) {
        const x = X(c.x1), hh = halfH(c.x1), nx = S.hull[c.id];
        const sealed = c.sealed || (nx && nx.sealed);
        ctx.save(); ctx.strokeStyle = sealed ? col : `rgba(${rgb},.45)`; ctx.lineWidth = sealed ? 2.5 : 1;
        if (!sealed) ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, mid - hh); ctx.lineTo(x, mid + hh); ctx.stroke(); ctx.restore();
      }

      // 装备图标：画在舱段里，状态不正常时闪烁
      const icons = [
        [.035, 0, '◉', SD.exposure > 0 ? 2 : S.breakers.SONAR.on ? 1 : 0, 'SONAR'],
        [.13, -.35, '═', tubeState('T1')], [.13, -.05, '═', tubeState('T2')], [.13, .25, '═', tubeState('T3')], [.13, .55, '═', tubeState('T4')],
        [.19, .2, '▤', 1, 'MAG'],
        [.30, 0, '▣', 1, 'TACNET'], [.35, .35, '▢', S.breakers.CON3.on ? 1 : 0, 'CON3'],
        [.45, -.2, '♨', S.breakers.LIFE.on ? 1 : 0, 'O₂'], [.50, .35, '✱', S.breakers.ALGAE.on ? 1 : 0, 'ALGAE'],
        [.62, 0, '☢', S.reactor > 85 ? 2 : 1, `RX ${S.reactor}%`],
        [.76, -.2, '⚙', 1, 'TURB'], [.80, .3, '⌁', SD.powerUsed() > S.reactor * 1.2 ? 0 : 1, 'GEN'],
        [.92, 0, '✣', S.breakers.PROP.on ? 1 : 0, 'PROP'],
      ];
      ctx.font = '13px "Fusion Pixel 12px Monospaced SC", Menlo, monospace'; ctx.textAlign = 'center';
      const blink = Math.floor(Date.now() / 400) % 2;
      for (const [u, v, g, s, label] of icons) {
        const x = X(u), y = mid + v * halfH(u);
        if (s === 0 && blink) continue;
        ctx.fillStyle = s === 0 || s === 2 ? '#ff4a3a' : s === 3 ? `rgba(${rgb},.4)` : col;
        ctx.fillText(g, x, y + 4);
        if (label) { ctx.save(); ctx.font = '11px VT323, monospace'; ctx.globalAlpha = .7; ctx.fillText(label, x, y + 15); ctx.restore(); }
      }
      // 舱段编号和名称（艇体上方）
      ctx.font = '12px VT323, monospace';
      for (const c of S.hull) {
        const x = (X(c.x0) + X(c.x1)) / 2;
        ctx.fillStyle = c.id === sel ? col : `rgba(${rgb},.55)`;
        ctx.fillText(`${c.id} ${c.code}`, x, bot + 16);
        if (c.flood > .05) { ctx.fillStyle = '#ff4a3a'; ctx.fillText(`${Math.round(c.flood * 100)}%`, x, bot + 28); }
        if (S.dc === c.id) { ctx.fillStyle = col; ctx.fillText('▲DC', x, top - 6 - (c.code === 'CTRL' ? rad * 1.2 : 0)); }
      }
      ctx.textAlign = 'start';

      // 深度标尺（右上角）
      const gx = w - 16, gy0 = 8, gy1 = top - 10;
      if (gy1 - gy0 > 30) {
        ctx.strokeStyle = `rgba(${rgb},.5)`; ctx.beginPath(); ctx.moveTo(gx, gy0); ctx.lineTo(gx, gy1); ctx.stroke();
        const Y = d => gy0 + (gy1 - gy0) * d / 600;
        ctx.fillStyle = `rgba(${rgb},.6)`; ctx.textAlign = 'right';
        ctx.fillText('SAFE ' + SAFE, gx - 4, Y(SAFE) + 3); ctx.fillStyle = '#ff4a3a'; ctx.fillText('CRUSH ' + CRUSH, gx - 4, Y(CRUSH) + 3);
        ctx.fillStyle = col; ctx.fillText(`▶ ${S.depth | 0}M`, gx - 4, Y(S.depth) + 3); ctx.fillRect(gx - 3, Y(S.depth), 6, 1.5);
        ctx.textAlign = 'start';
      }
      ctx.fillStyle = `rgba(${rgb},.55)`;
      ctx.fillText('BOW ◀', 4, 14);
    }
    const tubeState = k => { const t = S.tubes[k]; return t.dmg ? 0 : t.state === 'READY' ? 2 : t.state === 'EMPTY' ? 3 : 1; };

    SD.on('hull', drawPanel); SD.on('weapons', drawPanel);
    drawPanel();
    let t = 0;
    return {
      tick(dt) {
        draw(); t += dt;
        if (t > .5) { t = 0; drawPanel(); intEl.innerHTML = `HULL <span class="${S.hullInt < 80 ? 'hot' : ''}">${S.hullInt.toFixed(0)}%</span>  DEPTH ${S.depth | 0}/${SAFE}M`; }
      },
      key(e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { sel = Math.min(7, sel + 1); drawPanel(); return true; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { sel = Math.max(1, sel - 1); drawPanel(); return true; }
        if (e.key === 'd') { S.dc = S.dc === sel ? null : sel; drawPanel(); return true; }
        if (e.key === 'w') { const c = S.hull[sel - 1]; c.sealed = !c.sealed; SD.audio.relay(); drawPanel(); return true; }
      },
    };
  },
});
})();
