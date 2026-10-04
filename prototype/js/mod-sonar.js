/* SONAR 频谱瀑布 + DIFF 异常对比
 * 瀑布：横轴频率 0~500Hz，纵轴时间，每个目标留下一组线谱
 * 选中目标后，下方显示它的线谱与声纹库比对。S-07（回声体）线谱完全不漂移、缺电源谐波 */

(() => {
const S = SD.state;
const FMAX = 500;

// 声纹库（原型用的假数据；带 * 的条目损坏）
SD.library = [
  { name: '舰队协约-"赤潮级"', lines: [52, 104, 156, 208, 310, 420], damaged: true },
  { name: '锈帮改装艇', lines: [60, 120, 180, 240, 355] },
  { name: '哀歌鲸', lines: [18, 36, 240] },
  { name: '死手协议 猎杀潜航器', lines: [75, 150, 225, 450] },
];

// 读数快照：给 DIFF 用。echo 类型读数完全不变
function reading(c) {
  const drift = c.kind === 'echo' ? 0 : 1;
  return {
    t: S.clock,
    rpm: c.kind === 'whale' ? null : +(c.kind === 'echo' ? 142.0 : 142 + SD.rand(-3, 3) * drift).toFixed(1),
    blade: c.kind === 'sub' ? 7 : c.kind === 'whale' ? null : 5,
    lines: c.lines.map(f => +(f + SD.rand(-1.2, 1.2) * drift).toFixed(1)),
    brg: +SD.bearingTo(S.own.x, S.own.y, c.x, c.y).toFixed(1),
    snr: +(SD.clamp(30 - SD.dist(S.own.x, S.own.y, c.x, c.y) * 2.2, 2, 30) + SD.rand(-1, 1)).toFixed(1),
    pump: c.kind === 'sub' ? '有' : c.kind === 'rust' ? '柴电' : '无',
    tempo: c.kind === 'echo' ? '0.000s' : SD.rand(.01, .09).toFixed(3) + 's',
  };
}
SD.takeReading = c => { c.history.push(reading(c)); if (c.history.length > 6) c.history.shift(); };

SD.register({
  code: 'SONAR', cn: '被动声呐瀑布', ph: 'green', fkey: 'F2',
  create(root) {
    root.innerHTML = `
      <div class="mod-title"><span>SONAR // 被动声呐 · 频谱瀑布</span><span class="sn-gain"></span></div>
      <div class="mod-body" style="display:grid;grid-template-rows:1fr auto;gap:6px">
        <div style="position:relative"><canvas class="fill"></canvas></div>
        <div class="sn-match" style="height:6.2em;overflow:hidden"></div>
      </div>`;
    const cv = root.querySelector('canvas'), matchEl = root.querySelector('.sn-match'), gainEl = root.querySelector('.sn-gain');
    const buf = document.createElement('canvas'); // 瀑布历史存在离屏画布里，每帧下移一行
    let gain = 1, acc = 0, cursorF = null;

    cv.addEventListener('mousemove', e => { const r = cv.getBoundingClientRect(); cursorF = (e.clientX - r.left) / r.width * FMAX; });
    cv.addEventListener('mouseleave', () => cursorF = null);
    cv.addEventListener('wheel', e => { e.preventDefault(); gain = SD.clamp(gain + (e.deltaY < 0 ? .1 : -.1), .3, 2.5); }, { passive: false });

    function row(w) {
      const bctx = buf.getContext('2d');
      const img = bctx.createImageData(w, 1), d = img.data;
      const rgb = SD.phRGB(root).split(',').map(Number);
      const amp = new Float32Array(w);
      const floor = S.leviathan ? 0.01 : .16;     // 利维坦来临，连背景噪声都没了
      for (let i = 0; i < w; i++) amp[i] = Math.random() * floor * gain + (S.breakers.SONAR.on ? 0 : 0);
      if (S.breakers.SONAR.on && !S.leviathan) {
        // 本艇自噪声：反应堆越高，低频越脏
        const selfN = S.reactor / 100 * .5 + (S.silent ? -.15 : 0);
        for (let i = 0; i < w * .12; i++) amp[i] += Math.random() * selfN * (1 - i / (w * .12));
        for (const c of SD.visibleContacts()) {
          const dist = SD.dist(S.own.x, S.own.y, c.x, c.y);
          const s = SD.clamp(2.4 / (dist + .6), .08, 1) * gain;
          for (const f of c.lines) {
            const jitter = c.kind === 'echo' ? 0 : SD.rand(-.8, .8);
            const x = Math.round((f + jitter) / FMAX * w);
            for (let k = -1; k <= 1; k++) if (amp[x + k] != null) amp[x + k] += s * (k ? .35 : 1) * (Math.random() * .4 + .6);
          }
        }
      }
      for (let i = 0; i < w; i++) {
        const a = SD.clamp(amp[i], 0, 1);
        // 抖动量化成 4 级，模拟 ░▒▓█
        const q = Math.floor(a * 4 + Math.random() * .6) / 4;
        d[i * 4] = rgb[0] * q; d[i * 4 + 1] = rgb[1] * q; d[i * 4 + 2] = rgb[2] * q; d[i * 4 + 3] = 255;
      }
      return img;
    }

    function drawMatch() {
      const c = SD.contact(S.selected);
      if (!c || c.hidden || S.leviathan) { SD.html(matchEl, `<span class="dim">未选中可听目标</span>`); return; }
      const lib = SD.library.find(l => l.name === c.match[0]);
      // 目标线谱 vs 库线谱：用字符条表示，缺的谐波标红
      const scale = f => Math.round(f / FMAX * 50);
      const bar = (lines, other) => { const a = Array(51).fill('·'); lines.forEach(f => a[scale(f)] = '│'); return a.join(''); };
      const missing = lib.lines.filter(f => !c.lines.some(g => Math.abs(g - f) < 4));
      const libBar = (() => { const a = Array(51).fill('·'); lib.lines.forEach(f => a[scale(f)] = missing.includes(f) ? '<span class="hot">│</span>' : '│'); return a.join(''); })();
      SD.html(matchEl, `
        <div style="display:flex;justify-content:space-between"><span>${c.id} <span class="cnf">${c.match[0]}</span> ${c.match[1]}%</span>
          <span><span class="btn" data-act="read">TAKE READING</span><span class="btn" data-act="diff">DIFF ▶</span></span></div>
        <div class="art">TGT ${bar(c.lines)}\nLIB ${libBar}</div>
        ${missing.length ? `<div class="hot cn">⚠ 缺少谐波 ${missing.join(' / ')} Hz — 可能是模仿</div>` : ''}
        ${lib.damaged ? `<div class="cn">⚠ 声纹库条目损坏，可能被伪造</div>` : ''}
        ${c.flag && !missing.length ? `<div class="cn dim">备注：${c.flag}</div>` : ''}`);
    }
    matchEl.addEventListener('pointerdown', e => {
      const a = e.target.dataset.act; if (!a) return;
      SD.audio.key();
      const c = SD.contact(S.selected);
      if (a === 'read') { SD.takeReading(c); SD.say('声呐', `${c.id} 读数已存档，共 ${c.history.length} 份`); }
      if (a === 'diff') SD.openModule('DIFF');
    });

    SD.on('select', drawMatch);
    drawMatch();
    let mt = 0;
    return {
      tick(dt) {
        const { ctx, w, h } = SD.fitCanvas(cv);
        const W = Math.max(50, w | 0), H = Math.max(50, h | 0);
        if (buf.width !== W || buf.height !== H) {
          // 改尺寸会清空画布，先把旧的瀑布历史拷出来再贴回去
          const old = document.createElement('canvas'); old.width = buf.width; old.height = buf.height;
          old.getContext('2d').drawImage(buf, 0, 0);
          buf.width = W; buf.height = H;
          buf.getContext('2d').drawImage(old, 0, 0, old.width, old.height, 0, 0, W, old.height);
        }
        acc += dt;
        const bctx = buf.getContext('2d');
        while (acc > .06) { acc -= .06; bctx.drawImage(buf, 0, 1); bctx.putImageData(row(W), 0, 0); }
        ctx.drawImage(buf, 0, 0, w, h);
        // 频率刻度
        const rgb = SD.phRGB(root);
        ctx.fillStyle = `rgba(${rgb},.8)`; ctx.font = '13px VT323, monospace';
        for (let f = 0; f <= FMAX; f += 50) { const x = f / FMAX * w; ctx.fillRect(x, h - 4, 1, 4); ctx.fillText(f, x + 2, h - 6); }
        // 选中目标的线谱标记
        const c = SD.contact(S.selected);
        if (c && !c.hidden && !S.leviathan) {
          ctx.strokeStyle = `rgba(${rgb},.6)`; ctx.setLineDash([3, 3]);
          for (const f of c.lines) { const x = f / FMAX * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 12); ctx.stroke(); }
          ctx.setLineDash([]); ctx.fillText(c.id, c.lines[0] / FMAX * w + 3, 12);
        }
        if (cursorF != null) {
          const x = cursorF / FMAX * w; ctx.fillStyle = `rgba(${rgb},.9)`; ctx.fillRect(x, 0, 1, h);
          ctx.fillText(cursorF.toFixed(1) + ' Hz', x + 4, 26);
        }
        if (!S.breakers.SONAR.on) { ctx.fillStyle = '#ff4a3a'; ctx.font = '20px VT323, monospace'; ctx.fillText('ARRAY OFFLINE — 断路器已拉开', 12, h / 2); }
        gainEl.textContent = `GAIN ${gain.toFixed(1)}  ${SD.audio.headphones ? '🎧 ON' : '[H] 耳机'}`;
        mt += dt; if (mt > 1) { mt = 0; drawMatch(); }
      },
      key(e) {
        if (e.key === 'r') { SD.takeReading(SD.contact(S.selected)); SD.say('声呐', '读数已存档'); return true; }
      },
    };
  },
});

// ---------- DIFF 异常对比 ----------
SD.register({
  code: 'DIFF', cn: '异常对比', ph: 'amber', fkey: 'F7',
  create(root) {
    root.innerHTML = `<div class="mod-title"><span>DIFF // 读数异常对比</span><span class="df-id"></span></div><div class="mod-body df-body" style="overflow:auto"></div>`;
    const body = root.querySelector('.df-body'), idEl = root.querySelector('.df-id');
    function draw() {
      const c = SD.contact(S.selected);
      idEl.textContent = c ? c.id : '';
      if (!c) return;
      if (c.history.length < 2) {
        SD.html(body, `<div class="cn" style="margin-top:20px">需要至少两份读数才能对比。<br>在 SONAR 里按 [R] 或点 TAKE READING。当前 ${c.history.length} 份。</div>
          <div style="margin-top:10px"><span class="btn" data-act="read">TAKE READING</span></div>`);
        return;
      }
      const a = c.history[c.history.length - 2], b = c.history[c.history.length - 1];
      const dt = b.t - a.t;
      const fields = [['RPM', 'rpm'], ['BLADES', 'blade'], ['PUMP', 'pump'], ['BRG', 'brg'], ['SNR dB', 'snr'], ['TEMPO σ', 'tempo']];
      a.lines.forEach((_, i) => fields.push([`LINE ${i + 1} Hz`, i]));
      const val = (r, k) => typeof k === 'number' ? r.lines[k] : r[k];
      // 方位和信噪比随本艇位置变化，不算；只看目标自身的机械特征
      const intrinsic = k => k === 'rpm' || k === 'tempo' || typeof k === 'number';
      let same = 0, total = 0;
      const rows = fields.map(([label, k]) => {
        const va = val(a, k), vb = val(b, k);
        const eq = va === vb;
        if (va != null && intrinsic(k)) { total++; if (eq) same++; }
        return `<tr><td>${label}</td><td>${va ?? '--'}</td><td class="${eq ? '' : 'hot'}">${vb ?? '--'}</td><td>${eq ? '<span class="dim">=</span>' : 'Δ ' + (typeof va === 'number' ? (vb - va).toFixed(1) : '≠')}</td></tr>`;
      }).join('');
      const suspicious = total > 2 && same >= total - 1;
      SD.html(body, `
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
          ${suspicious
            ? `<div class="hot cn">⚠ ${same}/${total} 项机械特征分毫不差。真正的机械不可能这么稳定。</div>`
            : `<div class="cn">机械特征在正常漂移（${total - same}/${total} 项有变化）。是真的机械，或者模仿得很好。</div>`}
          <span class="btn" data-act="read" style="flex:none">TAKE READING</span>
        </div>
        <div class="cn dim" style="margin-top:4px">读数 A ${SD.pad(a.t / 60 % 60, 2)}:${SD.pad(a.t % 60, 2)} → 读数 B（间隔 ${dt | 0}s）变化的值标红</div>
        <table class="data" style="margin-top:4px"><tr><th>FIELD</th><th>A</th><th>B</th><th>Δ</th></tr>${rows}</table>`);
      if (suspicious && !c.diffAlarmed) { c.diffAlarmed = true; SD.audio.beep(220, .4, .05, 'sine'); }
    }
    body.addEventListener('pointerdown', e => {
      if (e.target.dataset.act === 'read') { SD.audio.key(); SD.takeReading(SD.contact(S.selected)); draw(); }
    });
    SD.on('select', draw);
    draw();
    let t = 0;
    return { tick(dt) { t += dt; if (t > 1) { t = 0; draw(); } } };
  },
});
})();
