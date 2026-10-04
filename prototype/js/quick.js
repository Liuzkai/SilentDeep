/* 快捷按钮台：把常用命令做成控制台桌面上的实体按键
 * 每个按键就是一条命令行命令，按下等于在命令行里输入它，所以广播和噪声代价都一样
 * 指示灯反映当前状态（静默、耳机、TUBE 预热等）；危险操作带保护盖，要按两下
 * 可以把当前命令行里的内容存成自定义按键（+ 按钮），右键删除自定义按键 */

(() => {
const S = SD.state;

const GROUPS = [
  { label: '航行', keys: [
    { cmd: 'SILENT', t: 'SILENT', s: '静默航行', lit: () => S.silent },
    { cmd: 'SPD 3', t: 'SPD 3', s: '低速' },
    { cmd: 'SPD 12', t: 'SPD 12', s: '巡航' },
    { cmd: 'HDG +35', t: 'TURN', s: '右转 35°' },
    { cmd: 'DEPTH 350', t: 'DEEP', s: '下潜 350m' },
  ] },
  { label: '侦测', keys: [
    { cmd: 'MARK', t: 'MARK', s: '记方位线' },
    { cmd: 'READ', t: 'READ', s: '存读数' },
    { cmd: 'NEXT', t: 'NEXT', s: '下一目标' },
    { cmd: 'PING', t: 'PING', s: '主动声呐', guard: true, warn: true },
    { cmd: 'PHONES', t: 'PHONES', s: '耳机', lit: () => SD.audio.headphones, g: true },
  ] },
  { label: '识别 / 通讯', keys: [
    { cmd: 'HAIL IDENT', t: 'HAIL', s: '报呼号' },
    { cmd: 'HAIL SIGN', t: 'SIGN', s: '问暗号' },
    { cmd: 'CLASS HOSTILE', t: 'HOSTILE', s: '标为敌对', warn: true },
  ] },
  { label: '武器', keys: [
    { cmd: 'BREAKER TUBE', t: 'TUBE PWR', s: '鱼雷管预热', lit: () => S.breakers.TUBE.on },
    { cmd: 'PREP ALL', t: 'PREP', s: '注水开管门' },
    { cmd: 'SALVO', t: 'SALVO', s: () => '组合 ' + S.salvoSel, guard: true, warn: true },
    { cmd: 'FIRE T4', t: 'DECOY', s: 'T4 诱饵', guard: true },
  ] },
  { label: '系统', keys: [
    { cmd: 'DEGAUSS', t: 'DEGAUSS', s: '消磁' },
    { cmd: 'HULL', t: 'HULL', s: '舰体' },
    { cmd: 'BESTIARY', t: 'BESTIARY', s: '图鉴' },
    { cmd: 'APPROACH', t: 'APPR', s: '进港图' },
    { cmd: 'HELP', t: 'HELP', s: '命令表' },
  ] },
];

// 自定义按键存在 localStorage，只是本机便利功能
const STORE = 'sd-quick-custom';
let custom = [];
try { custom = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { custom = []; }
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(custom)); } catch {} };

let armed = null, armTimer = null;

function render() {
  const el = SD.$('#quick'); if (!el) return;
  const btn = (k, i, isCustom) => {
    const cls = ['qk', k.lit && k.lit() ? 'lit' : '', k.g ? 'g' : '', k.warn ? 'warn' : '', k.guard ? 'guard' : '', armed === k.cmd ? 'armed' : '', isCustom ? 'custom' : ''].join(' ');
    const sub = typeof k.s === 'function' ? k.s() : k.s;
    return `<button class="${cls}" data-cmd="${k.cmd}" ${isCustom ? `data-ci="${i}"` : ''} title="${k.cmd}">${k.t}<small>${armed === k.cmd ? '再按一次确认' : sub}</small></button>`;
  };
  const html = GROUPS.map(g => `<div class="qk-group"><label>${g.label}</label><div class="qk-row">${g.keys.map(k => btn(k)).join('')}</div></div>`).join('')
    + `<div class="qk-group"><label>自定义</label><div class="qk-row">${custom.map((k, i) => btn(k, i, true)).join('')}<button class="qk add" data-act="add" title="把命令行里的内容存成按键">+ 存为按键</button></div></div>`;
  SD.html(el, html);
}

function press(el) {
  const cmd = el.dataset.cmd;
  el.classList.add('press'); setTimeout(() => el.classList.remove('press'), 120);
  SD.audio.click(.3, 900); setTimeout(() => SD.audio.click(.15, 1500), 40);   // 实体按键比键盘更"咔"
  const k = GROUPS.flatMap(g => g.keys).find(k => k.cmd === cmd);
  if (k && k.guard && armed !== cmd) {
    // 保护盖：第一次掀开，3 秒内再按才执行
    armed = cmd; clearTimeout(armTimer); armTimer = setTimeout(() => { armed = null; render(); }, 3000);
    SD.audio.click(.25, 400); render(); return;
  }
  armed = null;
  SD.run(cmd);
  render();
}

document.addEventListener('pointerdown', e => {
  const b = e.target.closest('#quick button'); if (!b || e.button !== 0) return;
  e.preventDefault();
  if (b.dataset.act === 'add') {
    const v = SD.$('#cmd').value.trim();
    if (!v) { SD.say('TACNET', '先在命令行里输入要存的命令，再按 + 存为按键'); SD.$('#cmd').focus(); return; }
    custom.push({ cmd: v.toUpperCase(), t: v.toUpperCase().split(/\s+/)[0].slice(0, 8), s: v.toUpperCase().split(/\s+/).slice(1).join(' ').slice(0, 12) || '自定义' });
    save(); SD.$('#cmd').value = ''; SD.audio.relay(); render();
    SD.say('TACNET', `已存为按键：${v.toUpperCase()}。右键可以删除`);
    return;
  }
  press(b);
});
document.addEventListener('contextmenu', e => {
  const b = e.target.closest('#quick button[data-ci]'); if (!b) return;
  e.preventDefault();
  custom.splice(+b.dataset.ci, 1); save(); SD.audio.relay(); render();
});

SD.quickRender = render;
SD.addSystem((sdt, dt) => { render.t = (render.t || 0) + dt; if (render.t > .3) { render.t = 0; render(); } });
})();
