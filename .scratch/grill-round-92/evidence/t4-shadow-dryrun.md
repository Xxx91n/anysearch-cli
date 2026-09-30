# T4 证据档 — readme-token-pin 检查器接线与 Shadow Dry-Run 取证

时间戳: 2026-09-30T09:12+08:00
覆盖: D-001 / D-003
性质: **SHADOW DRY-RUN（只读、证据归档、不入判词、不阻塞）**

## 1. 检查器接线立法背景 (ADR-0092 D4 两拍之第二拍)
- 第一拍 (R91 T5): 定义 `readme-token-pin` claim kind，在 closeout-claims 中以 narrative 声明。
- 第二拍 (R92 T4): 在 `scripts/ship-gate.mjs` (stepDocClaims) 中正式接线实现 `readme-token-pin` 断言逻辑，支持比较 README 中指定 host 行版本 token 与预期或命令实测版本。
- 专属机器腿首跑状态: 显性挂账至 R93（两拍后正式执行）。

## 2. Shadow Dry-Run 执行实测
- 实测宿主安装版本 (`dsh --version`): `0.1.7-rc.2`
- 检查目标 1 (`README.md:227`):
  - 声明行: `| DeepSeek Harness (`dsh`) | 0.1.5-rc.2 | MCP bridge patch + `dsh-plugin` Cordis bundle | live-verified (headless + web profile) · [doc](docs/deepseek-harness-integration.md) |`
  - 提取声明版本: `0.1.5-rc.2`
  - 预期版本: `0.1.7-rc.2`
  - 比对结果: `MISMATCH (0.1.5-rc.2 vs 0.1.7-rc.2)`
- 检查目标 2 (`README.zh-CN.md:217`):
  - 声明行: `| DeepSeek Harness（`dsh`） | 0.1.5-rc.2 | MCP 桥 patch + `dsh-plugin` Cordis bundle | 实机验证（headless + web profile） · [专文](docs/deepseek-harness-integration.md) |`
  - 提取声明版本: `0.1.5-rc.2`
  - 预期版本: `0.1.7-rc.2`
  - 比对结果: `MISMATCH (0.1.5-rc.2 vs 0.1.7-rc.2)`

## 3. Shadow 性质与结果分析
- **Shadow 性质说明**: 本次 dry-run 为接线后的只读验证，仅用于证实检查器解析逻辑生效，不作为 release 阻塞门槛，不得误读为跑了专属机器腿。
- **结果分析**: 由于 R92 T2 判词落入 F-bug 分支，T3 条件票【未启】，README 保持 0.1.5-rc.2 历史声明未变，因此比对输出呈现预期的版本差异（0.1.5-rc.2 vs 0.1.7-rc.2），充分证明断言检查器能精准捕获声明漂移。
- **合流结论**: 检查器已成功接入 `scripts/ship-gate.mjs`，支持 shadow 模式与严格模式，首跑专属机器腿挂账 R93。
