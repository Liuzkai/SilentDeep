/* 主程序：BOOT 自检、控制台管理、状态栏、命令行、内部广播、REPORT 弹窗、剧情演示 */

(() => {
const S = SD.state, $ = SD.$;
SD.TIME = 20;   // 时间压缩倍率：原型里让航行和方位变化快一点

// ---------- 内部广播 ----------
// 带失真的短句。可选用浏览器语音朗读（VOICE ON）
let voiceOn = false, sayQueue = [], saying = false;
SD.say = (who, text) => { sayQueue.push([who, text]); if (!saying) nextSay(); };
function nextSay() {
  const item = sayQueue.shift(); if (!item) { saying = false; return; }
  saying = true;
  const [who, text] = item, el = $('#broadcast');
  SD.audio.squelch();
  let i = 0;
  const step = () => {
    el.innerHTML = `<span class="who">[${who}]</span> <span class="cnf">${text.slice(0, i)}</span><span class="blink">_</span>`;
    if (i++ < text.length) setTimeout(step, 28);
    else setTimeout(nextSay, 900 + text.length * 30);
  };
  step();
  if (voiceOn && window.speechSynthesis) {
    const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; u.rate = 1.15; u.pitch = .6; u.volume = S.silent ? .3 : .7;
    speechSynthesis.speak(u);
  }
}

// ---------- REPORT 弹窗（参考 04） ----------
let reportOpen = null;
SD.report = ({ title, rows = [], note = '', choices = [] }) => {
  const noise = $('#report-noise');
  const cols = Math.ceil(innerWidth / 8), lines = Math.ceil(innerHeight / 14);
  let s = '';
  for (let y = 0; y < lines; y++) { for (let x = 0; x < cols; x++) s += Math.sin(x * .13 + y * .21) + Math.sin(x * .05 - y * .09) > .3 ? '▒░▓#'[Math.random() * 4 | 0] : ' '; s += '\n'; }
  noise.textContent = s;
  const all = choices.length ? choices : [{ label: 'ACKNOWLEDGE', fn: () => {} }];
  $('#report-body').innerHTML = `<h2>${title}</h2>
    ${rows.map(([k, v]) => `<div class="row"><span class="cnf">${k}:</span><span>${v}</span></div>`).join('')}
    ${note ? `<div class="cnf" style="margin-top:12px;text-align:center;opacity:.8">${note}</div>` : ''}
    <div class="choices">${all.map((c, i) => `<span class="btn" data-i="${i}">[${i + 1}] <span class="cnf">${c.label}</span></span>`).join('')}</div>`;
  $('#report').hidden = false; SD.audio.beep(440, .12); SD.audio.beep(660, .12);
  reportOpen = all;
};
const closeReport = i => {
  if (!reportOpen) return;
  const c = reportOpen[i] || reportOpen[0];
  $('#report').hidden = true; reportOpen = null; SD.audio.relay(); c.fn && c.fn();
};
$('#report').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) closeReport(+b.dataset.i); });

// ---------- 控制台 ----------
// 艇上只有 2~3 台能用的终端，同时只能看几个界面
const consoles = [];
let focus = 0;
const BURNIN = ` ████ ALERT ████\nNUCLEAR RELEASE\nAUTHENTICATED\n  2041.08.06\n  04:12 ZULU`;

function buildConsoles(n) {
  const wrap = $('#consoles'); wrap.innerHTML = ''; wrap.className = 'n' + n;
  const initial = ['TACPLOT', 'SONAR', 'CONTACT LOG'];
  consoles.length = 0;
  for (let i = 0; i < n; i++) {
    const el = SD.h('div', 'console');
    el.innerHTML = `<div class="bezel"><span><i class="led"></i>CON-${i + 1}</span><span class="bz-mod"></span><span class="bz-f"></span></div><div class="crt screen-el"></div>`;
    wrap.appendChild(el);
    const con = { i, el, scr: el.querySelector('.crt'), mod: null, inst: null, code: null, damaged: false, dead: false, frame: 0 };
    el.addEventListener('mousedown', () => setFocus(i));
    consoles.push(con);
    openOn(con, prev[i] || initial[i]);
  }
  setFocus(Math.min(focus, n - 1));
}
const prev = [];

