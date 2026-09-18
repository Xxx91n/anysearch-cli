# Round-69 → next-round 交接

Stack (primary key = GitButler change-ids; SHAs are time-lagged):
  r69-grill → dba42e1f + ee3600c3 (T0 火线双修+transcript) → 950f35ea (T1 迁移地基) → bbb3ba73 (T2 README EN) → b61fa73e (T3 README.zh-CN) → 8086ce25 + 4c6b2a1d (T4 parity 门+红绿证据) → 105b67ef (T5 元数据+顺手项+LICENSE) → 89b4fe93 + 86596433 (T6 ADR-0070+CHANGELOG+index regen) → 6c801678 (T7 验收 transcript)

## 已完成

- **T0 火线修红**：`isCloseout` 收窄要求 `closeout|closure` 语义关键词（`^round-\d+` 裸前缀不再单独命中）——双向验证：`round-69-direction.md` 脱靶、`round-67-closeout.md`/`round-68-closeout.md` 仍命中；方向文档补 Stack 头+「绿色 run URL」段引六条实证 run（主张-引证教义）。main 复绿（T0 tip 三绿）。
- **T1 迁移地基**：`D:\Aworker\anysearch-cli\docs\limitations.md`（20 条逐字迁入）；`D:\Aworker\anysearch-cli\docs\adr\index.md` 独立生成件（`gen-adr-index.mjs` 重指向：index.md 自排除 + 行内相对链接 + `--check` fail-closed）；ship-gate step 1b 改靶；`adr-index.test.mjs` 改名重指。
- **T2 README EN 登录页**：312→159 行；switcher+badges×3（npm/ci/license 动态端点全 200）+3 秒主张+Requirements+Quickstart+Domains&abstain+Provider matrix+MCP+verified hosts（Proof 区保留）+limitations top-3 表+docs/limitations.md 指针+Design rationale 三句+docs/adr/index.md 指针；机器路径清零。
- **T3 README.zh-CN.md 伴生件**：顶部翻译件声明（规范以 README.md 为准）+互链 switcher；heading 结构 1:1（levels [1,2×9]）+3 代码块+链接 byte-identical（机验通过）。
- **T4 standing parity 门**：ship-gate step 1h `stepReadmeParity` fail-closed——heading 骨架 1:1（code-fence 感知）+代码块逐块 byte-identical+链接多重集（减互链 switcher）一致+docs/limitations.md 存在且 README 指针可达。红→绿证据对入库。
- **T5 元数据+顺手项**：`gh repo edit` description 产品向一句 EN+topics×9；**LICENSE 修复**——原文件实为变体 Apache-2.0（专利反制/再分发条款被改写→GitHub 判 Other 属实），根+4 发布目录副本换 canonical 全文，push 后 `licenseInfo` 已判 apache-2.0；L-1 绝对路径修；L-2 verify-observation 优雅退出+落库重试窗消 step-8b 抖动；release.yml 双写回退补注释；F-S4 记 deferred。
- **T6 文书**：ADR-0070（D-001/D-003~D-007 六节+Closure 四段+D-002 空号自报）；CONTEXT.md R69 词块 8 条已在账（无新造词）；CHANGELOG r69 条目（Added/Fixed/Changed/Deferred+过程违规自报）。
- **T7 收口**：四段证据齐（见下）；验收基线全绿（build 4pkg/store 62/plugin 10 文件全过/pack×7/cli --help/MCP initialize/fail-open/ship-gate --quick 57×pass committed transcript/assert-checks-green 夹具三腿）。

## 绿色 run URL（必填）

- **T0 tip `ee3600c`**：ci https://github.com/Xxx91n/anysearch-cli/actions/runs/35317461733 · ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/35317461823 · native-smoke https://github.com/Xxx91n/anysearch-cli/actions/runs/35317461732
- **final tip `6c801678`**：ci https://github.com/Xxx91n/anysearch-cli/actions/runs/35321041577 · ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/35321041623 · native-smoke https://github.com/Xxx91n/anysearch-cli/actions/runs/35321041706
- （备注：macos-spillover-probe 持续红为 EXPERIMENT 非阻断 job，门外已知件——libc++abi 未解，见 docs/limitations.md）

## 下一轮候选

- **F-S4 开票**：`assert-checks-green.mjs` 严格两段式 discovery/completion 截止语义——现 timeout-min 兜底沿用已头注文档化，需独立设计票。
- R68 方向三线沿用 deferred：真 release 摘 partial 帽 / agy ans-MCP P7 真链 / PR-mode required-checks 治理。
- deferred 大项池沿用：cursor / F-01a / npm provider / projectIndex / TUI / embedding / cross-OS / plugin / watch。

## Known risks / deferred

- **macos-spillover-probe (EXPERIMENT)** 持续红：libc++abi 退出时崩溃未解，已如实挂 known-limitation（非本轮病灶）。
- **D-002 空号**：R69 grill Q2 曾被跳过未问——过程违规自报，Q6 补问 D-006；空号保留作跳号证据，不追认。
- **step 1h 机检面边界**：heading TEXT 翻译漂移（如 EN 改 "Prerequisites"）不在机检面——结构骨架+code/link byte-identical 已覆盖主要漂移，文本级同步靠评审惯例。
- **LICENSE 修复性质**：对齐 package.json 声明意图的缺陷件归位，非 license 变更；若原变体系有意为之，回退 = `git revert 105b67ef` 的 LICENSE 部分。
