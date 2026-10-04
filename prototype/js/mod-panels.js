/* CONTACT LOG 接触目标日志 / ELEC 电力与反应堆 / COMMS 水声通讯 */

(() => {
const S = SD.state;

// ---------- CONTACT LOG ----------
// 分类由玩家手动改，开火许可跟着分类走。标错了后果自负
SD.register({
  code: 'CONTACT LOG', cn: '接触目标日志', ph: 'green', fkey: 'F3',
  create(root) {
    root.innerHTML = `<div class="mod-title"><span>CONTACT LOG // 接触目标</span><span class="dim">[↑↓] 选择 [C] 改分类</span></div><div class="mod-body cl-body" style="overflow:auto"></div>`;
    const body = root.querySelector('.cl-body');
    function draw() {
      const list = SD.visibleContacts();
      const rows = list.map(c => {
        const brg = SD.bearingTo(S.own.x, S.own.y, c.x, c.y);
        const weapons = c.cls === 'HOSTILE' ? '<span class="hot">FREE</span>' : c.cls === 'UNKNOWN' ? 'HOLD' : '<span class="dim">SAFE</span>';
        return `<tr class="${c.id === S.selected ? 'sel' : ''}" data-id="${c.id}">
          <td>${c.id}</td><td>${SD.pad(brg)}</td><td>${c.rngEst ? '~' + c.rngEst.toFixed(1) : '--'}</td>
          <td><span class="btn" data-cls="${c.id}">${c.cls}</span></td>
          <td class="cnf">${c.match[0]} ${c.match[1]}%</td><td>${weapons}</td></tr>`;
      }).join('');
      body.innerHTML = list.length
        ? `<table class="data"><tr><th>ID</th><th>BRG</th><th>RNG</th><th>CLASS</th><th>MATCH</th><th>WPN</th></tr>${rows}</table>
           <div class="sep"></div><div class="cn dim">WPN = 按你标的分类给出的开火许可。系统不会替你判断。</div>`
        : `<div class="hot" style="margin-top:30px;text-align:center">NO CONTACTS<br><span class="cn">所有信号都消失了</span></div>`;
    }
    const cycle = id => {
      const c = SD.contact(id); c.cls = SD.CLASSES[(SD.CLASSES.indexOf(c.cls) + 1) % SD.CLASSES.length];
      SD.audio.relay(); SD.say('火控', `${c.id} 分类改为 ${SD.CLS_CN[c.cls]}`);
      if (c.cls === 'HOSTILE' && c.kind === 'whale') SD.say('声呐', '……长官，那是哀歌鲸');
      draw();
    };
    body.addEventListener('pointerdown', e => {
      if (e.target.dataset.cls) return cycle(e.target.dataset.cls);
      const tr = e.target.closest('tr[data-id]'); if (tr) { S.selected = tr.dataset.id; SD.audio.key(); SD.emit('select'); }
    });
    SD.on('select', draw); draw();
    let t = 0;
    return {
      tick(dt) { t += dt; if (t > 1) { t = 0; draw(); } },
      key(e) {
        const list = SD.visibleContacts(), i = list.findIndex(c => c.id === S.selected);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          const n = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
          if (n) { S.selected = n.id; SD.emit('select'); } return true;
        }
        if (e.key === 'c') { cycle(S.selected); return true; }
      },
    };
  },
});

// ---------- ELEC ----------
// 反应堆功率 + 母线 + 断路器。功率越高，能力越强，噪声也越大
SD.register({
  code: 'ELEC', cn: '电力与反应堆', ph: 'amber', fkey: 'F4',
  create(root) {
    root.innerHTML = `<div class="mod-title"><span>ELEC // 电力分配 · 反应堆</span><span class="el-noise"></span></div><div class="mod-body el-body" style="overflow:auto"></div>`;
    const body = root.querySelector('.el-body'), noiseEl = root.querySelector('.el-noise');
    function draw() {
      const cap = Math.round(S.reactor * 1.2), used = SD.powerUsed(), over = used > cap;
      const bars = n => '█'.repeat(Math.round(n / 5)) + '░'.repeat(20 - Math.round(n / 5));
      const rows = Object.entries(S.breakers).map(([k, b]) => `
        <div class="pw-row" data-br="${k}">
          <span>${b.on ? '─┤■├─' : '─┤ ├─'}</span>
          <span style="width:5.5em">${k}</span>
          <span class="cnf" style="width:7em">${b.name}</span>
          <span style="width:4em">${b.on ? b.load : 0} MW</span>
          <span class="${b.noise >= 6 && b.on ? 'hot' : 'dim'}">+${b.noise}dB</span>
          ${b.critical && !b.on ? '<span class="hot blink">!</span>' : ''}
        </div>`).join('');
      SD.html(body, `
        <div class="art">  ┌──────────┐    ┌─────────┐
  │ REACTOR  ├────┤ TURBINE ├──┬── MAIN BUS ${over ? '<span class="hot blink">OVERLOAD</span>' : 'NOMINAL'}
  │   ${SD.pad(S.reactor)}%   │    │ ${SD.pad(cap)} MW  │  │
  └──────────┘    └─────────┘  │</div>
        <div>OUTPUT [${bars(S.reactor)}] <span class="btn" data-r="-5">−</span><span class="btn" data-r="5">+</span>  LOAD ${used}/${cap} MW</div>
        <div class="sep"></div>
        <div class="dim cn">点击断路器开 / 合（继电器声）</div>
        ${rows}
        <div class="sep"></div>
        <div class="cn">本艇辐射噪声 <span class="${SD.noise() > 110 ? 'hot' : ''}">${SD.noise().toFixed(0)} dB</span>
          ${SD.noise() > 110 ? ' · 低频泵噪声会把东西引过来' : ''}</div>`);
      noiseEl.innerHTML = `NOISE ${SD.noise().toFixed(0)} dB`;
    }
    body.addEventListener('pointerdown', e => {
      const r = e.target.dataset.r;
      if (r) { S.reactor = SD.clamp(S.reactor + +r, 10, 100); SD.audio.click(.15, 1200); draw(); return; }
      const row = e.target.closest('[data-br]'); if (!row) return;
      const b = S.breakers[row.dataset.br]; b.on = !b.on; SD.audio.relay();
      if (row.dataset.br === 'TUBE' && b.on) SD.say('鱼雷舱', '鱼雷管开始预热，噪声加十二分贝');
      if (row.dataset.br === 'LIFE' && !b.on) { SD.say('轮机', '生命维持断电！二氧化碳开始上升'); SD.audio.alarm(); }
      if (row.dataset.br === 'SONAR') SD.say('声呐', b.on ? '声呐阵列上线' : '声呐阵列断电，我们聋了');
      if (row.dataset.br === 'CON3') SD.emit('con3', b.on);
      draw();
    });
    draw();
    let t = 0;
    return { tick(dt) { t += dt; if (t > .5) { t = 0; draw(); } } };
  },
});

// ---------- COMMS 水声通讯 ----------
// UQC 水下电话 / 敲艇壳发摩尔斯码。回声体的回应太快、节奏完全一样
const MORSE = { A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.' };
SD.morse = s => s.toUpperCase().split('').map(c => MORSE[c] || (c === ' ' ? '/' : '')).join(' ');

SD.register({
  code: 'COMMS', cn: '水声通讯', ph: 'amber', fkey: 'F8',
  create(root) {
    root.innerHTML = `
      <div class="mod-title"><span>COMMS // UQC 水下电话 · 敲击</span><span class="cm-tgt"></span></div>
      <div class="mod-body" style="display:grid;grid-template-rows:1fr auto;gap:6px">
        <div class="cm-log" style="overflow:auto"></div>
        <div>
          <div><span class="btn" data-q="IDENT">报旧日呼号</span><span class="btn" data-q="SIGN">问暗号</span><span class="btn" data-q="TRADE">请求交易</span><span class="btn" data-q="LEAVE">警告离开</span></div>
          <div class="cn dim">也可以在命令行输入 HAIL S-03 "内容"</div>
        </div>
      </div>`;
    const log = root.querySelector('.cm-log'), tgtEl = root.querySelector('.cm-tgt');
    const render = () => { log.innerHTML = commsLines.join(''); log.scrollTop = 1e6; };
    SD.on('comms', render); render();
    root.addEventListener('pointerdown', e => { if (e.target.dataset.q) { SD.audio.key(); SD.hail(S.selected, e.target.dataset.q); } });
    return { tick() { tgtEl.textContent = 'TGT ' + S.selected; } };
  },
});

// 通讯记录放在模块外，面板没打开时命令行 HAIL 也能用
const commsLines = [];
const push = (who, text, cls = '') => {
  commsLines.push(`<div class="${cls}"><span class="dim">${SD.timeStr()} ${who}</span> ${text}</div>`);
  if (commsLines.length > 40) commsLines.shift();
  SD.emit('comms');
};
push('SYS', 'UQC 待命。选中目标后发送。', 'dim');
{
    const REPLY = {
      sub: { IDENT: 'HOTEL-ECHO 4', SIGN: 'TIDE RED', TRADE: 'NEGATIVE. STATE YOUR FLEET', LEAVE: 'ACK. MAINTAINING DISTANCE' },
      rust: { IDENT: 'HOTEL-ECHO 4', SIGN: '...REPEAT', TRADE: 'FUEL FOR CHARTS. APPROACH 2KM', LEAVE: 'NO' },
      echo: { IDENT: 'HOTEL-ECHO 4', SIGN: 'TIDE RED', TRADE: 'APPROACH', LEAVE: 'APPROACH' },
    };
    SD.hail = (id, q) => {
      const c = SD.contact(id);
      if (!c || c.hidden || S.leviathan) { push('UQC', `${id} 无回应`, 'dim'); return; }
      const text = q.length > 6 ? q : { IDENT: 'IDENTIFY. OLD CALLSIGN', SIGN: 'CHALLENGE: TIDE', TRADE: 'REQUEST TRADE', LEAVE: 'WITHDRAW OR BE ENGAGED' }[q] || q;
      push('>> ' + id, `${text}<br><span class="dim">${SD.morse(text.slice(0, 14))}</span>`);
      SD.audio.beep(700, .05); SD.typingNoise += 2;
      if (c.kind === 'whale') { setTimeout(() => push(id, '（低频歌声。不是回答。）', 'cn'), 2500); return; }
      const r = (REPLY[c.kind] || REPLY.sub)[q] || 'SAY AGAIN';
      // 回声体：几乎立刻回应，每次节奏都一样
      const delay = c.kind === 'echo' ? 350 : SD.rand(2500, 5000);
      setTimeout(() => {
        push('<< ' + id, `${r}<br><span class="dim">${SD.morse(r.slice(0, 14))}</span>`);
        for (let i = 0; i < 4; i++) setTimeout(() => SD.audio.click(.18, 500), i * (c.kind === 'echo' ? 120 : SD.rand(90, 180)));
        if (c.kind === 'echo') setTimeout(() => push('声呐', `回应间隔 ${(delay / 1000).toFixed(2)}s。太快了。敲击节奏和上次完全一致。`, 'hot cn'), 900);
      }, delay);
    };
}
})();
