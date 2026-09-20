# Round-74 审计返工交接 — 修复窗口（2026-09-20）

Stack：`r74-grill`（7 提交未推）；审计件落 `r74-audit`（本文件+审计报告）。
审计报告全文：`.scratch/grill-round-74/reports/2026-09-20-audit.md`（声明→证据→结论对照+D-xxx 逐项+发现清单）。
裁决：**不通过**——硬验收全绿但含 1 硬违规+1 实质违规+1 过期列报。

## 必修（验收阻断项）

1. **F1 — hero.svg license 伪述（硬）**：`assets/readme/hero.svg:36` 现写 `MIT license · Node.js >= 22`，仓库实为 **Apache-2.0**。改为 `Apache-2.0 license · Node.js >= 22`，或整行删除（meta 行本属 D-003 规格外新声明）。改后**必须重跑 Playwright 渲染核验并重截 `evidence/t1-render-check.png`**——现证据图把错误文案固化在内。
2. **F2 — Date 列迁移半截+伪述句（实质）**：codebuddy(2026-09-16)/claude(2026-09-17)/codex(2026-09-17) 验证日期不在其三篇专文内（grep 全灭）；而 `README.md:179`、`README.zh-CN.md:174`、`docs/adr/0075-*.md:65` 均声称日期已迁专文。二选一：
   - (a) 把三行日期补进三篇专文头（完成 D-004"日期随证据迁专文"原设计）——推荐；
   - (b) 软化三处文案为事实（日期居 ADR 证据集/scratch 证据）。
   注意 zh/EN 锁步同票改。
3. **F3 — `origin/r71-grill` 列报过期**：`git ls-remote --heads origin` 仅剩 `main`，该远端分支已不存在。report/closeout/ADR-0075:96 的"删除候选待确认"表述改事实态（已不存在/或经用户确认后改写）。

## 选修（建议同票带上）

- F6 `hero.svg:88` abstain 卡补 `cold`（canonical 串对齐）；
- F7 被截停射线与 `anysearch` 标签解绑（停射线不指名 provider，或改画"零落格→abstain"语义）；
- F4 pathlint 计数订正（263→实跑值）；F5 `Added(6)`→`(5)`；F8 "8 条续债"枚举补 defer-f16-macos 或改 7；F9 closeout Stack 行收口件归属订正（registry+CHANGELOG 实在 tyu）；
- F10 codebuddy "with/without-tool contrast" 碎片补入专文或记录豁免。

## 重跑清单（修复后同一套硬验收）

```
pnpm build
node apps/cli/dist/index.js --version   # 0.0.7
node apps/cli/dist/index.js doctor      # 25/0/0
node scripts/ship-gate.mjs --quick      # 9/9 绿；回填 pathlint 实跑计数
python3 <beautify-github-readme>/scripts/audit_readme.py README.md README.zh-CN.md   # OK×2
ANS_DOMAIN=docs node apps/cli/dist/index.js search "model context protocol"          # proof 对照
# + 新 hero 渲染核验四检项（900px/360px/深浅底/16px）重新截图归档 evidence/
```

修复提交落在 `r74-grill` 栈顶（新 commit，不改写已述历史）；修完由审计窗口复跑本清单裁决。
