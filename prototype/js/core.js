/* TACNET-7 核心：全局状态、工具函数、音频引擎、模块注册
 * 这是 UI 交互原型，数值都是摆样子的，不是真实玩法 */

const SD = window.SD = {};

// ---------- 工具 ----------
SD.$ = (s, r = document) => r.querySelector(s);
SD.h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
// 定时重绘的面板用它：内容没变就不动 DOM，免得吞掉点击和 hover
SD.html = (el, s) => { if (el._html !== s) { el._html = s; el.innerHTML = s; } };
SD.pad = (n, w = 3) => String(Math.round(n)).padStart(w, '0');
SD.norm = a => ((a % 360) + 360) % 360;
SD.rand = (a, b) => a + Math.random() * (b - a);
SD.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
SD.rad = d => d * Math.PI / 180;
// 方位角 → 平面坐标（北为上，km）
SD.polar = (x, y, brg, r) => [x + Math.sin(SD.rad(brg)) * r, y + Math.cos(SD.rad(brg)) * r];
SD.bearingTo = (x0, y0, x1, y1) => SD.norm(Math.atan2(x1 - x0, y1 - y0) * 180 / Math.PI);
SD.dist = (x0, y0, x1, y1) => Math.hypot(x1 - x0, y1 - y0);
SD.phColor = el => getComputedStyle(el).getPropertyValue('--ph').trim() || '#5cff8a';
SD.phRGB = el => getComputedStyle(el).getPropertyValue('--ph-rgb').trim() || '92,255,138';

// 设备损坏时的乱码
const GARBLE = '░▒▓#%&@$?¿§¤×ΞΨ';
SD.garble = (s, p) => s.replace(/[^\s]/g, c => Math.random() < p ? GARBLE[Math.random() * GARBLE.length | 0] : c);

// 画布尺寸跟随容器，处理高分屏
SD.fitCanvas = cv => {
  const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  const w = Math.max(1, r.width * d | 0), h = Math.max(1, r.height * d | 0);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0);
  return { ctx, w: r.width, h: r.height };
};

// ---------- 全局状态 ----------
SD.state = {
  date: '37.114',
  clock: 4 * 3600 + 12 * 60,  // 艇上时间（秒）
  depth: 212, depthOrd: 212,
  hdg: 47, hdgOrd: 47,
  spd: 6, spdOrd: 6,
  own: { x: 0, y: 0 },
  track: [],                   // 本艇航迹
  silent: false,
  navErr: 0.6,                 // 惯性导航误差半径 km
  selected: 'S-03',
  leviathan: false,
  pings: [],                   // 主动声呐波纹
  // 电力：反应堆功率 + 断路器
  reactor: 38,
  breakers: {
    PROP: { name: '推进', load: 14, on: true, noise: 6 },
    LIFE: { name: '生命维持', load: 8, on: true, noise: 2, critical: true },
    SONAR: { name: '声呐阵列', load: 5, on: true, noise: 1 },
    TUBE: { name: '鱼雷管预热', load: 9, on: false, noise: 12 },
    DESAL: { name: '淡水蒸馏', load: 4, on: true, noise: 3 },
    ALGAE: { name: '藻类农场照明', load: 3, on: true, noise: 1 },
    CON3: { name: '3号终端', load: 2, on: true, noise: 0 },
  },
};
const S = SD.state;

