/* TACPLOT 战术态势图（参考 01、02：ARPA 雷达的距离圈 + 右侧数据栏）
 * 被动声呐只给方位线；MARK 记录一条方位线，换位置再 MARK，两线交叉得到距离估算
 * PING 立刻显示精确位置，代价是暴露自己 */

(() => {
const S = SD.state;

// 两条方位线求交点（方位线从测量点出发）
function intersect(a, b) {
  const [ax, ay] = [Math.sin(SD.rad(a.brg)), Math.cos(SD.rad(a.brg))];
  const [bx, by] = [Math.sin(SD.rad(b.brg)), Math.cos(SD.rad(b.brg))];
  const den = ax * by - ay * bx;
  if (Math.abs(den) < 0.035) return null;   // 夹角太小（约 2°），交不出来
  const t = ((b.x - a.x) * by - (b.y - a.y) * bx) / den;
  if (t <= 0) return null;
  return [a.x + ax * t, a.y + ay * t, Math.abs(den)];
}

SD.tma = c => {
  const bs = c.bearings;
  if (bs.length < 2) return null;
  const p = intersect(bs[bs.length - 2], bs[bs.length - 1]);
  if (!p) return null;
  // 夹角越小，估算越不可靠
  return { x: p[0], y: p[1], err: SD.clamp(.05 / p[2], .15, 2.5) };
};

SD.markBearing = id => {
  const c = SD.contact(id); if (!c || c.hidden || S.leviathan) return;
  const brg = SD.bearingTo(S.own.x, S.own.y, c.x, c.y) + SD.rand(-.4, .4);
  c.bearings.push({ x: S.own.x, y: S.own.y, brg: SD.norm(brg), t: S.clock });
  if (c.bearings.length > 4) c.bearings.shift();
  const fix = SD.tma(c);
  if (fix) {
    c.rngEst = SD.dist(S.own.x, S.own.y, fix.x, fix.y);
    SD.say('火控', `${c.id} 方位线交叉，估算距离 ${c.rngEst.toFixed(1)} 公里，误差 ±${fix.err.toFixed(1)}`);
  } else if (c.bearings.length === 1) {
    SD.say('火控', `${c.id} 方位 ${SD.pad(brg)} 已记录。建议转向后跑一段再测`);
  } else {
    SD.say('火控', `${c.id} 两条方位线夹角太小，再跑远一点`);
  }
};

SD.doPing = () => {
  S.pings.push({ x: S.own.x, y: S.own.y, t: 0 });
  SD.audio.ping();
  for (const c of SD.visibleContacts()) {
    c.pingFix = { x: c.x, y: c.y, t: S.clock };
    c.rngEst = SD.dist(S.own.x, S.own.y, c.x, c.y);
  }
  SD.exposure = 100;
  SD.say('声呐', '主动声呐已发射。全海域都听到了');
  setTimeout(() => SD.report({
    title: 'ACTIVE PING',
    rows: [['接触目标定位', SD.visibleContacts().length], ['本艇暴露半径', '~18 KM'], ['预计引来', '未知']],
    note: '"我在这里。"',
  }), 1400);
};
SD.exposure = 0;

SD.register({
  code: 'TACPLOT', cn: '战术态势图', ph: 'green', fkey: 'F1',
  create(root) {
    root.innerHTML = `
      <div class="mod-title"><span>TACPLOT // 战术态势图</span><span class="tp-scale"></span></div>
      <div class="mod-body side">
        <div style="position:relative"><canvas class="fill"></canvas></div>
        <div class="panel tp-panel"></div>
      </div>`;
    const cv = root.querySelector('canvas'), panel = root.querySelector('.tp-panel');
    let range = 8, sweep = 0;
    const scaleEl = root.querySelector('.tp-scale');

    cv.addEventListener('pointerdown', e => {
      // 点击选中最近的方位线目标
      const r = cv.getBoundingClientRect(), cx = r.width / 2, cy = r.height / 2;
      const ang = SD.norm(Math.atan2(e.clientX - r.left - cx, cy - (e.clientY - r.top)) * 180 / Math.PI);
      let best = null, bd = 12;
      for (const c of SD.visibleContacts()) {
        const d = Math.abs(((SD.bearingTo(S.own.x, S.own.y, c.x, c.y) - ang + 540) % 360) - 180);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) { S.selected = best.id; SD.audio.key(); SD.emit('select'); }
    });
    cv.addEventListener('wheel', e => { e.preventDefault(); range = SD.clamp(range * (e.deltaY > 0 ? 1.25 : .8), 2, 24); SD.audio.click(.06, 3000); }, { passive: false });

    panel.addEventListener('pointerdown', e => {
      const a = e.target.dataset.act; if (!a) return;
      SD.audio.key();
      if (a === 'mark') SD.markBearing(S.selected);
      if (a === 'ping') SD.doPing();
      if (a === 'turn') { S.hdgOrd = SD.norm(S.hdgOrd + 35); SD.say('操舵', `右舵，新航向 ${SD.pad(S.hdgOrd)}`); }
      if (a === 'rng+') range = SD.clamp(range * 1.25, 2, 24);
      if (a === 'rng-') range = SD.clamp(range * .8, 2, 24);
    });

    function drawPanel() {
      const c = SD.contact(S.selected);
      const vis = c && !c.hidden && !S.leviathan;
      const brg = vis ? SD.bearingTo(S.own.x, S.own.y, c.x, c.y) : null;
      let cpa = '--', tcpa = '--';
      if (vis && c.rngEst) {
        // 用真实相对运动算 CPA，但只在有距离估算后才显示（原型简化）
        const rx = c.x - S.own.x, ry = c.y - S.own.y;
        const ov = SD.polar(0, 0, S.hdg, S.spd * 0.0005144);
        const vx = c.vx / 60 - ov[0], vy = c.vy / 60 - ov[1];
        const v2 = vx * vx + vy * vy;
        const t = v2 > 1e-9 ? -(rx * vx + ry * vy) / v2 : 0;
        const d = t > 0 ? Math.hypot(rx + vx * t, ry + vy * t) : Math.hypot(rx, ry);
        cpa = d.toFixed(1) + ' KM'; tcpa = t > 0 ? (t / 60 | 0) + ' MIN' : 'OPENING';
      }
      SD.html(panel, `
        <div class="kv">
          <span>HDG</span><span>${SD.pad(S.hdg)}°${S.hdgOrd !== Math.round(S.hdg) ? ' → ' + SD.pad(S.hdgOrd) : ''}</span>
          <span>SPD</span><span>${S.spd.toFixed(1)} KN</span>
          <span>DEPTH</span><span>${S.depth | 0} M</span>
          <span>NAV ERR</span><span>±${S.navErr.toFixed(1)} KM</span>
          <span>RANGE</span><span>${range.toFixed(0)} KM</span>
        </div>
        <div class="sep"></div>
        <div>TGT <span class="inv">${S.selected}</span> <span class="cn">${vis ? SD.CLS_CN[c.cls] : ''}</span></div>
        <div class="kv">
          <span>BRG</span><span>${vis ? SD.pad(brg) + '°' : '<span class="hot">LOST</span>'}</span>
          <span>RNG</span><span>${vis && c.rngEst ? '~' + c.rngEst.toFixed(1) + ' KM' : '<span class="dim">NO SOLN</span>'}</span>
          <span>CPA</span><span>${cpa}</span>
          <span>TCPA</span><span>${tcpa}</span>
          <span>LOBS</span><span>${vis ? c.bearings.length : 0}/2</span>
        </div>
        <div class="sep"></div>
        <div><span class="btn" data-act="mark">MARK BRG</span><span class="btn" data-act="turn">TURN +35</span></div>
        <div><span class="btn ${SD.exposure > 0 ? 'hot' : ''}" data-act="ping">PING ▲</span><span class="btn" data-act="rng-">RNG−</span><span class="btn" data-act="rng+">RNG+</span></div>
        <div class="cn dim" style="margin-top:6px;line-height:1.35">点击方位线选中目标<br>滚轮缩放 · 方位线需两处交叉</div>`);
    }

    function draw(dt) {
      const { ctx, w, h } = SD.fitCanvas(cv);
      const col = SD.phColor(root), rgb = SD.phRGB(root);
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 16, k = R / range;
      const toXY = (x, y) => [cx + (x - S.own.x) * k, cy - (y - S.own.y) * k];
      // 余晖：不完全清屏
      ctx.fillStyle = 'rgba(5,8,5,0.35)'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = `rgba(${rgb},.28)`; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.font = '13px VT323, monospace';
      // 距离圈
      for (let i = 1; i <= 4; i++) {
        ctx.beginPath(); ctx.arc(cx, cy, R * i / 4, 0, Math.PI * 2); ctx.stroke();
        ctx.fillText((range * i / 4).toFixed(1), cx + 3, cy - R * i / 4 + 12);
      }
      // 方位刻度
      for (let a = 0; a < 360; a += 10) {
        const [x0, y0] = SD.polar(cx, 0, a, R), l = a % 30 ? 5 : 10;
        const s = Math.sin(SD.rad(a)), c = Math.cos(SD.rad(a));
        ctx.beginPath(); ctx.moveTo(cx + s * R, cy - c * R); ctx.lineTo(cx + s * (R - l), cy - c * (R - l)); ctx.stroke();
        if (a % 30 === 0) { ctx.save(); ctx.globalAlpha = .7; ctx.fillText(SD.pad(a), cx + s * (R + 2) - 9, cy - c * (R + 4) + 4); ctx.restore(); }
      }
      // 扫描线（纯装饰，被动声呐没有真正的扫描）
      sweep = (sweep + dt * 40) % 360;
      ctx.save(); ctx.strokeStyle = `rgba(${rgb},.18)`; ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(SD.rad(sweep)) * R, cy - Math.cos(SD.rad(sweep)) * R); ctx.stroke(); ctx.restore();

      // 航迹
      ctx.save(); ctx.fillStyle = `rgba(${rgb},.35)`;
      for (const p of S.track) { const [x, y] = toXY(p.x, p.y); ctx.fillRect(x - .5, y - .5, 1.5, 1.5); }
      ctx.restore();

      // 惯导误差圈
      ctx.save(); ctx.setLineDash([2, 4]); ctx.strokeStyle = `rgba(${rgb},.35)`;
      ctx.beginPath(); ctx.arc(cx, cy, S.navErr * k, 0, Math.PI * 2); ctx.stroke(); ctx.restore();

      // Ping 波纹
      for (const p of S.pings) {
        p.t += dt;
        const [x, y] = toXY(p.x, p.y);
        ctx.save(); ctx.strokeStyle = `rgba(${rgb},${SD.clamp(1 - p.t / 4, 0, 1)})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, p.t * 2.2 * k, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      S.pings = S.pings.filter(p => p.t < 4);

      // 航行中的鱼雷：从发射点沿方位线推进，线导雷拖一条导线
      for (const r of S.runs) {
        if (r.done) continue;
        const [x0, y0] = toXY(r.x0, r.y0);
        const [x1, y1] = toXY(...SD.polar(r.x0, r.y0, r.brg, r.dist));
        ctx.save(); ctx.strokeStyle = 'rgba(255,74,58,.85)'; ctx.fillStyle = '#ff4a3a';
        if (r.wire) { ctx.setLineDash([1, 3]); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]); }
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.globalAlpha = .5; ctx.stroke(); ctx.globalAlpha = 1;
        ctx.fillRect(x1 - 2, y1 - 2, 4, 4); ctx.fillText(r.tube, x1 + 4, y1 - 4);
        ctx.restore();
      }

      // 接触目标
      for (const c of SD.visibleContacts()) {
        const sel = c.id === S.selected, brg = SD.bearingTo(S.own.x, S.own.y, c.x, c.y);
        const hostile = c.cls === 'HOSTILE';
        ctx.save();
        ctx.strokeStyle = hostile ? 'rgba(255,74,58,.8)' : `rgba(${rgb},${sel ? .9 : .4})`;
        ctx.fillStyle = hostile ? '#ff4a3a' : col;
        // 当前方位线（虚线，从本艇出发）
        ctx.setLineDash(sel ? [6, 3] : [2, 5]);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(SD.rad(brg)) * R, cy - Math.cos(SD.rad(brg)) * R); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillText(c.id, cx + Math.sin(SD.rad(brg)) * (R - 22) - 10, cy - Math.cos(SD.rad(brg)) * (R - 22));
        // 已记录的方位线
        ctx.globalAlpha = .55;
        for (const b of c.bearings) {
          const [x0, y0] = toXY(b.x, b.y);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.sin(SD.rad(b.brg)) * R * 2, y0 - Math.cos(SD.rad(b.brg)) * R * 2); ctx.stroke();
          ctx.fillRect(x0 - 2, y0 - 2, 4, 4);
        }
        ctx.globalAlpha = 1;
        // TMA 交叉解：带误差的菱形
        const fix = SD.tma(c);
        if (fix) {
          const [x, y] = toXY(fix.x, fix.y), e = Math.max(5, fix.err * k);
          ctx.beginPath(); ctx.moveTo(x, y - e); ctx.lineTo(x + e, y); ctx.lineTo(x, y + e); ctx.lineTo(x - e, y); ctx.closePath(); ctx.stroke();
          ctx.fillText('EST', x + e + 3, y + 4);
        }
        // Ping 精确位置，30 秒后淡出
        if (c.pingFix) {
          const age = S.clock - c.pingFix.t;
          if (age < 30) {
            const [x, y] = toXY(c.pingFix.x, c.pingFix.y);
            ctx.globalAlpha = 1 - age / 30;
            ctx.fillRect(x - 4, y - 4, 8, 8);
            // 矢量线
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + c.vx * 10 * k, y - c.vy * 10 * k); ctx.stroke();
          } else c.pingFix = null;
        }
        ctx.restore();
      }
      // 本艇
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(SD.rad(S.hdg)); ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, -R); ctx.globalAlpha = .25; ctx.stroke();
      ctx.restore();

      if (S.leviathan) {
        ctx.save(); ctx.fillStyle = col; ctx.font = '22px VT323, monospace'; ctx.textAlign = 'center';
        ctx.fillText('NO CONTACTS', cx, cy + R / 2); ctx.restore();
      }
      scaleEl.textContent = `R ${range.toFixed(0)}KM  N↑`;
    }

    let pt = 0;
    SD.on('select', drawPanel);
    drawPanel();
    return {
      tick(dt) { draw(dt); pt += dt; if (pt > .5) { pt = 0; drawPanel(); } },
      key(e) {
        if (e.key === 'm') { SD.markBearing(S.selected); return true; }
        if (e.key === 'p') { SD.doPing(); return true; }
        if (e.key === '+' || e.key === '=') { range = SD.clamp(range * .8, 2, 24); return true; }
        if (e.key === '-') { range = SD.clamp(range * 1.25, 2, 24); return true; }
      },
    };
  },
});
})();
