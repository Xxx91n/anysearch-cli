# Round-78 任务书 — 「治理工具链校准」实施

Date: 2026-09-22. 账本 `.scratch/grill-round-78/decision-ledger.md`（D-001~D-005 全 current，唯一权威数据源）；调研存档 `q2-atomcode.md`（pnpm 闸机制+判决矩阵）、`q3-atomcode.md`（路径 lint 先例）、`q4-atomcode.md`（WSJF/Kanban 票序）。Stack 约定：`r78-grill`（本文档）← 实施栈叠其上。

## 状态快照（接手即知）

- main tip=`7030118c`（workspace commit，基 `d564ba20`），R77 三栈全落，工作区干净；registry 15 条=3 closed+12 open（本轮清算 `defer-r77-pathlint-envvar-blindspot`）。
- **时敏事实**：`@deepseek-ai/dsh-agent` 0.1.5-rc.3/0.1.7-alpha.1 在 48h 龄期闸内，**出闸 ≈2026-09-24 06:0xZ**——T0 实验的闸内标本窗口，错过要等下次上游发版。
- pnpm 配置面：`pnpm-workspace.yaml` 仅 `minimumReleaseAge: 2880`，`IgnoreMissingTime`/`Strict`/`trustLockfile`/`Exclude` 全 unset=默认态。
- pathlint 现状：`ship-gate.mjs:1138` PATH_RE=`/(?:^|[^A-Za-z0-9])(?:[A-Za-z]:[\\/]|\/(?:Users|home)\/|\/tmp\/|AppData[\\/])/`；config=`scripts/ship-gate-pathlint.config.json`；存量逃逸实例=`docs/adr/0042-architecture-grill-round-39-observational-data-feeding.md:111`（`%TEMP%/atomcode-r39-sources.txt` 无 marker）。 <!-- machine-local: Windows env-var 路径引用（存量合规化） @ 2026-09-22 -->
- registry 债条 `defer-r77-pathlint-envvar-blindspot`（deadline 2026-12-31，type=deferred-with-deadline）。

## T0 — repin 拦截实验（覆盖 D-002+D-005(i)；纯证据零提交，**时敏最前**）

判决矩阵已预登记（账本 D-002 为权威文本）——每格预期错误码先写死，实测逐格比对：

| 格 | 环境 | 操作 | 预期 |
|---|---|---|---|
| E1 正对照 | scratch | catalog 钉已出闸版（0.1.6-alpha.2）install | 成功（证环境 sane） |
| E2 核心 | scratch | minimumReleaseAge:2880+catalog 钉闸内版（0.1.7-alpha.1）install | `ERR_PNPM_NO_MATURE_MATCHING_VERSION` |
| E3 豁免 | scratch | E2+`minimumReleaseAgeStrict:false` | 静默装上（豁免面实证） |
| E4 真身 | 仓内 | catalog 改闸内版，非 frozen install | E2 同款龄期错误 |
| E5 真身 | 仓内 | 同 E4+`--frozen-lockfile` | lockfile-out-of-sync（拦截但执法点不同） |
| E6 真身 | 仓内 | 手改 lockfile 写入闸内版+frozen | `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` |
| E7 证伪 | scratch | 无 time 字段源 | 装成功=合法证伪向量；npmjs 无标本→「配置面向量」记档不跑 |

- scratch 最小 workspace 全留机器临时目录（携 packageManager pin+minimumReleaseAge+catalog）；真身实验后 catalog/lockfile 恢复字节零脏（`git status --porcelain` 空实证）。
- transcript 归档 `evidence/t0-repin-matrix.md`（逐格一致/不一致显式）；任一不符=证伪信号呈报用户非静默改向。
- 验收：每格结果实录+零脏+归档齐。

## T1 — pathlint 判定器重构+加固（覆盖 D-003；一票三 commit）