function openOn(con, code) {
  const def = SD.modules[code]; if (!def) return;
  if (con.code) SD.off(con);
  con.code = code; prev[con.i] = code;
  con.scr.setAttribute('data-ph', def.ph);
  con.scr.innerHTML = '';
  if (con.i === 0) con.scr.appendChild(SD.h('div', 'burnin', BURNIN));   // 烧屏只在 1 号终端
  const root = SD.h('div', 'mod'); con.scr.appendChild(root);
  SD._owner = con; con.inst = def.create(root, con) || {}; SD._owner = null;
  con.root = root;
  con.el.querySelector('.bz-mod').textContent = code;
  con.el.querySelector('.bz-f').textContent = def.fkey || '';
  applyDamage(con);
  SD.audio.click(.2, 600);
  renderHints();
}

SD.openModule = code => {
  const open = consoles.find(c => c.code === code && !c.dead);
  if (open) { setFocus(open.i); return; }
  const con = consoles[focus];
  if (con.dead) { SD.say('系统', `CON-${con.i + 1} 没有信号`); return; }
  openOn(con, code);
};

function setFocus(i) {
  focus = i;
  consoles.forEach(c => c.el.classList.toggle('focus', c.i === i));
  renderHints();
}

function applyDamage(con) {
  con.el.classList.toggle('damaged', con.damaged);
  con.el.classList.toggle('dead', con.dead);
  con.scr.querySelectorAll('.nosignal,.dmg-overlay').forEach(e => e.remove());
  if (con.dead) {
    const ns = SD.h('div', 'nosignal', `<canvas class="static fill"></canvas><div>NO SIGNAL</div><div class="cn dim">CON-${con.i + 1} 断电 · ELEC 里合上 CON3 断路器</div>`);
    con.scr.appendChild(ns);
  } else if (con.damaged) {
    const ov = SD.h('div', 'dmg-overlay');
    ov.style.cssText = 'position:absolute;left:0;right:0;bottom:6px;z-index:4;padding:0 14px;pointer-events:none';
    con.scr.appendChild(ov);
  }
}

SD.on('con3', on => {
  const c = consoles[2]; if (!c) return;
  c.dead = !on; applyDamage(c);
  if (on) { SD.degauss(); openOn(c, c.code); }
});

// ---------- 状态栏 / 快捷键提示 ----------
function renderStatus() {
  const n = SD.noise();
  const torps = Object.entries(S.tubes).map(([k, t]) => `${k}${{ EMPTY: '□', READY: '▶', LOADING: '▒' }[t.state] || '■'}`).join(' ');
  $('#status').innerHTML = `
    <span>TACNET-7 ── SS-鲸落 ── <span class="cnf">静默纪元</span> ${S.date}</span>
    <span>${SD.timeStr()}</span>
    <span><b>DEPTH</b>${S.depth | 0}m</span>
    <span><b>HDG</b>${SD.pad(S.hdg)}</span>
    <span><b>SPD</b>${S.spd.toFixed(0)}kn</span>
    <span><b>RX</b>${S.reactor}%</span>
    <span class="${n > 110 ? 'hot' : ''}"><b>NOISE</b>${n.toFixed(0)}dB${SD.spikes.length ? ` <span class="hot cnf">▲${SD.spikes[SD.spikes.length - 1].label}</span>` : ''}</span>
    <span class="${S.hullInt < 80 ? 'hot' : ''}"><b>HULL</b>${S.hullInt.toFixed(0)}%</span>
    <span>${torps}</span>
    ${S.silent ? '<span class="inv cnf">静默航行</span>' : ''}
    ${SD.exposure > 0 ? `<span class="hot">EXPOSED ${SD.exposure | 0}</span>` : ''}
    ${S.leviathan ? '<span class="hot blink">SILENCE</span>' : ''}
    ${SD.audio.headphones ? '<span>🎧</span>' : ''}`;
}
function renderHints() {
  const cur = consoles[focus] && consoles[focus].code;
  $('#keyhints').innerHTML = Object.values(SD.modules).filter(m => m.fkey)
    .map(m => `<span class="${m.code === cur ? 'on' : ''}">${m.fkey} ${m.code}</span>`).join('')
    + '<span>TAB 切换终端</span><span>H 耳机</span><span>` 命令行</span><span>Q 按钮台</span><span>HELP</span>';
}

