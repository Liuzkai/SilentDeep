// 界面控制：读取输入 → 校验 → 交给 Driver。所有生态参数来自 sim/config，不在这里散落。
import {
  DEFAULT_CONFIG, cloneConfig, experimentSpec, validateInterventions, POOLS, FISH,
  type FishId, type Interventions, type LayerTarget, type ExperimentId,
} from '../sim';
import { Driver } from './driver';
import { drawChart } from './charts';
import { drawFoodWeb } from './food-web';
import { renderInspector, renderLayers } from './inspector';
import { OceanView } from '../view/ocean-view';
import { SPECIES_CSS } from '../view/common';

const SPEEDS = [1, 5, 10, 20, 50, 100, 250, 500];   // 模拟日 / 现实秒

export function startApp() {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const config = cloneConfig(DEFAULT_CONFIG);
  const driver = new Driver(config);
  const view = new OceanView($('gl'), $('overlay'), 1500);
  const visible: Record<string, boolean> = { R: true, A: true, B: true, C: true, D: true };
  let showCtrl = true, logY = false;

  $('dt-o').textContent = String(config.dt);
  $('fmax-o').textContent = String(config.Fmax);

  // 物种显隐
  $('species-toggles').innerHTML = POOLS.map(p => `<label style="color:${SPECIES_CSS[p]}"><input type="checkbox" data-sp="${p}" checked> ${p}</label>`).join('');
  $('species-toggles').addEventListener('change', e => { const t = e.target as HTMLInputElement; visible[t.dataset.sp!] = t.checked; });
  $<HTMLInputElement>('tg-bound').addEventListener('change', e => view.setBoundaries((e.target as HTMLInputElement).checked));
  $<HTMLInputElement>('tg-ctrl').addEventListener('change', e => { showCtrl = (e.target as HTMLInputElement).checked; });
  $<HTMLInputElement>('tg-log').addEventListener('change', e => { logY = (e.target as HTMLInputElement).checked; });

  // 运行控制
  const runBtn = $('bt-run');
  const syncRun = () => { runBtn.textContent = driver.running ? '暂停' : '继续'; };
  runBtn.onclick = () => { driver.running = !driver.running; syncRun(); };
  $('bt-step').onclick = () => { driver.running = false; syncRun(); driver.stepOnce(); };
  $('bt-reset').onclick = () => { driver.reset({ name: '自由探索' }); readUI(true); };
  const speed = $<HTMLInputElement>('speed');
  const syncSpeed = () => { driver.speed = SPEEDS[+speed.value]; $('speed-o').textContent = `${driver.speed} 模拟日/现实秒`; };
  speed.oninput = syncSpeed; syncSpeed();

  // 干预输入：校验后才生效，并写入带时间戳的记录
  const fOn = $<HTMLInputElement>('f-on'), fT = $<HTMLSelectElement>('f-target'), fL = $<HTMLSelectElement>('f-layer'), fU = $<HTMLInputElement>('f-u'), sup = $<HTMLInputElement>('supply');
  let lastKey = '';
  function readUI(silent = false) {
    const iv: Interventions = {
      fishing: { enabled: fOn.checked, target: fT.value as FishId, layer: (fL.value === 'all' ? 'all' : +fL.value) as LayerTarget, u: Number(fU.value) },
      supplyMultiplier: Number(sup.value),
    };
    $('f-u-o').textContent = iv.fishing.u.toFixed(2) + `  → F = ${(iv.fishing.u * config.Fmax).toFixed(4)}/日`;
    $('supply-o').textContent = iv.supplyMultiplier.toFixed(2) + '×';
    const v = validateInterventions(iv);
    $('errors').textContent = v.ok ? '' : v.problems.join('；');
    if (!v.ok) return;
    const key = JSON.stringify(iv);
    if (key === lastKey && !silent) return;
    lastKey = key;
    const f = iv.fishing;
    const label = `捕捞 ${f.enabled && f.u > 0 ? `${f.target} @ ${f.layer === 'all' ? '全部层' : 'L' + (+f.layer + 1)} u=${f.u.toFixed(2)}` : '关闭'}；补给 ${iv.supplyMultiplier.toFixed(2)}×`;
    if (silent) driver.exp.setInterventions(iv); else driver.setInterventions(iv, label);
  }
  for (const el of [fOn, fT, fL, fU, sup]) el.addEventListener('input', () => readUI());

  function syncInputs(iv: Interventions) {
    fOn.checked = iv.fishing.enabled; fT.value = iv.fishing.target; fL.value = String(iv.fishing.layer); fU.value = String(iv.fishing.u); sup.value = String(iv.supplyMultiplier);
    lastKey = JSON.stringify(iv); readUI(true);
  }

  driver.onInterventionChange = iv => syncInputs(iv);

  // 预设实验：两组从同一预热快照出发，干预日程按模拟时间自动执行
  const presetSel = $<HTMLSelectElement>('preset');
  const specFor = (v: string) => v === 'CB' ? experimentSpec('C', { forageTarget: 'B' }) : experimentSpec(v as ExperimentId);
  presetSel.onchange = () => { $('preset-desc').textContent = presetSel.value ? specFor(presetSel.value).description : '从初始状态开始，手动改变捕捞和补给。'; };
  presetSel.onchange(new Event('change'));
  $('bt-preset').onclick = () => {
    const v = presetSel.value;
    const warm = Number(($('warmup') as HTMLInputElement).value);
    if (!Number.isFinite(warm) || warm < 0 || warm > 20000) { $('errors').textContent = '预热时长必须在 0–20000 日'; return; }
    $('bt-preset').textContent = '预热计算中…';
    setTimeout(() => {
      if (!v) driver.reset({ name: '自由探索' });
      else { const s = specFor(v); driver.reset({ warmup: warm, schedule: s.treatment, name: s.name }); }
      syncInputs(driver.exp.interventions);
      $('bt-preset').textContent = '载入';
    }, 20);
  };

  // 导出
  const download = (name: string, text: string, type: string) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  };
  $('bt-export').onclick = () => download('ecosim-record.json', JSON.stringify(driver.exportRecord(), null, 2), 'application/json');
  $('bt-csv').onclick = () => {
    // 界面曲线历史（可能被降采样）；完整精度的数据请用命令行 npm run simulate
    const head = ['group', 't', ...POOLS.flatMap(p => [1, 2, 3].map(k => `${p}_L${k}`)), ...POOLS.map(p => `${p}_total`), ...FISH.map(p => `${p}_catch_rate`)].join(',');
    const rows = (g: string, h: typeof driver.histExp) => h.map(p => [g, (p.t - driver.origin).toFixed(2), ...p.layers.flat().map(v => v.toPrecision(8)), ...p.totals.map(v => v.toPrecision(8)), ...p.catchRate.slice(1).map(v => v.toPrecision(6))].join(','));
    download('ecosim-curves.csv', [head, ...rows('treatment', driver.histExp), ...rows('control', driver.histCtrl)].join('\n') + '\n', 'text/csv');
  };

  // 主循环：生态推进与渲染分离
  let last = performance.now(), uiT = 0;
  const loop = (now: number) => {
    const real = Math.min(0.25, (now - last) / 1000); last = now;
    driver.frame(real);
    view.render(driver.exp.state.X, now / 1000, visible);
    uiT += real;
    if (uiT > 0.15 || !driver.running) {
      uiT = 0;
      const s = driver.exp.state, alloc = view.schools.alloc;
      $('clock').innerHTML = `模拟时间 <b>${(s.t - driver.origin).toFixed(1)}</b> 日${driver.warmup ? `（预热 ${driver.warmup} 日之后，绝对 t=${s.t.toFixed(1)}）` : ''} · ${driver.presetName} · ${driver.running ? '运行中' : '<span class="paused">已暂停</span>'}`;
      $('inst-info').textContent = `可见实例 ${view.schools.totalVisible()} / 预算 ${view.schools.budget}${alloc?.capped ? '（已按预算降采样）' : ''} · 实例 ≠ 鱼的数量`;
      drawChart($<HTMLCanvasElement>('cv-chart'), driver.histExp, driver.histCtrl, driver.log, { showControl: showCtrl, log: logY, visible, origin: driver.origin });
      renderLayers($('layers-body'), s, driver.ledger, alloc?.low ?? null);
      drawFoodWeb($('svg-web') as unknown as SVGSVGElement, config.a, driver.ledger, POOLS.map((_, i) => s.X[i][0] + s.X[i][1] + s.X[i][2]));
      renderInspector($('insp-body'), ($('insp-pool') as HTMLSelectElement).value, driver.ledger);
      $('log').innerHTML = driver.log.map(e => `<li><b>t=${(e.t - driver.origin).toFixed(1)}</b> ${e.label}</li>`).join('');
    }
    requestAnimationFrame(loop);
  };
  readUI(true);
  requestAnimationFrame(loop);
  // 调试入口（只读用途）
  (window as unknown as { ecosim: unknown }).ecosim = { driver, view, FISH };
}
