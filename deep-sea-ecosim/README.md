# 无岸：简化深海生态模拟器

一个可交互的三层深海水体，用来观察食物网关系，以及捕捞和基础饵料补给变化引发的生态反馈。重点是生态因果关系正确、数值可验证、结果可解释。

机制探索原型，参数没有用真实数据校准。生物量单位 BU 是归一化碳生物量，不是千克，也不是鱼的数量。模型细节见 [MODEL.md](MODEL.md)，测试与实验结果见 [REPORT.md](REPORT.md)。

## 环境

- Node.js 22（在 v22.23.2 / npm 10.9.8 上验证）
- TypeScript 7.0、Vite 8.3、Three.js 0.186、Vitest 5.0、tsx 4.23（版本锁定在 `package-lock.json`）
- 不需要后端、账号、云服务或外部美术资源

## 命令

```bash
npm install                 # 安装依赖
npm run dev                 # 开发服务器，浏览器打开终端里给出的地址
npm run build               # 类型检查 + 生产构建，输出到 dist/
npm test                    # 运行全部测试
npm run simulate -- --days 5000                          # 无捕捞基线，导出 CSV 和报告到 results/
npm run simulate -- --all --days 3000 --warmup 1000 --every 5   # 五组对照实验
npm run simulate -- --experiment B --days 3000 --warmup 1000 --u 0.8
```

`simulate` 的选项：

| 选项 | 含义 | 默认 |
|---|---|---|
| `--days` | 运行时长（模拟日） | 5000 |
| `--experiment A\|B\|C\|D\|E` / `--all` | 运行对照实验（不给则只跑基线） | — |
| `--warmup` | 无捕捞预热时长，两组共用同一预热快照 | 0 |
| `--u` | 捕捞强度 0–1 | B/C 为 0.5，D 为 0.3 |
| `--target A\|B` | 实验 C 的捕捞对象 | A |
| `--layer 1\|2\|3\|all` | 捕捞层 | all |
| `--start` / `--stop` | 干预开始 / 实验 D 停止时刻（相对实验起点） | 100 / 1500 |
| `--supply` | 实验 E 的补给倍率 | 0.5 |
| `--every` | CSV 记录间隔（模拟日） | 1 |
| `--dt` | 覆盖时间步 | 0.2 |
| `--out` | 输出目录 | results |

## 界面

- **三层水体**：拖动旋转、滚轮缩放；可以开关层边界和各物种显示。鱼群只是生物量的抽样表现，右上角显示可见实例数和预算
- **控制**：暂停 / 继续 / 单步 / 重置；推进速度（模拟日/现实秒）；捕捞目标、层、强度 u；基础饵料补给倍率；对照实验预设（可设预热时长）；显示或隐藏对照曲线；导出实验记录 JSON 与曲线 CSV
- **生物量时间曲线**：实线实验组，虚线对照组，竖虚线是干预时刻；可切换对数纵轴
- **分层生物量与捕获**：每层 BU、本期捕获速率、累计捕获；极低但非零标"低"
- **食物网**：箭头从食物指向消费者，线宽来自当前步的实际摄食通量 C/h
- **收支明细**：选中物种的摄食收益、被捕食、背景、捕捞、层间交换、净变化，全层合计和逐层分解

界面上的捕捞和补给只作用于实验组，对照组始终不干预。所有修改都带模拟时间戳记在"干预记录"里，导出的 JSON 包含参数、预热时长和干预日程，可以用来重放。

## 代码结构

```
src/sim/            生态核心（不依赖 Three.js / DOM / 帧率）
  types.ts          状态、参数、干预、账本类型
  config.ts         默认参数与校验
  initial-state.ts  createInitialState / validateState
  feeding.ts        摄食需求 U
  fishing.ts        捕捞率 F
  flux-step.ts      统一移除与提交
  migration.ts      层间再分配
  ledger.ts         checkBudget、收支分解、食物网通量
  simulator.ts      step()、Simulator
  scenarios.ts      runScenario、对照实验、CSV
src/view/           3D 表现（只读生态状态）
src/ui/             控制、曲线、食物网、收支明细、固定步长推进器
tests/              Vitest 测试
scripts/simulate.ts 命令行入口
results/            默认实验的 CSV 与报告（由 npm run simulate 生成）
```

主要接口：`createInitialState(config)`、`step(state, config, interventions, dt)`、`runScenario(config, schedule, duration)`、`validateState(state)`、`checkBudget(previous, next, ledger)`、`runExperiment(config, id, duration, opts)`。