// ---------- 消磁 ----------
SD.degauss = () => {
  document.body.classList.add('degaussing'); $('#degauss').classList.remove('go'); void $('#degauss').offsetWidth; $('#degauss').classList.add('go');
  SD.audio.degauss();
  setTimeout(() => document.body.classList.remove('degaussing'), 900);
};

// ---------- 命令行 ----------
const cmd = $('#cmd');
const out = (t, who = 'TACNET') => SD.say(who, t);
const history = []; let hi = 0;

const HELP = [
  'F1~F9 切换界面 · TAB 切换终端 · Q 显示 / 隐藏按钮台',
  'HDG 120 / HDG +35 / SPD 8 / DEPTH 300 / SILENT / REACTOR 60',
  'SEL S-07 / NEXT / MARK / READ / PING / PHONES / CLASS S-07 HOSTILE',
  'HAIL S-03 IDENT|SIGN|TRADE|LEAVE / BREAKER TUBE ON',
  'LOAD T3 SET-65 / PREP T1 / PREP ALL / FIRE T2 BRG 118 RUN 4000 / SALVO A',
  'LEAK 2 / SEAL 2 / DC 2 / DEGAUSS / DAMAGE 2 / REPAIR 2 / CONSOLES 2',
  'CONTACT（新接触）/ LEVIATHAN / ARCHIVE / PHOSPHOR / VOICE ON / REBOOT',
];

