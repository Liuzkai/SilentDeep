/* WEAPONS 武器系统：鱼雷型号、发射管装填、齐射组合、发射流程
 * 发射管状态机：EMPTY → LOADING → LOADED → FLOODED → READY(管门开) → 发射 → EMPTY
 * 每一步都有噪声代价；打开管门是最响的一步，对方的声呐也听得见 */

(() => {
const S = SD.state;

// 鱼雷与发射物型号（原型数据）
SD.WEAPONS = {
  'MK48-R': { name: '重型线导鱼雷', cn: '线导', range: 18, speed: 55, guide: 'WIRE', noise: 16, load: 90, note: '可以一边跑一边修正方位，线断就变成直航雷' },
  'SET-65': { name: '被动声自导鱼雷', cn: '被动自导', range: 12, speed: 40, guide: 'PASSIVE', noise: 10, load: 70, note: '自己不发声，跟着目标的噪声走。对静默目标没用' },
  'VA-111': { name: '超空泡火箭鱼雷', cn: '超空泡', range: 7, speed: 190, guide: 'STRAIGHT', noise: 34, load: 120, note: '几乎躲不开，但发射声全海域都听得到' },
  'MOSS':   { name: '声学诱饵', cn: '诱饵', range: 6, speed: 20, guide: 'DECOY', noise: 6, load: 40, note: '回放一段录下来的本艇噪声。锈帮最爱用' },
  'CAPTOR': { name: '系留水雷', cn: '水雷', range: 0, speed: 0, guide: 'MINE', noise: 4, load: 100, note: '布在航路上，被动等待。分不清敌我' },
};
SD.GUIDE_CN = { WIRE: '线导', PASSIVE: '被动声自导', STRAIGHT: '直航', DECOY: '诱饵', MINE: '水雷' };

// 弹药舱库存
S.magazine = { 'MK48-R': 3, 'SET-65': 2, 'VA-111': 1, 'MOSS': 4, 'CAPTOR': 1 };

// 四具发射管
S.tubes = {
  T1: { type: 'MK48-R', state: 'LOADED', prog: 0, dmg: false },
  T2: { type: 'SET-65', state: 'LOADED', prog: 0, dmg: false },
  T3: { type: null, state: 'EMPTY', prog: 0, dmg: false },
  T4: { type: 'MOSS', state: 'LOADED', prog: 0, dmg: false },
};

// 发射组合：几具管按间隔依次发射。玩家可以自己编
S.salvos = [
  { id: 'A', name: '标准双发', tubes: ['T1', 'T2'], gap: 4, spread: 6 },
  { id: 'B', name: '诱饵掩护撤离', tubes: ['T4'], gap: 0, spread: 0, evade: true },
  { id: 'C', name: '全管齐射', tubes: ['T1', 'T2', 'T3', 'T4'], gap: 2, spread: 10 },
];
S.salvoSel = 'A';
S.runs = [];           // 正在航行的鱼雷

const STATE_CN = { EMPTY: '空管', LOADING: '装填中', LOADED: '已装填', FLOODING: '注水中', FLOODED: '已注水', OPENING: '开管门', READY: '待发', FIRED: '已发射' };
SD.TUBE_STATE_CN = STATE_CN;

SD.tubeReady = t => S.tubes[t] && S.tubes[t].state === 'READY';
SD.loadedCount = () => Object.values(S.tubes).filter(t => t.type && t.state !== 'EMPTY' && t.state !== 'LOADING').length;

// ---------- 发射管操作 ----------
const busy = t => ['LOADING', 'FLOODING', 'OPENING'].includes(t.state);
SD.tubeAct = (id, act, type) => {
  const t = S.tubes[id]; if (!t) return SD.say('鱼雷舱', `没有 ${id}`);
  if (t.dmg) { SD.audio.alarm(); return SD.say('鱼雷舱', `${id} 管门卡死，打不开`); }
  if (busy(t)) return SD.say('鱼雷舱', `${id} 正在${STATE_CN[t.state]}，等一下`);
  if (act === 'LOAD') {
    if (t.state !== 'EMPTY') return SD.say('鱼雷舱', `${id} 里已经有东西了，先卸载`);
    type = type || Object.keys(S.magazine).find(k => S.magazine[k] > 0);
    if (!type || !S.magazine[type]) return SD.say('鱼雷舱', `弹药舱里没有 ${type || '鱼雷'} 了`);
    S.magazine[type]--; t.type = type; t.state = 'LOADING'; t.prog = 0;
    SD.audio.relay(); SD.spike(3, 4, '装填');
    SD.say('鱼雷舱', `${id} 开始装填 ${type}`);
  } else if (act === 'UNLOAD') {
    if (!t.type || t.state === 'EMPTY') return;
    if (t.state !== 'LOADED') return SD.say('鱼雷舱', `${id} 要先排水、关管门才能卸载`);
    S.magazine[t.type]++; SD.say('鱼雷舱', `${id} ${t.type} 退回弹药舱`); t.type = null; t.state = 'EMPTY';
    SD.audio.relay();
  } else if (act === 'FLOOD') {
    if (t.state !== 'LOADED') return SD.say('鱼雷舱', `${id} 现在不能注水（${STATE_CN[t.state]}）`);
    t.state = 'FLOODING'; t.prog = 0; SD.spike(5, 6, '注水'); SD.audio.click(.25, 300);
    SD.say('鱼雷舱', `${id} 注水`);
  } else if (act === 'OPEN') {
    if (t.state !== 'FLOODED') return SD.say('鱼雷舱', `${id} 先注水再开管门`);
    if (!S.breakers.TUBE.on) return SD.say('鱼雷舱', '鱼雷管没有预热。ELEC 里合上 TUBE');
    t.state = 'OPENING'; t.prog = 0; SD.spike(9, 8, '管门');
    SD.audio.relay(); SD.audio.click(.3, 200);
    SD.say('鱼雷舱', `${id} 开管门。对面能听到这个声音`);
  } else if (act === 'CLOSE') {
    if (t.state !== 'READY' && t.state !== 'FLOODED') return;
    t.state = 'LOADED'; SD.audio.relay(); SD.spike(4, 4, '排水');
    SD.say('鱼雷舱', `${id} 关管门、排水`);
  } else if (act === 'PREP') {
    // 一键走完注水 + 开管门
    if (t.state === 'LOADED') { SD.tubeAct(id, 'FLOOD'); t.autoOpen = true; }
    else if (t.state === 'FLOODED') SD.tubeAct(id, 'OPEN');
  }
  SD.emit('weapons');
};

// 各步骤所需时间（艇上秒）
const DUR = { LOADING: null, FLOODING: 40, OPENING: 20 };
SD.addSystem(sdt => {
  for (const [id, t] of Object.entries(S.tubes)) {
    if (!busy(t)) continue;
    const need = t.state === 'LOADING' ? SD.WEAPONS[t.type].load : DUR[t.state];
    t.prog += sdt / need;
    if (t.prog >= 1) {
      t.prog = 0;
      if (t.state === 'LOADING') { t.state = 'LOADED'; SD.say('鱼雷舱', `${id} 装填完毕，${t.type}`); }
      else if (t.state === 'FLOODING') { t.state = 'FLOODED'; if (t.autoOpen) { t.autoOpen = false; SD.tubeAct(id, 'OPEN'); } }
      else if (t.state === 'OPENING') { t.state = 'READY'; SD.say('鱼雷舱', `${id} 管门已开，待发`); SD.audio.beep(760, .08); }
      SD.emit('weapons');
    }
  }
  // 鱼雷航行
  for (const r of S.runs) {
    const w = SD.WEAPONS[r.type];
    r.dist += w.speed * .0005144 * sdt;
    r.t += sdt;
    if (r.guide === 'WIRE' && r.wire && r.dist > w.range * .6 && Math.random() < .0008 * sdt) { r.wire = false; SD.say('火控', `${r.tube} 导线断了，转为直航`); }
    if (r.dist >= Math.min(r.run, w.range) || r.done) r.done = true;
  }
  const finished = S.runs.filter(r => r.done && !r.reported);
  for (const r of finished) { r.reported = true; resolve(r); }
  S.runs = S.runs.filter(r => !r.done || r.t < r.doneAt + 60);
});

// ---------- 发射 ----------
// 返回错误信息或 null。系统按玩家标的分类决定是否允许开火
SD.fireTube = (id, brg, run) => {
  const t = S.tubes[id];
  if (!t || !t.type || t.state === 'EMPTY') return `${id} 管内没有东西`;
  if (t.state !== 'READY') return `${id} 还没准备好（${STATE_CN[t.state]}）。先 PREP：注水 + 开管门`;
  const w = SD.WEAPONS[t.type];
  const c = SD.contact(S.selected);
  const needsTarget = !['DECOY', 'MINE'].includes(w.guide);
  if (needsTarget && c.cls !== 'HOSTILE') { SD.audio.alarm(); return `WEAPONS HOLD：${c.id} 分类为 ${SD.CLS_CN[c.cls]}。先在 CONTACT LOG 里改分类`; }
  const b = brg != null ? brg : needsTarget ? Math.round(SD.bearingTo(S.own.x, S.own.y, c.x, c.y)) : SD.norm(S.hdg + 180);
  S.runs.push({ tube: id, type: t.type, guide: w.guide, brg: b, run: (run || w.range * 1000) / 1000, dist: 0, t: 0, target: needsTarget ? c.id : null, wire: w.guide === 'WIRE', x0: S.own.x, y0: S.own.y });
  SD.spike(w.noise, w.guide === 'STRAIGHT' ? 20 : 6, '发射');
  t.state = 'EMPTY'; t.type = null;
  SD.audio.relay(); SD.audio.beep(90, .6, .15, 'sawtooth');
  if (w.guide === 'STRAIGHT') { SD.audio.beep(60, 1.2, .2, 'sawtooth'); SD.exposure = 100; }
  SD.say('火控', `${id} 发射 ${w.cn}，方位 ${SD.pad(b)}${w.guide === 'DECOY' ? '，诱饵开始回放本艇噪声' : ''}`);
  SD.emit('weapons');
  return null;
};

// 齐射组合：按间隔依次发射，每发加一点散布
SD.fireSalvo = sid => {
  const sv = S.salvos.find(s => s.id === (sid || S.salvoSel)); if (!sv) return SD.say('火控', `没有组合 ${sid}`);
  const c = SD.contact(S.selected);
  const base = Math.round(SD.bearingTo(S.own.x, S.own.y, c.x, c.y));
  const ready = sv.tubes.filter(SD.tubeReady);
  if (!ready.length) return SD.say('火控', `组合 ${sv.id} 没有待发的管。先 PREP`);
  SD.say('火控', `组合 ${sv.id}「${sv.name}」：${ready.join(' ')} 依次发射`);
  ready.forEach((id, i) => setTimeout(() => {
    const off = ready.length > 1 ? (i - (ready.length - 1) / 2) * (sv.spread / Math.max(1, ready.length - 1)) * 2 : 0;
    const err = SD.fireTube(id, SD.norm(base + off));
    if (err) SD.say('火控', err);
  }, i * sv.gap * 1000 / Math.max(1, SD.TIME / 20)));
  if (sv.evade) { S.hdgOrd = SD.norm(S.hdg + 120); S.spdOrd = 14; SD.say('操舵', '右满舵，全速规避'); }
};

// 命中结算（示意）
function resolve(r) {
  r.doneAt = r.t;
  const w = SD.WEAPONS[r.type];
  if (!r.target) {
    if (r.guide === 'DECOY') SD.say('声呐', '诱饵耗尽。它们有没有上当，不知道');
    return;
  }
  const c = SD.contact(r.target);
  const err = Math.abs(((SD.bearingTo(r.x0, r.y0, c.x, c.y) - r.brg + 540) % 360) - 180);
  const tol = { WIRE: r.wire ? 25 : 8, PASSIVE: c.kind === 'echo' ? 3 : 18, STRAIGHT: 6 }[r.guide] || 8;
  const inRange = SD.dist(r.x0, r.y0, c.x, c.y) <= w.range;
  const hit = !c.hidden && inRange && err < tol;
  const truth = { sub: '舰队协约 巡逻艇', rust: '锈帮改装艇', echo: '回声体', whale: '哀歌鲸' }[c.kind];
  SD.report({
    title: 'ENGAGEMENT REPORT',
    rows: [['目标', c.id], ['发射管 / 型号', `${r.tube} / ${r.type}`], ['制导', SD.GUIDE_CN[r.guide] + (r.guide === 'WIRE' && !r.wire ? '（断线）' : '')],
      ['结果', hit ? '命中' : inRange ? '未命中' : '超出射程'], ['事后确认', hit ? truth : '未知'], ['剩余可用', SD.loadedCount() + Object.values(S.magazine).reduce((a, b) => a + b, 0)]],
    note: hit && (c.kind === 'sub' || c.kind === 'whale') ? '声纹库更新。你标错了。'
      : !hit && r.guide === 'PASSIVE' && c.kind === 'echo' ? '被动自导找不到任何机械噪声。它不是机器。'
      : hit ? '水里只剩下回声。' : '它现在知道你在哪了。',
  });
  if (hit) { c.hidden = true; SD.audio.degauss(); SD.emit('select'); }
}

// ---------- WEAPONS 界面 ----------
SD.register({
  code: 'WEAPONS', cn: '武器系统', ph: 'amber', fkey: 'F5',
  create(root) {
    root.innerHTML = `
      <div class="mod-title"><span>WEAPONS // 武器系统 · 鱼雷舱</span><span class="wp-tgt"></span></div>
      <div class="mod-body wp-body" style="overflow:auto"></div>`;
    const body = root.querySelector('.wp-body'), tgtEl = root.querySelector('.wp-tgt');
    let pickTube = null;        // 正在为哪具管选型号
    let editSalvo = false;

    const stateBar = t => {
      if (!busy(t)) return '';
      const n = Math.round(t.prog * 10);
      return ` <span class="dim">[${'█'.repeat(n)}${'░'.repeat(10 - n)}]</span>`;
    };
    const actions = (id, t) => {
      if (t.dmg) return '<span class="hot">DAMAGED</span>';
      if (busy(t)) return '';
      const b = [];
      if (t.state === 'EMPTY') b.push(`<span class="btn" data-pick="${id}">LOAD ▾</span>`);
      if (t.state === 'LOADED') b.push(`<span class="btn" data-t="${id}" data-a="PREP">PREP</span>`, `<span class="btn" data-t="${id}" data-a="UNLOAD">UNLOAD</span>`);
      if (t.state === 'FLOODED') b.push(`<span class="btn" data-t="${id}" data-a="OPEN">OPEN</span>`, `<span class="btn" data-t="${id}" data-a="CLOSE">DRAIN</span>`);
      if (t.state === 'READY') b.push(`<span class="btn hot" data-fire="${id}">FIRE</span>`, `<span class="btn" data-t="${id}" data-a="CLOSE">CLOSE</span>`);
      return b.join('');
    };

    function draw() {
      const c = SD.contact(S.selected);
      const tubes = Object.entries(S.tubes).map(([id, t]) => {
        const w = t.type && SD.WEAPONS[t.type];
        const icon = { EMPTY: '[    ]', LOADING: '[▒▒  ]', LOADED: '[████]', FLOODING: '[≈███]', FLOODED: '[≈≈██]', OPENING: '[≈≈█>', READY: '[≈≈█>>' }[t.state];
        return `<tr class="${t.state === 'READY' ? 'sel' : ''}">
          <td>${id}</td><td class="art" style="font-size:12px">${icon}</td>
          <td>${t.type || '<span class="dim">—</span>'}</td>
          <td class="cnf">${w ? w.cn : ''}</td>
          <td class="cnf ${t.state === 'READY' ? 'hot' : ''}">${STATE_CN[t.state]}${stateBar(t)}</td>
          <td>${actions(id, t)}</td></tr>`;
      }).join('');

      const picker = pickTube ? `
        <div class="sep"></div>
        <div>LOAD ${pickTube} ← <span class="cnf dim">选择型号</span> <span class="btn cnf" data-pick="">取消</span></div>
        <table class="data">${Object.entries(SD.WEAPONS).map(([k, w]) => `
          <tr data-load="${k}" class="${S.magazine[k] ? '' : 'dim'}"><td>${k}</td><td class="cnf">${w.name}</td><td>×${S.magazine[k]}</td>
          <td>${w.range ? w.range + 'KM' : '--'}</td><td>${w.speed ? w.speed + 'KN' : '--'}</td><td class="${w.noise >= 15 ? 'hot' : ''}">+${w.noise}dB</td></tr>
          <tr><td></td><td colspan="5" class="cn dim" style="white-space:normal">${w.note}</td></tr>`).join('')}</table>` : '';

      const mag = Object.entries(S.magazine).map(([k, n]) => `<span>${k} <span class="${n ? '' : 'hot'}">×${n}</span></span>`).join('  ');

      const salvos = S.salvos.map(s => `
        <div class="pw-row ${s.id === S.salvoSel ? 'sel' : ''}" data-salvo="${s.id}">
          <span>[${s.id}]</span><span class="cnf" style="width:8em">${s.name}</span>
          <span>${s.tubes.map(t => SD.tubeReady(t) ? `<span class="inv">${t}</span>` : `<span class="dim">${t}</span>`).join(' ')}</span>
          <span class="dim">Δ${s.gap}s ±${s.spread}°${s.evade ? ' +规避' : ''}</span>
        </div>`).join('');
      const cur = S.salvos.find(s => s.id === S.salvoSel);
      const editor = editSalvo && cur ? `
        <div class="cn dim">编辑组合 ${cur.id}：点击发射管加入 / 移出</div>
        <div>${Object.keys(S.tubes).map(t => `<span class="btn ${cur.tubes.includes(t) ? 'on' : ''}" data-edit="${t}">${t}</span>`).join('')}
          <span class="dim">间隔</span> <span class="btn" data-gap="-1">−</span>${cur.gap}s<span class="btn" data-gap="1">+</span>
          <span class="dim">散布</span> <span class="btn" data-spr="-2">−</span>${cur.spread}°<span class="btn" data-spr="2">+</span></div>` : '';

      const runs = S.runs.filter(r => !r.done).map(r => `<div>${r.tube} ${r.type} <span class="dim">BRG ${SD.pad(r.brg)}</span> ${(r.dist).toFixed(1)}/${Math.min(r.run, SD.WEAPONS[r.type].range).toFixed(0)}KM ${r.guide === 'WIRE' ? (r.wire ? '<span class="cnf">线导中</span>' : '<span class="hot cnf">断线</span>') : ''}</div>`).join('');
      const perm = c.cls === 'HOSTILE' ? '<span class="hot">WEAPONS FREE</span>' : `<span>WEAPONS HOLD</span> <span class="cnf dim">(${SD.CLS_CN[c.cls]})</span>`;

      SD.html(body, `
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px">
          <span>TGT <span class="inv">${c.id}</span> ${perm}</span>
          <span>TUBE PWR ${S.breakers.TUBE.on ? 'ON' : '<span class="hot">OFF</span>'}</span>
        </div>
        <table class="data" style="margin-top:4px"><tr><th>TUBE</th><th></th><th>TYPE</th><th></th><th>STATE</th><th></th></tr>${tubes}</table>
        ${picker}
        <div class="sep"></div>
        <div class="cn dim">弹药舱</div><div style="display:flex;flex-wrap:wrap;gap:0 14px">${mag}</div>
        <div class="sep"></div>
        <div style="display:flex;justify-content:space-between"><span class="cn">发射组合</span>
          <span><span class="btn cnf" data-act="edit">${editSalvo ? "完成" : "编辑"}</span><span class="btn cnf" data-act="new">+ 新组合</span><span class="btn hot" data-act="salvo">SALVO ${S.salvoSel} ▶</span></span></div>
        ${salvos}${editor}
        ${runs ? `<div class="sep"></div><div class="cn dim">航行中</div>${runs}` : ''}`);
      tgtEl.textContent = `LOADED ${SD.loadedCount()}/4`;
    }

    body.addEventListener('pointerdown', e => {
      const d = e.target.closest('[data-pick],[data-t],[data-fire],[data-load],[data-salvo],[data-act],[data-edit],[data-gap],[data-spr]');
      if (!d) return;
      const ds = d.dataset;
      SD.audio.key();
      if ('pick' in ds) pickTube = ds.pick || null;
      else if (ds.load) { if (S.magazine[ds.load]) { SD.tubeAct(pickTube, 'LOAD', ds.load); pickTube = null; } }
      else if (ds.t) SD.tubeAct(ds.t, ds.a);
      else if (ds.fire) { const err = SD.fireTube(ds.fire); if (err) SD.say('火控', err); }
      else if (ds.salvo) S.salvoSel = ds.salvo;
      else if (ds.act === 'salvo') SD.fireSalvo();
      else if (ds.act === 'edit') editSalvo = !editSalvo;
      else if (ds.act === 'new') {
        const id = String.fromCharCode(65 + S.salvos.length);
        S.salvos.push({ id, name: '自定义 ' + id, tubes: [], gap: 3, spread: 4 }); S.salvoSel = id; editSalvo = true;
      } else {
        const cur = S.salvos.find(s => s.id === S.salvoSel);
        if (ds.edit) cur.tubes = cur.tubes.includes(ds.edit) ? cur.tubes.filter(t => t !== ds.edit) : [...cur.tubes, ds.edit].sort();
        if (ds.gap) cur.gap = SD.clamp(cur.gap + +ds.gap, 0, 15);
        if (ds.spr) cur.spread = SD.clamp(cur.spread + +ds.spr, 0, 30);
      }
      draw();
    });

    SD.on('weapons', draw); SD.on('select', draw);
    draw();
    let t = 0;
    return {
      tick(dt) { t += dt; if (t > .3) { t = 0; draw(); } },
      key(e) {
        if (/^[1-4]$/.test(e.key)) { SD.tubeAct('T' + e.key, 'PREP'); return true; }
        if (e.key === 'Enter') { SD.fireSalvo(); return true; }
      },
    };
  },
});
})();
