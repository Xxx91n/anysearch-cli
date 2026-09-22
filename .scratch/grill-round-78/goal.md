# Grill Round 78 — Goal（定稿态）

Date: 2026-09-22. Ledger: `decision-ledger.md`（D-001~D-005 全 current，已修复一次 `$` 展开落盘损坏）。定稿已获用户确认。

## 本轮主题（D-001，治理工具链校准轮）

清算 R77 审计残账两件 repo 内可收口项，同属「门禁可信度校准」同构主题：

1. **`defer-r77-pathlint-envvar-blindspot`**：pathlint `PATH_RE`（ship-gate.mjs:1138）只认盘符/`/Users`/`/home`/`/tmp`/`AppData/` 字面形，env-var 形路径全漏网——**拦不住该拦的**。
2. **repin 拦截实验**：`minimumReleaseAge:2880` 对 catalog repin 的拦截行为从未实测——**不知道拦不拦**（R77 立法「L1=闸内唯一合法探测层」建立在未证假设上）。

## 裁决摘要（账本为准）

- **D-002**：repin 实验=预登记 7 格判决矩阵（E1 正对照/E2 scratch 闸内钉版→`ERR_PNPM_NO_MATURE_MATCHING_VERSION`/E3 strict:false 豁免/E4 真身 repin 非 frozen/E5 frozen→lockfile-out-of-sync/E6 手改 lockfile+frozen→`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`/E7 无 time 源证伪向量记档态）+断言收窄（公网 registry+无 exclude+strict 默认+trustLockfile 未开前提）+`minimumReleaseAgeIgnoreMissingTime:false` 加固；闸窗硬截止 ≈2026-09-24 06:0xZ。
- **D-003**：pathlint=token+分隔符组合判定器（env-var/tilde/UNC/字面形四类+后随分隔符→硬拦；裸 env-var 散文不报；`/x` 单段 POSIX 根形→info surfaced-skip）+warn-first 全量扫→retro-fix/marker→翻 fail-closed+失效标记棘轮腿+红绿成对 fixture（inline code 不豁免）。
- **D-004**：T0 实验（timebox）→T1 一票三 commit（refactor/fix/chore）→T2 文书 docs-only；WSJF+Kanban Fixed-date+依赖驱动排序。
- **D-005**：三段收口+证伪处置预先合法化（实测≠预期=呈报信号非静默改向；收口产物是真相非确认书）+窗口错过诚实记档。

## 显式范围外（落选债原名续 deferred，T2 记显式续债条）

`defer-r73-dsh-event-rename`（L2 排程已落档，出闸≈09-24）· `defer-r71-transformers-undeclared-dep`（#1764 OPEN 19 天）· `defer-r75-registerhooks-esm-arm`（repo 无 Node floor 声明+无 ESM 消费者=仍半响）· `defer-r71-provider-serverside` · `defer-r72-dsh-*` 三件套 · `defer-r74-logo-bitmap-matrix` · `defer-f16`/`defer-f17` · `defer-anysearch-domain-ownership`。外发闸两份 drafts=用户动作项；gain gate 降级=ADR-0052 法定路径非缺陷。

## 路径纪律自证

本目录全部文档 repo-relative；无机器绝对路径落档（scratch 实验产物留机器临时目录不提交）。

## 遗留呈报项（T2 收口时列入 handoff）

- `#1764` merge 观察哨续挂（2026-09-22 实查 OPEN）。
- 外发闸两份文稿仍待用户亲手发。
- L2 排程义务临近出闸（≈09-24）——下轮或即触发。
- 教训注记：账本落盘曾遭 `$` 展开损坏并修复——写含 `$VAR`/`\` 内容的文件一律 heredoc 引号定界或 .cjs 脚本，不走 `node -e "..."` 双引号串。
