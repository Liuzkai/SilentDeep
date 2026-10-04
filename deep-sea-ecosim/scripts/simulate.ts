// 命令行模拟入口：不打开浏览器运行指定时长 / 实验，导出 CSV 与报告
// 用法：
//   npm run simulate -- --days 5000
//   npm run simulate -- --experiment B --days 3000 --warmup 1000 --u 0.8
//   npm run simulate -- --all --days 3000 --warmup 1000
// 选项：--days --experiment A|B|C|D|E --all --warmup --u --target A|B（实验 C）--layer 1|2|3|all
//       --start --stop --supply --every（记录间隔）--dt --out 目录
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG, cloneConfig, runExperiment, runScenario, toCSV, POOLS, FISH, type ExperimentId, type ExperimentResult, type ScenarioResult, type LayerTarget, type FishId } from '../src/sim';

const argv = process.argv.slice(2);
const opt = (name: string, def?: string) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : i >= 0 ? 'true' : def; };
const num = (name: string, def: number) => { const v = opt(name); if (v == null) return def; const n = Number(v); if (!Number.isFinite(n)) throw new Error(`--${name} 需要数字`); return n; };

const days = num('days', 5000);
const every = num('every', 1);
const out = opt('out', 'results')!;
const config = cloneConfig(DEFAULT_CONFIG);
if (opt('dt')) config.dt = num('dt', config.dt);
mkdirSync(out, { recursive: true });

// 很低但非零的库存用科学计数法，避免显示成 0.000 被误读为灭绝
const fmt = (v: number, d = 3) => (v !== 0 && Math.abs(v) < 0.01 ? v.toExponential(2) : v.toFixed(d));
const line = (r: ScenarioResult) => {
  const f = r.samples[r.samples.length - 1];
  return POOLS.map((p, i) => `${p}=${fmt(f.totals[i])}`).join('  ') + `  | 累计捕获 ` + FISH.map((p, i) => `${p}=${fmt(f.cumCatch[i + 1])}`).join(' ');
};
const layerArg = opt('layer', 'all')!;
const layer: LayerTarget = layerArg === 'all' ? 'all' : ((+layerArg - 1) as 0 | 1 | 2);
const params = { u: opt('u') ? num('u', 0.5) : undefined, forageTarget: (opt('target', 'A') as FishId), layer, start: num('start', 100), stop: num('stop', 1500), supply: num('supply', 0.5) };

const report: string[] = [];
const log = (s = '') => { console.log(s); report.push(s); };

function describeExperiment(e: ExperimentResult) {
  log(`\n## ${e.spec.name}`);
  log(`${e.spec.description}`);
  log(`预热 ${e.warmupDays} 日（无捕捞，真实计算，两组共用同一快照），之后运行 ${days} 日，dt=${config.dt}`);
  log(`干预记录：${e.spec.treatment.length ? e.spec.treatment.map(s => `t=${s.t} ${s.label}`).join('；') : '无'}`);
  log(`对照组 终态  ${line(e.control)}`);
  log(`实验组 终态  ${line(e.treatment)}`);
  const c = e.control.samples[e.control.samples.length - 1], t = e.treatment.samples[e.treatment.samples.length - 1];
  const marks = e.spec.treatment.map(ev => ev.t);
  if (marks.length) {
    // 干预前后与结束时的关键时刻，方便看停止捕捞之后的变化
    const at = (r: ScenarioResult, tt: number) => r.samples.reduce((a, s) => Math.abs(s.t - r.startT - tt) < Math.abs(a.t - r.startT - tt) ? s : a);
    for (const tt of [...marks, days]) log(`  t=${tt}  实验组 ` + POOLS.map((p, i) => `${p}=${fmt(at(e.treatment, tt).totals[i])}`).join('  '));
  }
  log(`实验 − 对照  ` + POOLS.map((p, i) => `${p}=${(t.totals[i] - c.totals[i] >= 0 ? '+' : '') + fmt(t.totals[i] - c.totals[i])} (${c.totals[i] > 0 ? ((t.totals[i] / c.totals[i] - 1) * 100).toFixed(1) : '—'}%)`).join('  '));
  log(`账本最大误差 对照 ${e.control.maxBudgetError.toExponential(2)} / 实验 ${e.treatment.maxBudgetError.toExponential(2)}；异常 ${e.control.anomalies.length + e.treatment.anomalies.length} 条`);
  for (const a of [...e.control.anomalies, ...e.treatment.anomalies]) log(`  ! ${a}`);
  const file = join(out, `experiment-${e.spec.id}${e.spec.id === 'C' ? '-' + (e.spec.name.endsWith('B') ? 'B' : 'A') : ''}.csv`);
  writeFileSync(file, toCSV(e.control, 'control') + toCSV(e.treatment, 'treatment').split('\n').slice(1).join('\n'));
  log(`CSV：${file}`);
}

log(`# 无岸 深海生态模拟 命令行报告`);
log(`生成时间 ${new Date().toISOString()}，参数：默认配置${opt('dt') ? `（dt=${config.dt}）` : ''}。数值为归一化 BU，不是真实鱼类数量。`);

const expArg = opt('experiment');
if (opt('all') === 'true' || expArg) {
  const ids: ExperimentId[] = opt('all') === 'true' ? ['A', 'B', 'C', 'D', 'E'] : [expArg as ExperimentId];
  const warmup = num('warmup', 0);
  for (const id of ids) {
    if (!['A', 'B', 'C', 'D', 'E'].includes(id)) throw new Error(`未知实验 ${id}`);
    describeExperiment(runExperiment(config, id, days, { warmup, recordEvery: every, params }));
    if (id === 'C' && opt('all') === 'true') describeExperiment(runExperiment(config, 'C', days, { warmup, recordEvery: every, params: { ...params, forageTarget: params.forageTarget === 'A' ? 'B' : 'A' } }));
  }
} else {
  const t0 = performance.now();
  const r = runScenario(config, [], days, { recordEvery: every });
  const ms = performance.now() - t0;
  log(`\n## 无捕捞基线 ${days} 日（${Math.round(days / config.dt)} 步，${ms.toFixed(0)} ms）`);
  log(`初始  ` + POOLS.map((p, i) => `${p}=${fmt(r.samples[0].totals[i])}`).join('  '));
  log(`终态  ${line(r)}`);
  const last = r.samples[r.samples.length - 1];
  log(`分层  ` + POOLS.map((p, i) => `${p}[${last.X[i].map(v => fmt(v, 2)).join(', ')}]`).join('  '));
  // 最后 10% 时间的波动范围，用于判断是否趋于稳定
  const tail = r.samples.filter(s => s.t >= days * 0.9);
  log(`最后 10% 时间范围  ` + POOLS.map((p, i) => `${p} ${fmt(Math.min(...tail.map(s => s.totals[i])), 2)}–${fmt(Math.max(...tail.map(s => s.totals[i])), 2)}`).join('  '));
  log(`最小库存 ${r.minValue.toExponential(3)}；账本最大误差 ${r.maxBudgetError.toExponential(3)}；异常 ${r.anomalies.length} 条`);
  for (const a of r.anomalies) log(`  ! ${a}`);
  const file = join(out, `baseline-${days}d.csv`);
  writeFileSync(file, toCSV(r, 'baseline'));
  log(`CSV：${file}`);
}
const rep = join(out, expArg || opt('all') === 'true' ? 'experiments-report.md' : `baseline-${days}d-report.md`);
writeFileSync(rep, report.join('\n') + '\n');
console.log(`报告：${rep}`);
