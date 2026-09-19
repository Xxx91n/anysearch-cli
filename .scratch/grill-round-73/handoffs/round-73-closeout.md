# Round-73 → next-round 交接

Stack (primary key = GitButler change-ids; SHAs are time-lagged):
  全栈已落 main，无悬空栈。main tip = dbe52e7c（release 账本 commit）@ 2026-09-19。
  落地序：r71-audit→3028a4a9；r72-grill→409723a7；r72-audit→5f16c8e3；r73-grill→dff7539b；r73 工作栈（T0转录+T1钉版+T2账本+T3 bump）→2ff74bb8；dbe52e7c=pre-tag 账本；v0.0.7 tag 指 dbe52e7c。

## 已完成

- T0 四栈顺序合流+双审计 handoff PENDING 清零（run URL 回填）。
- T1 dsh 族双层钉版：catalog 单点（15×dsh-*=0.1.5-rc.2+cordis=4.0.2）+overrides 逐名枚举；冷态 regen 实证锁内零 0.1.6。
- T2 alpha.2 预演（预期 RED 实证）+升级账本落盘。
- T3 0.0.7 发布：9 manifest+ship-gate pin 同 commit；tag v0.0.7；npm 四包 0.0.7（embedding/cli/mcp/plugin，OIDC provenance）。
- T4 ADR-0074+index regen+deferred-registry 新增 defer-r73-dsh-event-rename+报告+本交接。

## 绿色 run URL（必填）

- 合流段：https://github.com/Xxx91n/anysearch-cli/actions/runs/35448195039/https://github.com/Xxx91n/anysearch-cli/actions/runs/35448195038/https://github.com/Xxx91n/anysearch-cli/actions/runs/35448195040（r71）、https://github.com/Xxx91n/anysearch-cli/actions/runs/35449008756/https://github.com/Xxx91n/anysearch-cli/actions/runs/35449008684/https://github.com/Xxx91n/anysearch-cli/actions/runs/35449008674（r72）、https://github.com/Xxx91n/anysearch-cli/actions/runs/35451319160(attempt2)/https://github.com/Xxx91n/anysearch-cli/actions/runs/35451319130/https://github.com/Xxx91n/anysearch-cli/actions/runs/35451319161（r73-grill）、https://github.com/Xxx91n/anysearch-cli/actions/runs/35452455805/https://github.com/Xxx91n/anysearch-cli/actions/runs/35452455732/https://github.com/Xxx91n/anysearch-cli/actions/runs/35452455768（bump commit）。
- 发布段：https://github.com/Xxx91n/anysearch-cli/actions/runs/35453100400（release post-tag+publish success）；pre-tag dispatch https://github.com/Xxx91n/anysearch-cli/actions/runs/35452475915（账本烧录成功、wait 段外部 cancel）。

## 下一轮候选

- 上游 `@deepseek-ai/dsh-*` 0.1.6-rc.1 或 stable 出线 → 按 upgrade-ledger 跑预演+对账 changelog；采纳时 overrides 枚举按新锁文件重推导（家族已 15→17）。
- defer-r73-dsh-event-rename：session-start→created 迁移（source-guard 伪码在账本里）。
- R72 续债：defer-r72-dsh-plugin-npm-publish / defer-r72-dsh-native-tools / defer-r72-dsh-web-interactive-matrix。
- R71 续债：defer-r71-shipgate-1g-coverage / defer-r71-transformers-undeclared-dep / defer-r71-provider-serverside。

## Known risks / deferred

- 清理候选（未删，待用户确认）：`origin/r71-grill`（d897707a，merge-base 实证已并入 main）。
- CI runner flake 两起已 rerun 绿（windows 挂起、ECONNRESET）；release pre-tag wait 段被外部 cancel（账本与绿 check 已先行完成，不影响发布完整性）。
- 本机 global pnpm 冷态 regen 不写 packageManagerDependencies 块——锁文件 PM 追踪块以 pnpm/setup 系输出为准。

## Suggested skills

$implement / $handoff / $atomcode-research（上游发版调研）/ gitbutler（`but` 全操作）。
