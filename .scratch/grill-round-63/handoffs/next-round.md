# Round-63 Grill → Implementation Handoff（npm 0.0.1 go/no-go 终审 + 前置清障）

日期：2026-09-15 · slug：grill-round-63 · 主键=GitButler change-ids（SHA 时滞后勿引）。

## 数据源（接手先读）

- 决策账本：.scratch/grill-round-63/decision-ledger.md —— D-001..D-008 全部 current，每项含原问题/用户原答原文/规范化需求/约束。
- 调研报告：.scratch/grill-round-63/{q2,q3,q5,q8}-atomcode.md —— 各票工业先例与来源清单。
- 词表：CONTEXT.md 末尾「Grill Round 63 — Terms (ADR-0064)」七条新术语（Bundled-CLI Publishing / Peer-Optional Capability / Canonical Rewrite Exemption / Quarantine Ratchet / Resolvable Self-Witness / GO WITH CAVEATS / Unpublish Window）；Install Closure 的机制句已按 D-005 更正为 peer-optional。
- 上轮背景：.scratch/grill-round-62/handoffs/2026-09-15-audit-handoff.md + 锐评原文 .codex-tmp/锐.txt（逐条已实物核实）。

## 票序 T1–T8（串行，D-007；每票独立验收锚）

### T1 — con_add_then_noop 修复（覆盖 D-002；Blocker）
- packages/store/src/consolidate.ts decideOp 加无-embedding 分支：emb 缺席时 bestJac>θ_jac 判 noop。θ_jac 取保守端 0.7–0.85，票内对 golden 数据集跑 jaccard 分布校准后定值；与现有 0.4 update 门槛显式区分文档化。
- pure-function 单测；observational zone 记 embeddingAbsent 计数；CHANGELOG Fixed；release notes 记行为变更（无-embedding 环境重复记忆开始判 noop）。
- 验收锚：con_add_then_noop 在无网环境转绿=embedding-absent 回归哨兵；consolidate.ts:200 注释承诺兑现。
- 禁：挪案例进 OFFLINE_EXCLUDED_GROUPS / 放宽 ship-gate D-005 断言 / 桩 embedding seam。

