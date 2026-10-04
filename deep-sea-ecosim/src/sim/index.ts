// 生态核心的公开接口。本模块及其依赖不得引用 view/ 或 ui/。
export * from './types';
export * from './config';
export { createInitialState, cloneState, validateState, total, poolTotal, zeros } from './initial-state';
export { feedingDemand } from './feeding';
export { fishingRates } from './fishing';
export { fluxStep, lossRates } from './flux-step';
export { migrate } from './migration';
export { checkBudget, poolBreakdown, webFlux } from './ledger';
export { step, Simulator } from './simulator';
export * from './scenarios';
