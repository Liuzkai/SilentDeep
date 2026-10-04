import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG, cloneConfig, createInitialState, runScenario, FISH, type Interventions } from '../src/sim';
import { Driver } from '../src/ui/driver';
import { allocateInstances, BU_PER_INSTANCE } from '../src/view/instance-budget';

const fishD: Interventions = { fishing: { enabled: true, target: 'D', layer: 'all', u: 0.6 }, supplyMultiplier: 0.8 };

describe('表现层独立：帧率 / 实例预算 / 相机不影响生态结果', () => {
  it('不同帧率驱动同样的模拟时长，生态状态逐位相同', () => {
    const run = (fps: number, speed: number) => {
      const d = new Driver(cloneConfig(DEFAULT_CONFIG));
      d.speed = speed;
      d.setInterventions(fishD, 'test');
      const days = 400, frames = Math.round(days / speed * fps);
      for (let i = 0; i < frames; i++) d.frame(1 / fps);
      return d.exp.state;
    };
    const a = run(60, 20), b = run(24, 20), c = run(144, 20);
    expect(a.steps).toBe(2000);
    expect(b.X).toEqual(a.X); expect(c.X).toEqual(a.X);
    expect(b.cumCatch).toEqual(a.cumCatch);
  });
  it('改变速度只改变单位现实时间的步数，同样步数下结果与命令行运行一致', () => {
    const d = new Driver(cloneConfig(DEFAULT_CONFIG));
    d.speed = 250;
    while (d.exp.state.steps < 1000) d.frame(1 / 30);
    const extra = d.exp.state.steps - 1000;
    const ref = runScenario(DEFAULT_CONFIG, [], (1000 + extra) * DEFAULT_CONFIG.dt, { recordEvery: 1e9 }).final;
    expect(d.exp.state.X).toEqual(ref.X);
  });
  it('暂停时不推进', () => {
    const d = new Driver(cloneConfig(DEFAULT_CONFIG));
    d.running = false;
    for (let i = 0; i < 100; i++) d.frame(1 / 60);
    expect(d.exp.state.steps).toBe(0);
  });
  it('实例分配不修改生态状态；预算只影响实例数', () => {
    const s = createInitialState(DEFAULT_CONFIG);
    const before = JSON.stringify(s.X);
    const a = allocateInstances(s.X, 1500), b = allocateInstances(s.X, 200);
    expect(JSON.stringify(s.X)).toBe(before);
    expect(a.counts.flat().reduce((x, y) => x + y, 0)).toBeLessThanOrEqual(1500 + 12);
    expect(b.counts.flat().reduce((x, y) => x + y, 0)).toBeLessThanOrEqual(200 + 12);
  });
  it('生物量下降时实例变少（不归一化到满屏）；为零时不显示；很低但非零标为低生物量', () => {
    const s = createInitialState(DEFAULT_CONFIG);
    s.X[1] = [5, 1, 0]; s.X[4] = [0, 0, 0]; s.X[3] = [1e-6, 3, 3];
    const a = allocateInstances(s.X, 100000);
    expect(a.counts[0][0]).toBe(Math.floor(5 / BU_PER_INSTANCE.A));
    expect(a.counts[0][2]).toBe(0);
    expect(a.counts[3]).toEqual([0, 0, 0]);
    expect(a.low[2][0]).toBe(true);
    expect(a.counts[2][0]).toBe(1);
  });
  it('对照组始终不受界面干预影响', () => {
    const d = new Driver(cloneConfig(DEFAULT_CONFIG));
    d.setInterventions(fishD, 'test');
    for (let i = 0; i < 500; i++) d.stepOnce();
    const ref = runScenario(DEFAULT_CONFIG, [], 500 * DEFAULT_CONFIG.dt, { recordEvery: 1e9 }).final;
    expect(d.ctrl.state.X).toEqual(ref.X);
    expect(d.exp.state.X).not.toEqual(ref.X);
  });
  it('预设日程按模拟时间自动执行并记录时间戳', () => {
    const d = new Driver(cloneConfig(DEFAULT_CONFIG));
    d.reset({ warmup: 100, schedule: [{ t: 10, interventions: fishD, label: '开始' }], name: 'x' });
    for (let i = 0; i < 60; i++) d.stepOnce();
    const rec = d.exportRecord();
    const e = rec.interventions.find(x => x.label === '开始')!;
    expect(e.t).toBeCloseTo(10, 6);
    expect(rec.warmupDays).toBe(100);
  });
});

describe('模块边界', () => {
  it('src/sim 不引用 three、DOM、view 或 ui', () => {
    const dir = join(__dirname, '../src/sim');
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/from ['"](three|\.\.\/view|\.\.\/ui)/);
      expect(src, f).not.toMatch(/\b(window|document|requestAnimationFrame|performance)\b/);
      expect(src, f).not.toMatch(/Math\.random/);
    }
  });
  it('FISH 顺序固定', () => expect(FISH).toEqual(['A', 'B', 'C', 'D']));
});