SD.run = line => run(line);
function run(line) {
  const raw = line.trim(); if (!raw) return;
  history.push(raw); hi = history.length;
  const up = raw.toUpperCase(), [c0, ...args] = up.split(/\s+/);
  const n = parseFloat(args[0]);
  const mod = Object.keys(SD.modules).find(k => k === up || k === up.replace(/^OPEN\s+/, ''));
  if (mod) return SD.openModule(mod);
  switch (c0) {
    case 'HELP': case '?':
      SD.report({ title: 'TACNET-7 COMMANDS', rows: HELP.map((h, i) => [String(i + 1), h]) }); return;
    case 'HDG': if (!isNaN(n)) { S.hdgOrd = SD.norm(/^[+-]/.test(args[0]) ? S.hdgOrd + n : n); out(`${n > 0 && /^\+/.test(args[0]) ? '右舵，' : /^-/.test(args[0]) ? '左舵，' : ''}航向 ${SD.pad(S.hdgOrd)}，明白`, '操舵'); } return;
    case 'SPD': if (!isNaN(n)) { S.spdOrd = SD.clamp(n, 0, 25); out(`航速 ${S.spdOrd} 节`, '轮机'); } return;
    case 'DEPTH': if (!isNaN(n)) { S.depthOrd = SD.clamp(n, 20, 600); out(`下潜至 ${S.depthOrd} 米${n > 450 ? '。长官，超过安全深度了' : ''}`, '操舵'); } return;
    case 'REACTOR': if (!isNaN(n)) { S.reactor = SD.clamp(n | 0, 10, 100); SD.audio.relay(); out(`反应堆功率 ${S.reactor}%`, '轮机'); } return;
    case 'SILENT': case 'RUN': toggleSilent(); return;
    case 'SEL': case 'SELECT': if (SD.contact(args[0])) { S.selected = args[0]; SD.emit('select'); } else out(`没有 ${args[0]}`); return;
    case 'NEXT': {
      const list = SD.visibleContacts(); if (!list.length) return out('没有可选的目标', '声呐');
      const i = list.findIndex(c => c.id === S.selected);
      S.selected = list[(i + 1) % list.length].id; SD.emit('select'); SD.audio.key(); return;
    }
    case 'READ': { const c = SD.contact(S.selected); SD.takeReading(c); out(`${c.id} 读数已存档，共 ${c.history.length} 份`, '声呐'); return; }
    case 'PHONES': { const on = SD.audio.toggleHeadphones(); out(on ? '戴上耳机。左右声道对应目标相对方位' : '摘下耳机', '声呐'); return; }
    case 'MARK': SD.markBearing(args[0] || S.selected); return;
    case 'PING': SD.doPing(); return;
    case 'CLASS': {
      // CLASS HOSTILE 只给分类时，作用于当前选中目标
      const [id, cls] = SD.CLASSES.includes(args[0]) ? [S.selected, args[0]] : args;
      const c = SD.contact(id); if (c && SD.CLASSES.includes(cls)) { c.cls = cls; out(`${c.id} 分类改为 ${SD.CLS_CN[c.cls]}`, '火控'); SD.emit('select'); } else out('用法 CLASS S-07 HOSTILE'); return;
    }
    case 'HAIL': {
      const m = raw.match(/"(.+)"/);
      // HAIL IDENT 只给内容时，呼叫当前选中目标
      const [id, q] = /^S-\d+$/.test(args[0] || '') ? [args[0], args[1]] : [S.selected, args[0]];
      SD.hail(id, m ? m[1].toUpperCase() : (q || 'IDENT')); SD.openModule('COMMS'); return;
    }
    case 'FIRE': return fire(up);
    case 'LOAD': return SD.tubeAct(args[0], 'LOAD', args[1]);
    case 'UNLOAD': return SD.tubeAct(args[0], 'UNLOAD');
    case 'PREP': {
      const ids = !args[0] || args[0] === 'ALL' ? Object.keys(S.tubes).filter(t => ['LOADED', 'FLOODED'].includes(S.tubes[t].state)) : [args[0]];
      if (!ids.length) return out('没有可以准备的发射管', '鱼雷舱');
      ids.forEach(t => SD.tubeAct(t, 'PREP')); return;
    }
    case 'SALVO': return SD.fireSalvo(args[0]);
    case 'LEAK': return SD.leak(args[0]);
    case 'SEAL': { const c = S.hull.find(h => h.id === n); if (!c) return out('用法 SEAL 2'); c.sealed = !c.sealed; SD.audio.relay(); out(`${c.id} 号舱水密门${c.sealed ? '关闭' : '打开'}`, '损管'); SD.emit('hull'); return; }
    case 'DC': { S.dc = S.hull.find(h => h.id === n) ? n : null; out(S.dc ? `损管队前往 ${S.dc} 号舱` : '损管队待命', '损管'); SD.emit('hull'); return; }
    case 'QUICK': document.body.classList.toggle('no-quick'); return;
    case 'BREAKER': {
      const b = S.breakers[args[0]]; if (!b) return out('断路器：' + Object.keys(S.breakers).join(' '));
      b.on = args[1] ? args[1] === 'ON' : !b.on; SD.audio.relay();
      if (args[0] === 'CON3') SD.emit('con3', b.on);
      out(`${args[0]} ${b.on ? '合闸' : '分闸'}`, '轮机'); return;
    }
    case 'DEGAUSS': SD.degauss(); return;
    case 'DAMAGE': case 'REPAIR': {
      const con = consoles[(n || focus + 1) - 1]; if (!con) return;
      con.damaged = c0 === 'DAMAGE'; applyDamage(con);
      out(c0 === 'DAMAGE' ? `CON-${con.i + 1} 显示异常，刷新变慢` : `CON-${con.i + 1} 已修复`, '电工'); if (c0 === 'REPAIR') SD.degauss(); return;
    }
    case 'CONSOLES': if (n === 2 || n === 3) buildConsoles(n); return;
    case 'CONTACT': return newContact();
    case 'LEVIATHAN': return leviathan();
    case 'ARCHIVE': return archive();
    case 'PHOSPHOR': document.body.classList.toggle('phos-mono'); out(document.body.classList.contains('phos-mono') ? '单色磷光：所有终端统一绿色' : '分色磷光：每台设备固定一种颜色'); return;
    case 'VOICE': voiceOn = args[0] !== 'OFF'; out(voiceOn ? '广播语音开启' : '广播语音关闭'); return;
    case 'REBOOT': location.reload(); return;
    case 'TIME': if (!isNaN(n)) { SD.TIME = SD.clamp(n, 1, 120); out(`时间压缩 ×${SD.TIME}`); } return;
  }
  out(`未知命令：${raw}。输入 HELP`, 'TACNET');
  SD.audio.beep(180, .15);
}

