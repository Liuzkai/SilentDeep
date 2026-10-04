# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目现状

SILENT DEEP 是一款核战后末世潜艇游戏，整个游戏都在复古 CRT 终端界面上进行。目前仓库有设计文档、参考图，以及一个浏览器 UI 交互原型 `prototype/`（纯静态 HTML/CSS/JS，无构建步骤、无依赖，只做界面探索，不含真实玩法；运行方式和结构见 `prototype/README.md`）和一个生态模拟项目 `deep-sea-ecosim/`（见下文）。`prototype/` 没有 lint、测试命令，目录不是 git 仓库。正式引擎还没定（文档里提到网页、Godot、Unity 都可行）。

原型约定：每个界面模块是 `prototype/js/` 里的一次 `SD.register({ code, cn, ph, fkey, create })` 调用，`code` 沿用下面的大写代号；新增模块要在 `index.html` 引入，并更新 `prototype/README.md` 的表格。

`deep-sea-ecosim/` 是海洋生物系统的生态模拟（按 `docs/EcosimModel.txt` 实现），和 `prototype/` 相互独立。它有构建和测试：在该目录下 `npm install`、`npm test`、`npm run build`、`npm run simulate -- --days 5000`。`src/sim/` 是生态核心，不得引用 `view/`、`ui/`、Three.js 或 DOM（有测试检查）；改公式后要跑测试并看 `REPORT.md` 里的账本和 dt 误差。

## 文档分工

- `README.md`：一句话简介和目录索引。新增文档时要同步更新这里的目录
- `docs/worldbuilding.md`：世界观、势力、变异生物、资源、主线谜团、核心玩法循环
- `docs/ui-and-audio.md`：参考图分析、视觉方向、界面模块、交互规则、音效、实现备忘、待办

两份文档互相依赖：世界观里的机制（反应堆噪声、没有 IFF、惯性导航误差、声纹库残缺）在界面文档里都有对应的操作界面。改动一边的机制时，要检查另一边是否需要跟着改。

## 核心设计支柱（贯穿两份文档）

- **界面即剧情**：TUI 是有剧情理由的（EMP 烧毁了现代设备，只剩抗辐射老终端，系统叫 `TACNET-7`）。设备损坏、花屏、乱码要做成玩法，而不是单纯的视觉特效
- **反应堆两难**：功率越高能力越强，噪声也越大、越容易招来怪兽。`ELEC` 界面是这个矛盾的操作入口
- **敌我识别是核心难点**：靠声纹、行为、水声通讯判断，且存在欺骗（海盗伪造声纹、回声体模仿人类）。`SONAR`、`DIFF`、`CONTACT LOG` 都服务于这一点
- **声音即信息**：音效分环境层、设备层、信息层，信息层的声道对应目标方位；寂静本身是警报

界面模块用大写代号称呼（`BOOT`、`TACPLOT`、`SONAR`、`CONTACT LOG`、`ELEC`、`CHART`、`APPROACH`、`DIFF`、`BESTIARY`、`REPORT`、`COMMS`、`WEAPONS`、`HULL`），新写内容时沿用这些代号。

## 参考图规则

- `refs/seen/`：已经逐张看过、内容写进 `docs/ui-and-audio.md` 第一节表格的图，文件名是 `NN-描述.jpg`
- `refs/unseen/`：还没核对过的图（Pinterest 看板 liuzkai2012/uxui 的图，以及最早直接发来的 `sent-ref*.jpg`）。`_board-urls.txt` 是看板图的原始链接
- **没有亲眼看过的图，不要基于它做设计判断。** 核对一张图时：用 Read 工具实际查看图片，移到 `refs/seen/` 并按编号改名，在第一节表格里补一行"实际内容 / 可以借鉴的地方"，再更新文中的数量和待办

## 写作约定

- 文档用中文，标题标注草案版本（当前 v0.1）
- 行文平实、短句，先说结论再说理由；设计提案和有参考图支撑的内容要分开标明
- 游戏内写法：日期用静默纪元格式（如 `37.114`），接触目标编号 `S-03`，本艇 `SS-鲸落`
- 视觉方向尚未定稿（单色磷光为主 vs. 混用彩色），不要在其他文档里把它当成已决定的事项
