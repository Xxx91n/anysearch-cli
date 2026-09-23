# Round-79 → next-round 交接

Stack (primary key = GitButler change-ids; SHAs are time-lagged @ 2026-09-23):
`r79-grill` → `nxx`（账本/任务书定稿+CONTEXT 七词+三份调研存档+round-79 白名单）；`r79-impl`（叠于其上）→ `rmm`（T0：dsh 0.1.7-alpha.2 哨戒取证）→ `skq`（T1-c1：`/x` surfaced-skip 移序）→ `ylk`（T1-c2：WORD_CHAR 补 `_`）→ `lxs`（T1-c3：ADR-0072 amendment+AGENTS.md 镜像+镜像断言+marker 清剿）→ `sql`（T2：ADR-0080+index+registry+CHANGELOG+报告/交接）；`r79-audit`（叠于其上）→ `run`（独立审计+返修窗）。

主题：pathlint 豁免域契约收敛——R78 审计残账一票清算：实现早已豁免而文本未开列的 drift Codify 立法（三豁免域）、`/x` surfaced-skip 散文面限定、WORD_CHAR 缺 `_` 致标识符粘连盘符误报；T0 ride-along dsh alpha.2 取证（action=none required）。

## 已完成

- **T0 哨戒取证**（纯证据零代码，依赖面零脏）：`evidence/t0-l0-watch.json`（28 版本，dist-tags latest=0.1.0-rc.6/next=0.1.5-rc.3/alpha=0.1.7-alpha.2）+ `t0-l1-alpha2-raw.json`（六包 Events union=27≡alpha.1，removed=`agent/session-start`，无 added）+ `t0-watch-alpha2.md`（结论行+观测窗口截至戳）。特征锚在位（`agent/created` 携 `source`/`signal`）但 alpha 线稳定锚不属 → 非 L2 候选；发版面 21 dsh-*（`dsh-code-runtime` 缺席）+`cordis ~4.0.4` 线；rc.3/alpha.1 ≈09-24 出闸窗内复核仍在闸。
- **T1 契约收敛批**（一票三 commit，红向先实测）：c1 `detectSurfacedSkips` 产出移序至 fence `continue` 与 locator 判定之后——所有 fence（marker 覆盖与否）+`Stack:` locator 行零 info，散文 `/x` 照旧产（红向实录 `t1-c1-red.md`：豁免域内 info 泄漏 2/12 fail，语义核对一致）；c2 `WORD_CHAR` 补 `_`——`foo_C:\x` 形不误报、裸 `C:\x` 仍拦（红向实录 `t1-c2-red.md`：missing-marker FP+detectHits=1，3/13 fail）；c3 ADR-0072 D1 amendment 三豁免面立法+AGENTS.md 镜像段+`ship-gate-pathlint.test.mjs` 镜像一致性断言（exemption-domain 四关键词双载体在位）。近邻成对 fixture 全齐：covered↔unmarked in-repo、locator↔非 locator in-repo、fence 内↔散文 `/x`、`foo_C:\x`↔裸 `C:\x`。 <!-- machine-local: 判定器用例字面量复述（收口文书） @ 2026-09-23 -->
- **T2 文书收口**：ADR-0080 落档（豁免域契约+drift 归因=文本侧未审视/实现侧有意图+rejected alternatives=Revert 毁 transcript 保真/逐面混裁内聚差+豁免扩大风险三重缓解+结构性同构先例标注+不 bump）；`docs/deferred-registry.json` canonical（11 债 carried_log r79 + 新条目 `defer-r79-lockfile-agegate-replay`→R80 候选）；index regen 80 条；CHANGELOG r79 段；CONTEXT 七词随 grill 在位；`.gitignore` 白名单在位。
- **门禁全绿（返修后终态）**：`pnpm run check` 8/8、`pnpm run test` 13/13（store 78/78 含 adr-index+pathlint 15 cases）、pathlint 直跑 333 docs/0 violations/infos 736+、`ship-gate --skip-matrix` 全腿绿、`pnpm install` clean、CLI 0.0.7 + doctor 23-0-2 测活。
- **审计返修窗实录**：r79-audit `run` 初审不通过——F-1（index.md stale：行标题带旧后缀致 test+ship-gate 1b 双红）→ `gen-adr-index --write` 重生；F-2（本交接缺模板必填段）→ 补齐 Stack/绿色 run URL 段；F-3（外发闸 watch 丢失）→ 补回；F-4（`#1774` 出处失实）→ 撤除此编号、如实记「出处未核实」；F-5（329/330 口径不一）→ 统一为终态 333；F-6/F-7 判断级裁决=修（镜像断言加 `exemption domain` 新词+大小写不敏；ADR-0072:33/AGENTS.md:57 旧句补「豁免域外」限定语消除字面张力）。