// FIRE T2 BRG 118 RUN 4000：发射流程和开火许可都在 WEAPONS 里（mod-weapons.js）
function fire(up) {
  const m = up.match(/FIRE\s+(T\d)(?:\s+BRG\s+(\d+))?(?:\s+RUN\s+(\d+))?/);
  if (!m) return out('用法 FIRE T2 BRG 118 RUN 4000', '火控');
  const [, tube, brgS, runS] = m;
  const err = SD.fireTube(tube, brgS ? +brgS : null, runS ? +runS : null);
  if (err) out(err, '火控');
}

cmd.addEventListener('keydown', e => {
  e.stopPropagation();
  SD.audio.key(); if (S.silent) SD.typingNoise = Math.min(SD.typingNoise + .6, 8);  // 静默时打字声也计入噪声
  if (e.key === 'Enter') { run(cmd.value); cmd.value = ''; }
  else if (e.key === 'Escape') { cmd.value = ''; cmd.blur(); }
  else if (e.key === 'ArrowUp') { hi = Math.max(0, hi - 1); cmd.value = history[hi] || ''; e.preventDefault(); }
  else if (e.key === 'ArrowDown') { hi = Math.min(history.length, hi + 1); cmd.value = history[hi] || ''; e.preventDefault(); }
  else if (/^F\d$/.test(e.key)) { e.preventDefault(); fkey(e.key); }
});

function fkey(k) {
  const m = Object.values(SD.modules).find(m => m.fkey && m.fkey === k);
  if (m) SD.openModule(m.code);
}

function toggleSilent() {
  S.silent = !S.silent;
  document.body.classList.toggle('silent', S.silent);
  if (S.silent) { S.spdOrd = Math.min(S.spdOrd, 3); S.breakers.DESAL.on = false; }
  SD.say('舰长', S.silent ? '全艇静默航行。蒸馏器停机，航速三节' : '解除静默');
}

