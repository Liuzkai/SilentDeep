/* BESTIARY 怪兽图鉴（参考 05：细线框、// 标签、抖动点阵配图）
 * 图像是程序生成的剪影，用 Bayer 抖动绘制；观测次数越多，采样越细、越清晰 */

(() => {
const S = SD.state;

// 每种生物用一个"密度函数"描述剪影：输入归一化坐标 (u,v)∈[-1,1]，返回 0~1 的亮度
const sq = x => x * x, g = x => Math.exp(-x);
const shapes = {
  jelly: (u, v) => {
    const bell = g((sq(u * 1.3) + sq((v + .35) * 2.2)) * 1.6) * (v < -.1 ? 1 : .2);
    let t = 0; for (let i = -3; i <= 3; i++) t += g(sq((u - i * .14 - Math.sin(v * 7 + i) * .05) * 30)) * (v > -.2 && v < .9 ? (1 - v) * .6 : 0);
    return bell + t;
  },
  crab: (u, v) => {
    const body = g((sq(u * 1.6) + sq(v * 2.8)) * 2);
    let legs = 0; for (let i = 0; i < 4; i++) { const y = -.15 + i * .1; legs += g(sq((v - y - Math.abs(u) * .4) * 22)) * (Math.abs(u) > .3 && Math.abs(u) < .9 ? .8 : 0); }
    const claw = g(sq((Math.abs(u) - .55) * 5) + sq((v + .4) * 6));
    return body + legs + claw;
  },
  eye: (u, v) => {
    const r = Math.hypot(u, v);
    let arms = 0; for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + r * 2.5; arms += g(sq((Math.atan2(v, u) - a + 9 * Math.PI) % (2 * Math.PI) - Math.PI) * 60) * (r > .25 && r < .95 ? 1 - r : 0); }
    const iris = g(sq(r * 5)) * 1.2, ring = g(sq((r - .22) * 25));
    return arms * 1.5 + ring + (r < .08 ? 0 : iris);
  },
  echo: (u, v) => {
    // 回声体：模糊、像是本身就在变化的东西
    const t = Date.now() / 1500;
    return g((sq(u * 1.1) + sq(v * 1.8)) * 2) * (.5 + .5 * Math.sin(u * 12 + t) * Math.sin(v * 9 - t));
  },
  whale: (u, v) => {
    const body = g(sq(u * 1.05) * 1.6 + sq((v - u * .15) * 4.2));
    const tail = g(sq((u - .95) * 7) + sq((Math.abs(v + .02) - .12 - (u - .95) * .6) * 10));
    const fin = g(sq((u + .2) * 8) + sq((v - .18) * 10)) * .8;
    return body + tail + fin;
  },
  leviathan: () => 0,
};

SD.bestiary = [
  { id: 'jelly', tier: 'Ⅰ', name: '漂流群', obs: 6, text: '变异水母群。会堵塞进水口，导致冷却故障。' },
  { id: 'crab', tier: 'Ⅱ', name: '铁颚蟹', obs: 3, text: '吸附在艇壳上啃食。浮上浅水或放电清除。' },
  { id: 'eye', tier: 'Ⅲ', name: '深渊眼', obs: 1, text: '巨型头足类。会缠住潜艇往深处拖。' },
  { id: 'echo', tier: 'Ⅲ', name: '回声体', obs: 2, text: '模仿声纹和人类通讯的掠食者。回应太快，节奏完全一致。' },
  { id: 'whale', tier: 'Ⅳ', name: '哀歌鲸', obs: 5, text: '体型巨大，通常不具攻击性。跟着歌声能找到洋流。' },
  { id: 'leviathan', tier: 'Ⅴ', name: '利维坦', obs: 0, text: '它出现时，声呐上所有信号都会消失。' },
];

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16);

function dither(cv, fn, obs, rgb) {
  const { ctx, w, h } = SD.fitCanvas(cv);
  ctx.fillStyle = '#050805'; ctx.fillRect(0, 0, w, h);
  // 观测次数决定像素块大小：0 次 = 什么都没有，6 次 = 最清晰
  if (obs <= 0) {
    ctx.fillStyle = `rgba(${rgb},.6)`; ctx.font = '40px VT323, monospace'; ctx.textAlign = 'center';
    ctx.fillText('? ? ?', w / 2, h / 2 + 12); ctx.textAlign = 'start'; return;
  }
  const px = Math.max(2, Math.round(14 / obs));
  const noise = SD.clamp(.5 - obs * .08, 0, .5);
  ctx.fillStyle = `rgb(${rgb})`;
  for (let y = 0; y < h; y += px) for (let x = 0; x < w; x += px) {
    const u = (x / w) * 2 - 1, v = (y / h) * 2 - 1;
    let a = fn(u * 1.1, v * 1.1) + (Math.random() - .5) * noise;
    const th = BAYER[((y / px) % 4 | 0) * 4 + ((x / px) % 4 | 0)];
    if (a > th) ctx.fillRect(x, y, px - (px > 3 ? 1 : 0), px - (px > 3 ? 1 : 0));
  }
}

SD.register({
  code: 'BESTIARY', cn: '怪兽图鉴', ph: 'green', fkey: '',
  create(root) {
    root.innerHTML = `
      <div class="mod-title"><span>BESTIARY // 变异生物图鉴</span><span class="dim">[←→] 翻页  [O] 模拟观测</span></div>
      <div class="mod-body" style="display:grid;grid-template-columns:9em 1fr;gap:10px">
        <div class="bs-list"></div>
        <div style="display:grid;grid-template-rows:1fr auto;gap:6px;border:1px solid rgba(var(--ph-rgb),.5);padding:6px">
          <div style="position:relative"><canvas class="fill"></canvas></div>
          <div class="bs-info"></div>
        </div>
      </div>`;
    const list = root.querySelector('.bs-list'), info = root.querySelector('.bs-info'), cv = root.querySelector('canvas');
    let idx = 0;
    function drawList() {
      list.innerHTML = SD.bestiary.map((b, i) => `<div class="pw-row ${i === idx ? 'sel' : ''}" data-i="${i}"><span>${b.tier}</span><span class="cnf">${b.obs ? b.name : '██████'}</span></div>`).join('');
      const b = SD.bestiary[idx];
      SD.html(info, `<div>// ${b.tier} 级 · <span class="cnf">${b.obs ? b.name : '未知'}</span> <span class="dim">观测 ${b.obs}/6</span></div>
        <div class="cn" style="line-height:1.4">${b.obs >= 2 ? b.text : SD.garble(b.text, .7)}</div>
        <div><span class="btn" data-act="obs">+ 观测</span></div>`);
    }
    root.addEventListener('pointerdown', e => {
      const r = e.target.closest('[data-i]'); if (r) { idx = +r.dataset.i; SD.audio.key(); drawList(); }
      if (e.target.dataset.act === 'obs') obs();
    });
    const obs = () => { const b = SD.bestiary[idx]; if (b.id !== 'leviathan') b.obs = Math.min(6, b.obs + 1); SD.audio.beep(900, .04); drawList(); };
    drawList();
    let t = 1;
    return {
      tick(dt) { t += dt; if (t > .35) { t = 0; const b = SD.bestiary[idx]; dither(cv, shapes[b.id], b.obs, SD.phRGB(root)); } },
      key(e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { idx = (idx + 1) % SD.bestiary.length; drawList(); return true; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { idx = (idx + SD.bestiary.length - 1) % SD.bestiary.length; drawList(); return true; }
        if (e.key === 'o') { obs(); return true; }
      },
    };
  },
});
})();