## 绿色 run URL

本栈未 push（规则：不 push 不 PR）——**PENDING — stack unpushed**。最近落地绿 run（r76-audit 栈 land，为本轮历史祖先）：

- ci: https://github.com/Xxx91n/anysearch-cli/actions/runs/35701346942
- ship-gate: https://github.com/Xxx91n/anysearch-cli/actions/runs/35701346911
- native-smoke: https://github.com/Xxx91n/anysearch-cli/actions/runs/35701346920

## 下一轮候选

- **R80 lockfile 执法轮**（首要，`defer-r79-lockfile-agegate-replay`）：钉版 pnpm 11.24.0 实测 `trustLockfile` 验证腿是否天然覆盖 minimumReleaseAge 拦截（调研断言与本仓 E6 实证张力→实测为准），再定自建护栏/引用上游/显式记档三选一。
- **dsh 观测哨续班**（`defer-r73-dsh-event-rename`）：rc.3/alpha.1 ≈2026-09-24 05:39/06:04Z 出闸——R80 首轮 `npm view` 复检出闸态；L2 候选等待=双锚同响才彩排。
- **pathlint 残余盲区**（承继记档）：多段未知根 POSIX 路径（`/d/`、`/c/` 盘符形）不报、`/x` 仅单段 info——本轮未扩域。
- **#1764 哨**：上游 knip PR OPEN（2026-09-03 起无更新）——merge 且发布版携 `onnxruntime-common` 声明才关 `defer-r71-transformers-undeclared-dep`。
- **外发闸**（用户亲手发）：`.scratch/grill-round-75/drafts/` 两份 draft 续挂用户动作项；发后回录 drafts 头部 Status 行。

## Known risks / deferred

- 落选续债 11 条（原名逐字，`carried_log` r79 显式记）：`defer-anysearch-domain-ownership` / `defer-f16-macos-native-crash` / `defer-f17-quarantine-ids` / `defer-r71-provider-serverside` / `defer-r71-transformers-undeclared-dep`（#1764 哨）/ `defer-r72-dsh-plugin-npm-publish` / `defer-r72-dsh-native-tools` / `defer-r72-dsh-web-interactive-matrix` / `defer-r73-dsh-event-rename`（L2 续班）/ `defer-r74-logo-bitmap-matrix` / `defer-r75-registerhooks-esm-arm`；+新债 `defer-r79-lockfile-agegate-replay`（E6→R80 候选）。
- c2→c3 中间态瞬红：checkout 至 c2 单独时点 ledger 两处 marker 为 stale（清剿落在 c3）——逐 commit bisect 注意，终态绿。
- WORKFLOW.md §4.2 依旧缺位（第七次先例核销）：以 GitButler skill+全局 but 协议等价覆盖，报告内如实记档。
- 度量单行：`exemption-domains=3; red-green-pairs=2; baseline=333 docs/0 violations`。判据↔证据映射表见 `reports/2026-09-23-report.md`。

## Suggested skills

- `$implement`（实施票流）、`$but`（GitButler 全部写操作——新 impl 栈须 `but move --above` 显式叠栈防并行分支）、`$atomcode-research`（串行配额调研）、`$handoff`（收口交接）；模型可触达 tdd/diagnosing-bugs/code-review。