// ---------- 全局按键 ----------
window.addEventListener('keydown', e => {
  if (!$('#boot').hidden) return;
  if (reportOpen) {
    if (e.key === 'Enter' || e.key === 'Escape') closeReport(0);
    else if (/^[1-9]$/.test(e.key)) closeReport(+e.key - 1);
    e.preventDefault(); return;
  }
  if (/^F\d$/.test(e.key)) { e.preventDefault(); SD.audio.key(); return fkey(e.key); }
  if (e.key === 'Tab') { e.preventDefault(); SD.audio.key(); return setFocus((focus + 1) % consoles.length); }
  if (e.key === '`' || e.key === '/' || e.key === ':') { e.preventDefault(); return cmd.focus(); }
  if (e.key === 'h' && !e.metaKey && !e.ctrlKey) { const on = SD.audio.toggleHeadphones(); SD.say('声呐', on ? '戴上耳机。左右声道对应目标相对方位' : '摘下耳机'); return; }
  if (e.key === 's' && !e.metaKey && !e.ctrlKey) { SD.audio.key(); return toggleSilent(); }
  if (e.key === 'q' && !e.metaKey && !e.ctrlKey) { SD.audio.click(.2, 700); return document.body.classList.toggle('no-quick'); }
  const con = consoles[focus];
  if (con && con.inst && con.inst.key && !con.dead) { if (con.inst.key(e)) { SD.audio.key(); e.preventDefault(); return; } }
  if (e.key.length === 1 && /[a-z]/i.test(e.key) && !e.metaKey && !e.ctrlKey) { cmd.focus(); }
});

// ---------- 演示剧情 ----------
// 一次遭遇在各界面上的流转（ui-and-audio.md 第六节）
function newContact() {
  const c = SD.contact('S-09');
  if (!c.hidden) return out('S-09 已在跟踪');
  c.hidden = false;
  const brg = SD.bearingTo(S.own.x, S.own.y, c.x, c.y);
  SD.audio.beep(1000, .06); setTimeout(() => SD.audio.beep(1000, .06), 120);
  SD.say('声呐', `声呐报告，方位${[...SD.pad(brg)].map(d => '洞幺两三四五六拐八九'[d]).join('')}，新接触目标`);
  SD.say('声呐', '编号 S-09。只有方位线。建议转向后再测一次');
  S.selected = 'S-09'; SD.emit('select');
}

let levTimer = null;
function leviathan() {
  if (S.leviathan) return;
  // 利维坦来之前，所有声音慢慢消失，连背景噪声都没了。寂静本身是警报
  SD.say('声呐', '……背景噪声在下降');
  setTimeout(() => {
    S.leviathan = true; SD.audio.setAmbient(0);
    SD.say('声呐', '长官，什么都听不到了。连虾都不叫了');
  }, 4000);
  clearTimeout(levTimer);
  levTimer = setTimeout(() => {
    S.leviathan = false; SD.audio.setAmbient(1);
    SD.report({ title: 'CONTACT LOST', rows: [['持续时间', '4 分 12 秒'], ['声呐信号', '全部消失'], ['艇壳读数', '外部压力异常波动']], note: '它从我们下面经过了。',
      choices: [{ label: '记入航海日志', fn: () => {} }, { label: '跟上去', fn: () => SD.say('舰长', '……不。保持航向') }] });
  }, 26000);
}

function archive() {
  const con = consoles[focus];
  // 战前存档：唯一出现高饱和彩色的地方，和末世单色界面形成反差
  const ov = SD.h('div', 'archive', `<div>ARCHIVE 2041.08.05<br><span class="cnf">战前最后一次港口开放日</span><br><span class="dim">[ANY KEY]</span></div>`);
  ov.style.zIndex = 7; con.scr.appendChild(ov); SD.degauss();
  const close = () => { ov.remove(); window.removeEventListener('keydown', close, true); ov.removeEventListener('click', close); };
  setTimeout(() => { window.addEventListener('keydown', close, true); ov.addEventListener('click', close); }, 300);
}