文件面：`scripts/ship-gate.mjs`（PATH_RE→判定器）+`scripts/ship-gate-pathlint.config.json`（如需）+`pnpm-workspace.yaml`（加固行）+存量违例文档+对应测试/fixture。

1. **warn-first 枚举**（先于一切翻转）：新判定逻辑以 info 模式全量扫已注册文档，命中数+命中清单实录归档（know blast radius 纪律）——`evidence/t1-warn-sweep.md`；
2. **存量处置**：机械可修 retro-fix，不可修逐条补 `<!-- machine-local: <reason> @ <YYYY-MM-DD> -->` marker（含 docs/adr/0042:111）；
3. **判定器翻 fail-closed**：四类新 token+字面形统一「token+后随分隔符=locator」；裸 env-var 散文不报；`/x` 单段根形→info surfaced-skip；失效标记棘轮腿（marker 在行不再命中→报）；
4. **红绿 fixture 成对行使**：两逃逸实例固化红向（必拦）+每 token 类红向+绿向（散文提及/URL/已标记行必放；inline code 照常拦断言）；
5. **加固行**：`minimumReleaseAgeIgnoreMissingTime: false` 入 `pnpm-workspace.yaml`（独立 chore commit）+`pnpm install` 绿实证无破坏。

commit 拆分：`refactor:` 判定器重构+棘轮腿 / `fix:` 存量违例清理 / `chore:` 配置加固行。

验收：红向全命中、绿向全放行、棘轮腿注入实测、warn-first 命中数实录、turbo check/test+pathlint 腿直跑+ship-gate 绿、install 绿。

## T2 — 文书收口（覆盖 D-002 后半+D-005(iii)；docs-only）

1. **ADR-0079**：组合判定器+豁免三层心智模型（marker=受审 artifact/只减不增/baseline≠规则后门）+棘轮审计+判决矩阵实录+断言收窄文本+IgnoreMissingTime 加固理由+**不 bump 判定**；
2. **registry**（canonical normalize 全程）：`defer-r77-pathlint-envvar-blindspot`→closed+落选债 `carried_log` r78 续记+`updated` bump；
3. **upgrade-ledger v2 待校准项消解**（实验结果落锚 `.scratch/grill-round-73/upgrade-ledger.md`）+断言收窄文本落锚；
4. CONTEXT 新词已随 grill 定稿落盘；handoff 写 closeout 方向+#1764 哨+外发闸+L2 排程临近态；
5. pathlint 登记 round-78（scratchDocDirs 已含 handoffs/reports/evidence——确认无需改）+ship-gate/turbo 全绿+but commit 干净。

## 红线（账本负向需求）

不绕龄期闸；判决矩阵先于实验登记；证伪如实呈报不静默改向；scratch 产物不提交；真身实验零脏恢复；functional change 不混入 docs commit；inline code 不豁免；失效标记棘轮只减不增；不 bump 版本；外发闸不代发；窗口错过诚实记档不伪造。

## 落选债承接（11 条原名，carried_log 显式续记）

`defer-anysearch-domain-ownership` / `defer-f16-macos-native-crash` / `defer-f17-quarantine-ids` / `defer-r71-provider-serverside` / `defer-r71-transformers-undeclared-dep` / `defer-r72-dsh-plugin-npm-publish` / `defer-r72-dsh-native-tools` / `defer-r72-dsh-web-interactive-matrix` / `defer-r73-dsh-event-rename`（L2 排程中）/ `defer-r74-logo-bitmap-matrix` / `defer-r75-registerhooks-esm-arm`（`defer-r77-pathlint-envvar-blindspot` 本轮处置中，按 T1 结果改 closed）。

## Suggested skills

`$implement`（续作驱动）· `$tdd`（红方向实测纪律）· `$handoff`（收口交接）· `$atomcode-research`（上游/机制再变补研）· `$but`（版本控制）· `$code-review`（复审可选）。

无秘密值落档；证据/文稿全 repo-relative 引用；scratch 实验产物留机器临时目录不提交。
