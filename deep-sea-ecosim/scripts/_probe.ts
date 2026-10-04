// 临时探针：分段计时（不属于交付物）
import { DEFAULT_CONFIG, cloneConfig, createWorld, createModel, createInitialState, step, environment, advanceRain, NO_INTERVENTION } from '../src/eco';

const w = createWorld(), m = createModel(w, cloneConfig(DEFAULT_CONFIG));
let s = createInitialState(m, NO_INTERVENTION);
for (let n = 0; n < 50; n++) s = step(m, s, NO_INTERVENTION).state;   // 预热 JIT
const N = 300;
let t = performance.now();
for (let n = 0; n < N; n++) environment(w, m.config, s, NO_INTERVENTION, m.vv);
const tEnv = (performance.now() - t) / N;
t = performance.now();
for (let n = 0; n < N; n++) advanceRain(w, m.config, s, 0.2);
const tRain = (performance.now() - t) / N;
t = performance.now();
for (let n = 0; n < N; n++) s = step(m, s, NO_INTERVENTION).state;
const tStep = (performance.now() - t) / N;
console.log(`每步 ${tStep.toFixed(3)} ms；其中 environment ${tEnv.toFixed(3)} ms，advanceRain ${tRain.toFixed(3)} ms；格子 ${m.N}，物种 ${m.P}`);
console.log(`5000 日 = ${5000 / 0.2} 步 ≈ ${(tStep * 25000 / 1000).toFixed(1)} s`);