// ---------- 主循环 ----------
let last = performance.now(), trackT = 0, secT = 0;
function loop(now) {
  const dt = Math.min(.1, (now - last) / 1000); last = now;
  const sdt = dt * SD.TIME;
  S.clock += sdt;
  // 本艇运动
  const dh = ((S.hdgOrd - S.hdg + 540) % 360) - 180;
  S.hdg = SD.norm(S.hdg + SD.clamp(dh, -.5 * sdt, .5 * sdt));
  S.spd += SD.clamp(S.spdOrd - S.spd, -.05 * sdt, .05 * sdt);
  S.depth += SD.clamp(S.depthOrd - S.depth, -.5 * sdt, .5 * sdt);
  const [nx, ny] = SD.polar(S.own.x, S.own.y, S.hdg, S.spd * .0005144 * sdt);
  S.own.x = nx; S.own.y = ny;
  S.navErr += S.spd * .0000025 * sdt + .000004 * sdt;
  for (const c of S.contacts) { c.x += c.vx / 60 * sdt; c.y += c.vy / 60 * sdt; }
  trackT += sdt; if (trackT > 30) { trackT = 0; S.track.push({ x: S.own.x, y: S.own.y }); if (S.track.length > 400) S.track.shift(); SD.chartTick(); }
  SD.exposure = Math.max(0, SD.exposure - dt * 3);
  SD.typingNoise = Math.max(0, SD.typingNoise - dt * 1.5);
  for (const fn of SD.systems) fn(sdt, dt);

  for (const con of consoles) {
    if (con.dead) { const st = con.scr.querySelector('.static'); if (st) staticNoise(st); continue; }
    con.frame++;
    if (con.damaged && con.frame % 4) continue;   // 受损终端刷新变慢
    if (con.inst && con.inst.tick) con.inst.tick(con.damaged ? dt * 4 : dt);
    if (con.damaged) {
      const ov = con.scr.querySelector('.dmg-overlay');
      if (ov && Math.random() < .2) ov.innerHTML = `<div class="hot">${SD.garble('ERR 0x3F  FRAME BUFFER PARITY  ' + SD.timeStr(), .4)}</div>`;
    }
  }
  secT += dt; if (secT > .25) { secT = 0; renderStatus(); }
  SD.audio.update();
  requestAnimationFrame(loop);
}
function staticNoise(cv) {
  const { ctx, w, h } = SD.fitCanvas(cv);
  for (let i = 0; i < 400; i++) { ctx.fillStyle = Math.random() < .5 ? '#000' : '#9a9'; ctx.fillRect(Math.random() * w, Math.random() * h, 3, 2); }
}

// ---------- BOOT ----------
const BOOT_LINES = [
  ['TACNET-7 BIOS REV 3.1.4  (C) 1987 / PATCHED 37.002', ''],
  ['MEM CHECK  640K ................', 'OK'],
  ['CORE MEMORY PARITY ..............', 'OK'],
  ['REACTOR TELEMETRY LINK ..........', 'OK'],
  ['NAV / INERTIAL PLATFORM .........', 'DEGRADED'],
  ['GPS RECEIVER ....................', 'FAIL'],
  ['SATCOM ..........................', 'FAIL'],
  ['IFF TRANSPONDER .................', 'FAIL'],
  ['SONAR ARRAY  BOW / FLANK / TOWED ', 'OK / OK / DEGRADED'],
  ['UQC UNDERWATER TELEPHONE ........', 'OK'],
  ['SIGNATURE LIBRARY  2211 ENTRIES .', 'DEGRADED  (418 CORRUPT)'],
  ['CONSOLE CON-1 ...................', 'OK'],
  ['CONSOLE CON-2 ...................', 'OK'],
  ['CONSOLE CON-3 ...................', 'OK  (BURN-IN DETECTED)'],
  ['CONSOLE CON-4 ...................', 'FAIL'],
  ['', ''],
];
function boot() {
  const log = $('#boot-log');
  log.innerHTML = `<span class="cnf">SS-鲸落</span>  TACNET-7\n\n<span class="blink">[ 按任意键通电 ]</span>\n\n<span class="dim cnf">建议戴耳机。整个界面都有声音。</span>`;
  const start = () => {
    window.removeEventListener('keydown', start); window.removeEventListener('mousedown', start);
    SD.audio.init(); SD.degauss();
    log.innerHTML = '';
    let i = 0;
    const step = () => {
      if (i >= BOOT_LINES.length) return powerMenu();
      const [a, b] = BOOT_LINES[i++];
      const cls = b.startsWith('FAIL') ? 'hot' : b.startsWith('DEGRADED') || b.includes('DEGRADED') ? '' : 'dim';
      log.innerHTML += `${a} <span class="${cls}">${b}</span>\n`;
      SD.audio.click(.1, b.startsWith('FAIL') ? 400 : 2400);
      if (b.startsWith('FAIL')) SD.audio.beep(200, .08);
      setTimeout(step, b ? SD.rand(90, 260) : 400);
    };
    setTimeout(step, 700);
  };
  window.addEventListener('keydown', start); window.addEventListener('mousedown', start);
}

