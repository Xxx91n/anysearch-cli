# R66 审计收口交接 — 2026-09-17（audit PASS after rework）

## 一句话状态

R66 全闭环且审计通过：0.0.4 已 OIDC TP 发布（registry+provenance+净机冒烟亲验），审计打回 5 项全部返工修复并亲验绿。栈顶 r66-audit-rework（swq/c84ecd6，已推送）。main 仍在 585a338——栈未合。

## 本轮审计结论（详见 reports/2026-09-17-audit.md + 返工复核）

- 硬验收亲跑全绿：build 4/4、plugin 测试 126/126、tsc 0 错、lint clean、pack×4 内容核、ans --version=0.0.4、doctor 25/0/0、plugin validate ×3 pass、registry latest=0.0.4×4+slsa provenance、CI run 35172953708（gate 18s+publish 1m11s）。
- 打回 5 项→修复亲验：F-01 ship-gate 钉 0.0.4（step1a 模拟过）；F-02 漂移守卫真成立（ANS_GEN_OUT+快照先行；手改→真红→还原证据对在案）；F-03 session-start --envelope 宿主分流（dist 双形实测+真宿主 t4-rework-p6b 信封实发+模型逐字引用第二条 trigger）；F-04 README 0.0.4 化+0.0.4 已发布缺陷诚实入账；F-05 报告命令名修正。
- 过程红线：密钥扫描 0 泄漏；双轨诚实；B 绿后 bump 序成立；fail-open 完整；返工无跑偏（stepInstallVerify 缩进修正语义不变）。

## 移交下一轮的未尽事项（候选 grill 方向，按建议优先级）

1. **0.0.5 发布**（建议下轮 A 段或独立小轮）：published 0.0.4 仍带 session-start 无旗标=信封-only 缺陷（Codex 裸契约破，README 已如实入账）——in-tree 修复需下次发布才送达用户。
2. **合 main**：r66 六分支+audit-rework 已推未合；首个 main push 将首跑新版 ship-gate（step1a=0.0.4 钉已就位）。遗留观察 F-01a：ship-gate step0 clean-tree 读 git status --porcelain，GitButler workspace 下恒脏（索引工件）——本地跑 ship-gate 须净克隆或豁免，未修。
3. **npm prefix 双根部署陷阱**（返工抓出）：npm i -g 默认落 D:/nodejs，e2e 脚本+旧 shim 锚定 Roaming/npm——跨机/跨前缀安装须 --prefix 显式钉或脚本自检 npm prefix -g，否则复验误打旧 shim。 <!-- machine-local: user-level agent/tooling config path on build host @ 2026-09-19 -->
4. **既有 deferred 池**（沿用）：provider 服务端排查、projectIndex 双库裁决、interactive TUI、embedding arm、跨 OS matrix、Cursor/Codex/Antigravity 真宿主、plugin 升格默认路径（判据>=2）、watch 观测窗值守。
5. 观测项：ans_chat 空正文（ANS_LLM_* 上游端点缺=环境项）；引擎 verdict 恒 ambiguous 时 PostToolUse 合法跳索引（机制已验）。

## 关键事实（勿重查）

- 发布通道：release.yml publish job=tag push 触发+needs:release-gate+id-token:write+npm@11.6.1+pnpm pack×4+publish --provenance——v0.0.4 已实证（TP 四包已配好，后续发布同法）。
- 宿主契约（Claude 2.1.251 实测）：决策键必须入 hookSpecificOutput；settings 钩须官方 schema（非法条目毒化同事件整列）；Pre/Post 钩子真跑但零 stream-json 事件；type:http 被静默丢；session-start 双形=--envelope 旗标。
- 返工证据：t4-rework-p6（裸形被宿主吞，复证 ER-2）/t4-rework-p6b（信封+引用闭环）在 .scratch/grill-round-66/evidence/。
- VC：全走 but；tag 无 but 命令用 git（灰区已记）。

## Suggested skills

- 下一轮 grill 开门：$grill-me / $to-questionnaire（主题定界+账本）
- 实施票：$implement（tdd 于既定 seam）+$code-review（diff 双轴）
- 发布执行：docs/publishing.md §OIDC TP 段落 + 本轮审计重跑清单
- 交接：$handoff