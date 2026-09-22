# Round-78 → next-round 交接

Stack (primary key = GitButler change-ids; SHAs are time-lagged):
`r78-grill` → `kok`（账本/任务书定稿+CONTEXT 七词+三份调研存档+round-78 白名单）；`r78-impl`（叠于其上）→ `nkv`（T1 fix：存量 96 违例清理 97 动作/52 文件）→ `zun`（T1 refactor：token+分隔符组合判定器+棘轮腿+红绿 fixture）→ `ryr`（T1 chore：minimumReleaseAgeIgnoreMissingTime:false）→ `qqy`（T2 文书批：ADR-0079+registry 核销+upgrade-ledger v2 消解+evidence 归档）→ `ovm`（index regen 79 条）→ 收口批（报告+本行定稿，change-id 见 `but status`）

主题：治理工具链校准——两件 R77 审计残账清算：①pnpm minimumReleaseAge 对 catalog repin 的拦截边界实测（7 格判决矩阵）；②pathlint env-var 盲区重构为 token+分隔符组合判定器。

## 已完成

- **T0 repin 拦截实验**（纯取证零提交，真身字节零脏）：7 格预登记判决矩阵实跑，transcript `evidence/t0-repin-matrix.md`。E1（scratch 对照成熟版）✅、E2（scratch 闸内版 → `ERR_PNPM_NO_MATURE_MATCHING_VERSION`）✅、E3（strict:false 显式旁路成功+自动追加 exclude）✅、E4（真身 catalog repin 非 frozen → 同错误码）✅、E5（frozen → `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`，语义一致执法点不同）✅、**E6 证伪**——lockfile 携闸内版 + frozen（温/冷 store、显式 strict:true）+ `pnpm fetch` 五变体全静默放行，`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 在 pnpm 11.24.0 不触发；#11583「lockfile 复核通道」调研结论与本机实测矛盾，以实测为准，断言收窄落锚 ADR-0079 D3+upgrade-ledger v2。E7 记档态（npmjs 恒带 time 无标本）→ 加固项 `minimumReleaseAgeIgnoreMissingTime:false` 落盘+install 绿。真身恢复：`pnpm-workspace.yaml` sha 前缀 c68dfcff…、`pnpm-lock.yaml` ce7fdbe9… 字节级还原+末态 install 绿。
- **T1 pathlint 重构**（一票三 commit）：warn-first 全量扫 313 注册文档实录 96 违例（93 missing-marker/2 stale/1 malformed）+685 info（`evidence/t1-warn-sweep.md`）→ driver 处置 97 动作/52 文件（`evidence/t1-remediate.md`，含判定器上线首日自证捕获的三处失效 marker）→ 复扫残存 0 翻 fail-closed。判定器=`scripts/ship-gate-pathlint-detect.mjs`：四类新 token（`%VAR%`、`$VAR`/`${VAR}`、`~/`/`~\`、`\\host\`）+既有字面形，后随分隔符才算 locator；裸 env-var 散文不报；`/x` 单段 POSIX 根 info surfaced-skip；失效标记棘轮腿；inline code 不豁免；红绿成对 fixture+9 断言（`packages/store/test/ship-gate-pathlint.test.mjs`），两逃逸实例（adr-0042:111 形+R77 scratch-snap 形）固化红向。 <!-- machine-local: 判定器 token 形态示例引用（closeout 文书） @ 2026-09-22 -->
- **T2 文书收口**：ADR-0079 落档（组合判定器+豁免三层模型+棘轮审计+判决矩阵实录+断言收窄文本+IgnoreMissingTime 加固理由+不 bump 判定）+index regen 79 条；`defer-r77-pathlint-envvar-blindspot` → closed（canonical normalize 保字节锁）；落选债 11 条 carried_log r78 显式续记；upgrade-ledger v2 待校准项消解+收窄断言落锚；pathlint 登记 round-78 复核——config `scratchDocDirs` 已含 evidence/handoffs/reports，无需改。
- **门禁全绿**：`pnpm turbo run check` 8/8；`pnpm turbo run test --continue=dependencies-successful` 13/13（pathlint 新测试随 store 包行使 9/9）；`pnpm install` 绿（supply-chain policy 491 条核验过）；ship-gate --skip-matrix 全腿绿（含 pack×8、clean-prefix install、smoke、MCP stdio、fail-open boot）。
- **进程测活**：ship-gate step 5 完成 clean-prefix 安装+`--version`+doctor 冒烟（详见报告）。

## 绿色 run URL

本栈未 push（规则：不 push 不 PR）——**PENDING — stack unpushed**。最近落地绿 run（r76-audit 栈 land，为本轮历史祖先）：

- ci: https://github.com/Xxx91n/anysearch-cli/actions/runs/35701346942
- ship-gate: https://github.com/Xxx91n/anysearch-cli/actions/runs/35701346911
- native-smoke: https://github.com/Xxx91n/anysearch-cli/actions/runs/35701346920

## 下一轮候选

- **defer-r73-dsh-event-rename L2 排程临近**（首要）：闸内标本 0.1.7-alpha.1/0.1.5-rc.3 ≈2026-09-24 06:0xZ 出闸；出闸后若 rc-or-stable 线版本携特征锚 → L2 彩排（expected-RED=`ctx.on('agent/session-start')` TS2345）；alpha 线继续只 L1。
- **龄期闸收窄后果跟进**：E6 证伪意味着「lockfile 已携闸内版」场景无闸兜底——若 CI 依赖 frozen install 挡闸内版需另加护栏（lockfile diff 评审纪律/限制 strict:false 写入路径）；本轮已将断言收窄入 ADR-0079 D3，是否再加机器腿由下一轮裁决。
- **pathlint 残余盲区**（诚实登记，ADR-0079 Consequences）：多段未知根 POSIX 路径（含 gitbash `/d/`、`/c/` 盘符形）不报；若审计需要可再议是否扩类。
- **#1764 merge 观察哨**：上游仍 OPEN（截至 2026-09-22），merge 后核实发布版 manifest 携 `onnxruntime-common` 声明。
- **外发闸**（用户亲手发）：`.scratch/grill-round-75/drafts/pr-1764-comment.md` + `issue-1087-comment.md` 仍待用户审发；发后回录 drafts 头部 Status 行。

## Known risks / deferred

- 落选续债 11 条（原名逐字，`carried_log` r78 显式记）：`defer-anysearch-domain-ownership` / `defer-f16-macos-native-crash` / `defer-f17-quarantine-ids` / `defer-r71-provider-serverside` / `defer-r71-transformers-undeclared-dep`（#1764 哨）/ `defer-r72-dsh-plugin-npm-publish` / `defer-r72-dsh-native-tools` / `defer-r72-dsh-web-interactive-matrix` / `defer-r73-dsh-event-rename`（L2 临近）/ `defer-r74-logo-bitmap-matrix` / `defer-r75-registerhooks-esm-arm`。
- **E6 证伪结转**：调研断言「modern pnpm 逐条目复核 lockfile」不成立——已收窄为「解析路径执法、回放路径不执法」；监控面=若上游后续版本真启 lockfile 复核，本断言可回扩。
- **WORKFLOW.md 依旧缺位**（R60/R70/R75/R77/R78 五次先例核销）：以 GitButler skill+全局 but 协议等价覆盖 §4.2/§4.4，报告内如实记档。
- E5 实录错误码与预登记不同（`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`）——执法点分层事实已录，非闸失效。

## Suggested skills

- `$implement`（实施票流）、`$but`（GitButler 全部写操作）、`$atomcode-research`（串行配额调研）、`$handoff`（收口交接）。