// 电力不够时，玩家决定先启动哪些系统
function powerMenu() {
  const box = $('#boot-power'); box.hidden = false;
  const items = ['LIFE', 'SONAR', 'PROP', 'DESAL', 'ALGAE', 'CON3', 'TUBE'];
  const budget = 38;
  let sel = 0;
  const pick = new Set(['LIFE', 'SONAR', 'PROP']);
  const draw = () => {
    const used = [...pick].reduce((a, k) => a + S.breakers[k].load, 0);
    box.innerHTML = `<div class="cnf">反应堆冷启动：可用功率 ${budget} MW。选择先启动的系统</div>
      <div class="dim">[↑↓] 选择  [SPACE] 切换  [ENTER] 确认</div><div class="sep"></div>
      ${items.map((k, i) => { const b = S.breakers[k]; return `<div class="pw-row ${i === sel ? 'sel' : ''}" data-k="${k}"><span class="box">[${pick.has(k) ? '■' : ' '}]</span><span style="width:5em">${k}</span><span class="cnf" style="width:8em">${b.name}</span><span>${b.load} MW</span></div>`; }).join('')}
      <div class="sep"></div><div class="${used > budget ? 'hot' : ''}">LOAD ${used} / ${budget} MW ${used > budget ? '— 超载，母线会跳闸' : ''}</div>`;
  };
  const toggle = k => { pick.has(k) ? pick.delete(k) : pick.add(k); SD.audio.relay(); draw(); };
  const done = () => {
    const used = [...pick].reduce((a, k) => a + S.breakers[k].load, 0);
    if (used > budget) { SD.audio.alarm(); return; }
    window.removeEventListener('keydown', onKey);
    for (const k of items) S.breakers[k].on = pick.has(k);
    enter();
  };
  const onKey = e => {
    e.preventDefault();
    if (e.key === 'ArrowDown') sel = (sel + 1) % items.length;
    else if (e.key === 'ArrowUp') sel = (sel + items.length - 1) % items.length;
    else if (e.key === ' ') return toggle(items[sel]);
    else if (e.key === 'Enter') return done();
    SD.audio.key(); draw();
  };
  box.addEventListener('click', e => { const r = e.target.closest('[data-k]'); if (r) toggle(r.dataset.k); });
  box.addEventListener('dblclick', done);
  window.addEventListener('keydown', onKey);
  draw();
}

function enter() {
  $('#boot').hidden = true; $('#app').hidden = false;
  SD.degauss();
  buildConsoles(3);
  if (!S.breakers.CON3.on) SD.emit('con3', false);
  renderStatus();
  requestAnimationFrame(t => { last = t; loop(t); });
  SD.say('TACNET', '系统就绪。F1~F9 切换界面，TAB 切换终端，下方按钮台是常用命令，输入 HELP 查看全部');
  // 45 秒后出现新接触目标，演示一次识别遭遇
  setTimeout(newContact, 45000);
}

// ?skip 跳过开机
if (location.search.includes('skip')) {
  $('#boot').hidden = true;
  window.addEventListener('mousedown', () => SD.audio.init(), { once: true });
  window.addEventListener('keydown', () => SD.audio.init(), { once: true });
  enter();
} else boot();
})();
