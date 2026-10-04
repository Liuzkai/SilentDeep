import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // 完整海域的长时间测试要跑几千步，默认 5 秒不够
    testTimeout: 120000,
  },
} as never);
