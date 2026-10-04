// 视图共享常量与工具，避免 ocean-view 和 fish-school-view 互相引用
export const SPECIES_COLOR: Record<string, number> = { R: 0x6f8f7a, A: 0x7fc8f8, B: 0x9b8cff, C: 0xf2b134, D: 0xef6f6c };
export const SPECIES_CSS: Record<string, string> = Object.fromEntries(Object.entries(SPECIES_COLOR).map(([k, v]) => [k, '#' + v.toString(16).padStart(6, '0')]));

/** 水体尺寸（场景单位）：x 宽，y 高（三层等高），z 深 */
export const TANK = { w: 24, h: 18, d: 12 };

/** 有种子的独立随机数流（只用于渲染布局，与生态核心无关） */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