### T2 — 发布形态改造（覆盖 D-005；依赖：无）
- LICENSE 文件（Apache-2.0，D-007）+ license 字段 + repository 字段 + publishConfig.access:public 写入 4 个发布目标（apps/cli、apps/mcp、apps/plugin、packages/embedding）。
- 3 个 app 的 manifest：已 bundle 的 @anysearch/* 从 dependencies 移 devDependencies（源码内如实声明 build-time 依赖）。
- @anysearch/embedding：翻 private:false；在各 app manifest 中从 optionalDependencies 改 peerDependencies+peerDependenciesMeta.optional:true。
- ship-gate 加断言：dist 无裸 require("@anysearch/（noExternal 保证的回归防）。
- 实测 pnpm workspace 开发期是否自动 link peer（auto-install-peers 行为）；若不链，dev 体验补救写进票说明。
- 验收锚：pnpm pack 后 app tarball manifest 的 dependencies 无 @anysearch/*；peer-optional 声明在。

### T3 — 隔离集棘轮断言（覆盖 D-003；依赖：无）
- scripts/ship-gate.mjs 加三断言：eval-quarantine.json entries 相对基线只减不增（新增即红）；renewals 全 0（续期即红）；任一条目过 expiresAt 而无 promote/retire/转长期裁决记录即红。
- 基线形态票内定（快照常量或独立基线文件）；转长期出口至多一次。
- 验收锚：断言存在且实跑；构造扩容/续期/过期三场景变红。

### T4 — rework 包 + 小刀（覆盖 D-004；refactor/docs 提交分离，ADR-0029）
- F-1 README Known Limitations 补「exit-time libc++abi 可改写 abstain exit code（实证在 Windows）」+ 新增 macOS 注册段红行（better-sqlite3 registration check failure，探针数据点#1，非阻塞计时中）。
- F-2 ship-gate.mjs:531 ④断言补强为 job+test:online 步双断言。
- F-3 scripts/probe-tavily-domains.mjs OUT_DIR 改指 round-62（防覆写 r61 SKIPPED 原件）。
- F-4 CONTEXT.md R61/R62 七条新术语补 _Avoid_ 行（R63 术语已带，勿重复）。
- F-5 可选：macos-exit-probe 复现腿钉死 abstain 路径。
- 锐4 小刀：.gitignore:41 注释改 D5c 真政策；packages/store/src/embedding-arm.ts 头注补「consolidate 去重在 arm 缺席时降级，见 T1 票」。

### T5 — 发布验证面（覆盖 D-005/D-006；依赖 T2）
- install-smoke.mjs 改消费者真实形态：只装 app tarballs（bundled 后内部包 tarball 不再同装——更贴真实 npm 路径）。
- peer-optional 双装链路验证：npm i -g cli tarball + embedding tarball 同落 global node_modules 根、Node 解析可达→进 ADR-0020 pack+install 验证步。
- 发布步骤文档：含 min-release-age=2 的自验覆盖方式（npm i -g --min-release-age=0 或直装精确版本）

### T6 — 排序回归调查票（覆盖 D-003 内含；预注册、不阻塞发布）
- 先查 10 条 live drift 根因是否单一（单 provider 排序算法变更？），若单一根因修复收敛快。
- 方向：RRF 权重 / URL 归一化（www 前缀、locale 路径 /zh/、版本路径 /10.x/ 命中模式）。
- 与 TTL 2026-10-14 联动：到期前必须有裁决（promote/retire/转长期≤1 次）。

### T7 — 发布材料收口（覆盖 D-001/D-002/D-003/D-005/D-008；依赖 T1–T5）
- README：npm 安装主路径（npm i -g @anysearch/cli）+ Known Limitations 全表——macOS 注册段红、页面级精度口径（host 级 12/12、abstain 在线验证过、页面级硬断言 2/12、10 条隔离带 TTL 2026-10-14）、FTS-only 行为变更（T1）。
- release notes 草案：含「0.0.1 手动首发无 npm provenance，系 D-006 已知后果非缺陷」声明。
- docs/adr/0064-architecture-grill-round-63-*.md：全决策条目化 + canonical-rewrite 豁免判据（仅限包管理器 canonical 语义、禁自建 transformer）+ Closure evidence 四部结构（D-008）+ 引用 R63 术语。
- CHANGELOG：Apache-2.0 标注、Fixed dedup 降级、Added 发布管线条目。

### T8 — go/no-go 终审书 + 发布执行（覆盖 D-001/D-006/D-008；殿后）
- 裁决书逐条对账：Blocker 清零（T1 落地+净机 eval 绿）/ 带病留痕（棘轮断言存在+Known Limitations 全表）/ 前置清障（LICENSE+manifest+形态）。
- 若 go 的执行序列：注册 @anysearch scope 占名（可先单独做，无论 go/no-go 建议做）→ T1–T7 全落后 main tip ci+ship-gate 绿 run URL → gh workflow dispatch release.yml runPurpose=pre-tag（花 OF look）→ git tag v0.0.1 + push → post-tag 断言绿 → 用户本机 pnpm -r publish（apps×3+embedding）→ 72h unpublish 窗内净机自验（registry 拉取、min-release-age 覆盖、冒烟含 FTS-only 配置）→ registry manifest 复核（versions/dist-tags.latest/access/repository）→ release notes 挂出 → ADR-0064 Closure evidence 回填全部 URL。
- 若 no-go：差距清单+事件驱动复评触发（Blocker 修复+main tip 双绿）+30d 日历兜底；带病项逐条 owner+due+关闭判据+判定权委托。

## 环境/权限备忘
- npm：用户已本机 npm login；publish/tag/push 由用户亲手执行或当场授权（不可逆外部副作用）。
- TAVILY key：环境变量 1（不明文，已 gh secret set 于 R62）。
- 版本控制：一律 but；与其他分支并行互不影响；不 push 未经授权。
- 默认执行环境：shell=bash（ctx_execute/ctx_batch_execute）；写文件用 node.js fs。
- 探针钟：macos-spillover-probe 数据点#1=注册段红（run 34927388026），TTL 连绿计数从 #1 起算（≥5 连绿评估复矩阵）。
- 隔离钟：eval-quarantine.json 10 条 expiresAt 2026-10-14，到期强制三出口裁决。

## Suggested skills
- $implement（T1–T5 源码/断言票）· $but（栈操作/提交）· domain-modeling（ADR-0064 与词表维护）· atomcode-research（T6 根因调查若需外部先例、θ_jac 文献复核）· neat-freak（收口核对）· $handoff（下轮交接）。