// 接触目标：真实位置只给模拟用，界面上只能看到方位和估算
// 线谱设计：S-03 是真潜艇但声纹库条目损坏；S-07 回声体模仿赤潮级，少一根 208Hz 电源谐波且不漂移；
// S-09 锈帮艇有一根谐波偏了 8Hz（像伪造），但 DIFF 里转速在变，是真机械
S.contacts = [
  { id: 'S-03', x: 3.6, y: -2.2, vx: -0.05, vy: 0.08, kind: 'sub', cls: 'UNKNOWN', match: ['舰队协约-"赤潮级"', 61], lines: [52, 104, 156, 208, 310, 420], flag: '', seen: 3 },
  { id: 'S-05', x: -4.8, y: 5.4, vx: 0.02, vy: -0.01, kind: 'whale', cls: 'BIO', match: ['哀歌鲸', 88], lines: [18, 36, 240], flag: '', seen: 5 },
  { id: 'S-07', x: -1.9, y: -5.6, vx: 0, vy: 0, kind: 'echo', cls: 'UNKNOWN', match: ['舰队协约-"赤潮级"', 83], lines: [52, 104, 156, 310, 420], flag: '', seen: 2 },
  { id: 'S-09', x: 6.2, y: 4.1, vx: -0.06, vy: -0.03, kind: 'rust', cls: 'UNKNOWN', match: ['锈帮改装艇', 72], lines: [60, 120, 180, 248, 355], flag: '', seen: 1, hidden: true },
];
S.contacts.forEach(c => { c.bearings = []; c.rngEst = null; c.history = []; });
SD.contact = id => S.contacts.find(c => c.id === id);
SD.visibleContacts = () => S.leviathan ? [] : S.contacts.filter(c => !c.hidden);

// 分类：玩家可以手改，开火许可跟着分类走
SD.CLASSES = ['UNKNOWN', 'FRIEND', 'NEUTRAL', 'HOSTILE', 'BIO'];
SD.CLS_CN = { UNKNOWN: '未识别', FRIEND: '友方', NEUTRAL: '中立', HOSTILE: '敌对', BIO: '生物' };

// 噪声 dB：反应堆 + 航速 + 负载 + 静默航行
SD.noise = () => {
  let n = 88 + S.reactor * 0.22 + S.spd * 1.4;
  for (const b of Object.values(S.breakers)) if (b.on) n += b.noise * 0.5;
  if (S.silent) n -= 9;
  n += SD.typingNoise;
  for (const s of SD.spikes) n += s.db;
  return n;
};
SD.typingNoise = 0;
// 短时噪声尖峰：注水、开管门、排水泵等操作会让噪声瞬间升高
SD.spikes = [];
SD.spike = (db, sec, label) => SD.spikes.push({ db, t: sec, label });
SD.powerUsed = () => Object.values(S.breakers).reduce((a, b) => a + (b.on ? b.load : 0), 0);

// ---------- 全局系统 tick ----------
// 淹水、装填、鱼雷航行这些状态不管界面开没开都要推进，由主循环统一调用
// fn(sdt, dt)：sdt 是乘过时间压缩的艇上秒数，dt 是真实秒数
SD.systems = [];
SD.addSystem = fn => SD.systems.push(fn);
SD.addSystem((sdt, dt) => {
  for (const s of SD.spikes) s.t -= dt;
  SD.spikes = SD.spikes.filter(s => s.t > 0);
});

// ---------- 事件总线 ----------
// 模块创建期间注册的监听会记在该模块名下，切换模块时一起移除
const listeners = {};
SD._owner = null;
SD.on = (ev, fn) => (listeners[ev] = listeners[ev] || []).push({ fn, owner: SD._owner });
SD.off = owner => { for (const k in listeners) listeners[k] = listeners[k].filter(l => l.owner !== owner); };
SD.emit = (ev, ...a) => (listeners[ev] || []).forEach(l => l.fn(...a));

// ---------- 界面模块注册 ----------
// 每个模块：{ code, cn, ph(磷光色), fkey, create(root, con) → { tick(dt)?, key(e)? } }
SD.modules = {};
SD.register = def => { SD.modules[def.code] = def; };

// 内部广播（由 app.js 实现，这里先占位）
SD.say = () => {};
SD.report = () => {};

// 艇上时间显示
SD.timeStr = () => {
  const t = S.clock | 0;
  return `${SD.pad(t / 3600 % 24, 2)}:${SD.pad(t / 60 % 60, 2)}:${SD.pad(t % 60, 2)}`;
};
