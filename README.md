# SILENT DEEP

核战争之后的末世海洋。玩家是一艘核动力潜艇的指挥官：没有卫星，只能靠声呐感知世界；外面全是污染，人只能待在艇里。玩家要猎杀变异巨兽，还要分辨遇到的人类舰艇是敌是友，让潜艇尽可能活下去。

整个游戏都在复古 CRT 终端上进行。玩法来自玩家在界面上的决策，沉浸感靠界面和音效来提供。

## 目录

- [docs/worldbuilding.md](docs/worldbuilding.md)：世界观、势力、生物、资源、主线
- [docs/ui-and-audio.md](docs/ui-and-audio.md)：参考图分析、界面模块、交互规则、音效设计
- [prototype/](prototype/README.md)：浏览器 UI / UX 交互原型（不含真实玩法），打开 `prototype/index.html` 即可运行
- [deep-sea-ecosim/](deep-sea-ecosim/README.md)：海洋生物系统的生态模拟核心与 3D 可视化（TypeScript + Vite + Three.js），方案见 `docs/EcosimModel.txt`
- `refs/seen/`：已经核对过内容的参考图
- `refs/unseen/`：还没核对过的参考图（来源：Pinterest 看板 liuzkai2012/uxui）

## 许可

本仓库中 Liuzkai 的原创代码及其原创配套文档采用 [MIT 许可](LICENSE)，允许使用、复制、修改和商业分发；分发软件副本或实质性部分时，须保留版权声明及完整许可声明。无需在产品界面署名。第三方组件或内容仍遵循各自的原许可，相关版权及许可声明必须保留。

MIT 范围包括 `prototype/` 和 `deep-sea-ecosim/` 的原创实现。`refs/` 下的 Pinterest／其他来源参考图及文档中引用的第三方图文不在此授权范围内；其权利归原权利人，未标明许可不代表可自由再分发。Three.js 和其他依赖保留原许可。
