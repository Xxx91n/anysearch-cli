# R67 审计收口交接 — 2026-09-17（audit PASS；修复轮 llk 后全绿，可 push）

## 一句话状态

R67 B 段（Codex 0.142.5 真宿主契约对齐）+ A 段发布工程审计**通过**：硬验收全部亲跑重证（非信报告自述），6 笔待审 commit 无代码缺陷；审计发现 F-01..F-06 已经修复轮 commit `llk`（r67-grill）全部收口并同套验收复绿，T7（merge→tag v0.0.5→push→OIDC publish）技术面就绪、等用户当场授权。

审计窗口：`gitbutler/workspace` @ `225f7e4`；审域 = `1dbcf63...HEAD`（r67-grill 7 commit，含 grill 定稿）。
被审材料：`D:\Aworker\anysearch-cli\.scratch\grill-round-67\reports\2026-09-17-report.md` + `D:\Aworker\anysearch-cli\.scratch\grill-round-67\handoffs\next-round.md`（spec）+ `D:\Aworker\anysearch-cli\.scratch\grill-round-67\decision-ledger.md`（D-001..D-005）。

## 硬验收亲跑记录（审计窗口实跑，非转述）

| 验收项 | 命令/对象 | 结果 |
|---|---|---|
| 编译 | `pnpm build`（turbo） | 4/4 tasks 绿，21.7s |
| 类型检查 | `pnpm check` / `pnpm lint` | 7/7 + 3/3 `tsc --noEmit` 绿 |
| 测试 | `pnpm test`（turbo） | 11/11 tasks 绿；`codex-contract: 11 passed, 0 failed` |
| 打包 | `pnpm pack` ×4 → `C:\Users\ADMINI~1\AppData\Local\Temp\audit-r67-pack\` | 四包 v=0.0.5；`@anysearch-cli/embedding` peer/dep 重写为 `0.0.5`；plugin 含 `ans-hook-codex` bin + `D:\Aworker\anysearch-cli\apps\plugin\configs\codex\hooks.json` 官方 schema + `D:\Aworker\anysearch-cli\apps\plugin\dist\hooks\adapters\codex.cjs` |
| 启动测活 | `D:\Aworker\anysearch-cli\apps\plugin\dist\server\index.cjs` @34441 | 监听成功；`/health` 无 token 401、`/index` 带 Bearer 200 `{"indexed":0,"total":0}` |
| MCP stdio | `D:\Aworker\anysearch-cli\apps\mcp\dist\index.cjs` initialize+tools/list | `serverInfo=anysearch 0.0.5`，5 工具齐 |
| 适配器实物冒烟 | `D:\Aworker\anysearch-cli\apps\plugin\dist\hooks\adapters\codex.cjs` 合成 stdin | 单键 `hookSpecificOutput` 信封，`hookEventName=PostToolUse`，蒸馏 JSON 内嵌 |
| session-start | `D:\Aworker\anysearch-cli\apps\plugin\dist\hooks\session-start.cjs --envelope` | 信封 + `[anysearch plugin active]` 路由卡 |
| CLI | `node D:\Aworker\anysearch-cli\apps\cli\dist\index.js --version / doctor` | `0.0.5`；doctor 检查项 OK |
| 生成器零漂移 | gen:configs 产物 sha256 build 前后 | 5 文件全同（单源成立） |
| ship-gate 净 clone | `C:\Users\ADMINI~1\AppData\Local\Temp\ansclean\.ship-gate\report.json` | `exit=pass`，10 step-block 全 pass 0 fail（HEAD≈`aeb2276`+workspace commit，其后仅 docs commit `706f056`） |

## 声明 → 证据 → 结论 对照表

| # | 报告声明 | 审计证据（亲查） | 结论 |
|---|---|---|---|
| 1 | codex.ts 全信封 + permissionDecision(Reason) 透传 | `D:\Aworker\anysearch-cli\apps\plugin\src\hooks\adapters\codex.ts` L49-62 单信封输出；dist 冒烟单键 `hookSpecificOutput`；`t4-deny.debug.log` router 行 `Tool call blocked by PreToolUse hook: URL host on denylist` | 属实 |
| 2 | hooks.json 官方 schema + 后缀锚定 matcher + bin 命令 + --envelope | `D:\Aworker\anysearch-cli\apps\plugin\configs\codex\hooks.json` = `{matcher, hooks:[{type:command,command,timeout}]}`；matcher `.*(…)$` 全匹配安全；tarball 同物随包 | 属实 |
| 3 | `ans-hook-codex` bin | `D:\Aworker\anysearch-cli\apps\plugin\package.json` bin 第 4 件；tarball bin 映射 → `D:\Aworker\anysearch-cli\apps\plugin\dist\hooks\adapters\codex.cjs` | 属实 |
| 4 | codex-contract.test.ts 11 断言 | 文件实测 6×test+5×testAsync=11；turbo test 11/11 绿 | 属实 |
| 5 | T1 裁决（信封 4/4 / 裸字段 1/8+1/3 / plain 3/3 / deny×4 / required 硬退 / matcher 全匹配 / env 传递 / -c 非 TOML） | `D:\Aworker\anysearch-cli\.scratch\grill-round-67\evidence\` t1-* 共 85 件；抽查 `t1-defect-ledger.md` 四态处置、`t1-shippedcfg*`（shipped 零 hooks 腿）、`t1-mcp-required-fail.*`、`t1-deny-*` 齐 | 属实 |
| 6 | T2 P1-P9 + 宿主重判 | `D:\Aworker\anysearch-cli\.scratch\grill-round-67\evidence\t2-p1/p2/p3/p4b/p5/p6/p7` 日志齐；`t2-realpost-tb3` +9 行索引；`t2-envdump*` 仪器腿齐。P8 restart 无独立证据文件（台账有记录，观测走 server log） | 属实（P8 命名小瑕） |
| 7 | T3 修复 + 备份先行 | commit `3e5087a` diff 与台账 xfail 项一一对应；`D:\Aworker\anysearch-cli\.scratch\grill-round-67\backups\t3\*.bak` 与 `git show 1dbcf63:` 逐字节 IDENTICAL ×3 | 属实 |
| 8 | T4 修复后绿 | `t4-shippedcfg.stream.jsonl` 含路由卡回显；`t4-deny.stream.jsonl` 无 mcp_tool_call 项 + debug 拦截行；`t4-shipped-postuse.stream.jsonl` 真 `mcp_tool_call` + `D:\Aworker\e2e-r67-codex\.anysearch\project-index.db` **实测 42 行**（最新行=真实蒸馏条目） | 属实 |
| 9 | T5 文档 | ADR-0068 在 `D:\Aworker\anysearch-cli\docs\adr\0068-architecture-grill-round-67-codex-01425-host-contract-envelope.md`；`D:\Aworker\anysearch-cli\docs\codex-integration.md` 129 行双层配置+宿主事实；README verified-hosts Codex 行+三条 0.0.4 缺口+ADR 索引 regen；CHANGELOG 0.0.5；CONTEXT +9 词（grill 7+T5 2）；AGENTS.md +Codex host notes | 属实 |
| 10 | T6 7 包 bump+ship-gate 钉同 commit | `aeb2276` 同 commit 落 7×package.json 0.0.5 + `D:\Aworker\anysearch-cli\scripts\ship-gate.mjs` 钉 0.0.5；净 clone ship-gate exit=pass | 属实 |
| 11 | 密钥不落盘 | 全 diff 扫描 0 字面值；env-dump 记录 `ANS_SERVER_TOKEN=set#len64`（存在性+长度，非值）；token 经 0600 文件运行期读取 | 属实 |
| 12 | release.yml 沿用不新增 / 无依赖新增 / 兄弟适配器零改动 | `D:\Aworker\anysearch-cli\.github\` 零 diff；package.json 无新 dep；claude/cursor/antigravity/codebuddy 适配器 0 行改动 | 属实 |
| 13 | B 段绿后 bump | commit 序：fix→evidence→docs→bump；reflog 时序一致 | 属实 |
| 14 | README 旧"裸契约破"记载对账（D-005iii） | 旧文"envelope 破坏裸契约"实为反向：实物 0.0.4 默认裸输出且 `--envelope` 旗标已在包内；新 README 三项缺口正确改写 | 属实（对账方向正确） |

## D-001..D-005 逐条核对

| ID | 需求要点 | 核对 | 结论 |
|---|---|---|---|
| D-001 | 串行双主题；契约族=两类信封形态各≥1 真宿主实证；发布当场授权 | 信封腿 4/4+裸字段腿实测（破=定谳）；bump 在 B 绿后；T7 未执行 | 满足 |
| D-002 | 三轨：published 权威轨契约形态 smoke/tarball 回归轨/dev 非证据轨；四态台账；单层注入；marker nonce | t1/t2/t4 全量 transcript+debug 入库；台账 xfail-strict/skip-with-reason/closed-green；nonce 命名在案；bypass 腿有标注 | 满足（台账无编号 ID/failure_class 字段，实质齐、形式弱） |
| D-003 | codex 模板官方 schema；适配器/session-start 按裁决对齐；**随包 AGENTS.md 说明块+doc 可选步骤**；改前备份 | ①②备份满足；**③双叉皆缺**——`D:\Aworker\anysearch-cli\apps\plugin\AGENTS.md` 内容对但不在 package `files[]`（tarball 无 .md 说明块），`D:\Aworker\anysearch-cli\docs\codex-integration.md` 零提及可选贴入步骤 | **部分满足（F-01）** |
| D-004 | T1-T7 串行；裁决先于 T3；先红后绿；B 绿开 T6 | commit/reflog 时序成立；t1/t2 红→t4 绿证据对在案 | 满足 |
| D-005 | 四段收口：(i) B 证据 (ii) A 发布证据 (iii) 缺陷台账+README 对账 (iv) verified-hosts+未验证面列尽+0.0.5 送达口径 | (i)(iii) 满足；(ii) T7 授权后回填（合规）；(iv) README 行在但**未验证面列尽不全**（query_knowledge stub/abstain=null/hooks.state headless 未实证未入 README，散见报告+integration doc） | 部分满足（F-03） |

## 双轴评审（code-review skill，双子代理并行取证）

### Standards 轴

- **硬违规**：deliverable 绝对路径纪律（本轮新增 AGENTS.md 规则）在 `D:\Aworker\anysearch-cli\.scratch\grill-round-67\reports\2026-09-17-report.md` 与 `next-round.md` 续页内文多处用相对路径（顶层指针是绝对）——本轮自立的规本轮即破，低severity文档级。
- **判断项**（不挡门）：test 文件 `runHook` 复制；`codex.ts` `Object.keys>1` 哨兵隐式依赖 hookEventName 恒在；`codex-contract.test.ts:1` 注释 "ADR-0067 candidate" 应为 0068；shipped matcher 比 `isAnsTool` 宽（良性——适配器二次过滤）；7MB tarball 入 `.scratch`（与 R66 白名单惯例一致）。
- **净项**：fail-open 全路径 exit 0；密钥扫描净；`>nul` 无；pnpm 钉 11.24.0 双字段+allowBuilds 未动；备份逐字节同 pre-fix；生成器单源+漂移守卫测试在。

### Spec 轴

- (a) 缺/弱 3 项：D-003③（F-01）、D-005(iv) 未验证面（F-03）、expected-red 编号形式（F-04）。
- (b) 计划外 1 微项：root AGENTS.md "+Codex host notes" 超 T5 字面条目（合 repo 惯例，commit 已披露）。
- (c) 做错 0 项。

## 发现清单（呈报，不替决）

| ID | 严重度 | 发现 | 处置选项 |
|---|---|---|---|
| F-01 | 中低 | **D-003③ 随包 AGENTS.md 说明块双叉缺失**：spec 要"随包一段 ans_* 白名单+fail-open 说明块供贴入项目 AGENTS.md + 进 codex-integration 可选步骤"。实物：`D:\Aworker\anysearch-cli\apps\plugin\AGENTS.md` 在仓但 tarball 不含（files[] 无），doc 无步骤。实施方未声明放弃 | A) r67-grill 补小 commit（snippet 入 configs/ 或 files[]+doc 一段）→重跑 §硬验收同套（build+pack+contract test 即可）；B) 显式挂账进 R68 due-chore（账本注记） |
| F-02 | 低 | deliverable 绝对路径纪律在 report/next-round.md 续页内文被相对路径多处违反（规则本轮自立） | 同 F-01 一起顺修 or 挂账 |
| F-03 | 低 | D-005(iv) 未验证面列尽不全：README Codex 行只记 same-turn 变量；`query_knowledge` adapter=none stub、OOD abstain=null、`hooks.state` hash headless 未实证未入 README（报告 §已知遗留+integration doc 有载） | README 补一行 or 判"README 只列宿主面"豁免 |
| F-04 | 微 | expected-red 四态台账无编号 ID/failure_class 字段（D-002 字面要求），实质处置+理由齐 | 挂账 or 台账补列 |
| F-05 | 微 | `codex-contract.test.ts:1` 注释写 "ADR-0067 candidate"，应为 ADR-0068 | 顺修 |
| F-06 | 微 | T2 P8 restart 腿无独立 `t2-p8-*` 证据文件（台账有记录） | 免修（证据在 e2e server log） |
| F-07 | 提示 | T7 张力：红线"VC 写一律 but" vs 任务书 `git tag`/`git push`——`but` 无 tag 子命令（R66 收口已记灰区"tag 无 but 命令用 git"）。push 分支可走 `but push`；tag+tag push 须 git | T7 当场由用户裁决，沿用 R66 灰区口径即可 |

## 过程违规呈报

- 无代码级过程违规：备份先行、密钥不落盘（含仓外 e2e env-dump 亦 set#len64 化）、e2e 现场在仓外、`>nul` 零、B 绿才 bump、T7 未越权执行。
- 呈报不追认：F-01 为 spec 明面条款未交付且实施方未挂账——按职责分离打回处置权交还用户；其余 F-02..F-06 均文档级。
- GitButler 幻影 `D`（`git status` 对 .scratch 报 staged 删除但文件在盘）：报告已如实注记为 index 视图差异，亲验文件俱在，非缺陷（F-01a 范围外登记在案）。

## 修复轮结果（2026-09-17 晚，r67-grill commit `llk`）

用户裁决走"修复所有小问题"路线，全部在本窗口修复并同套验收复绿：

| 发现 | 修复 | 复验 |
|------|------|------|
| F-01 D-003③ 说明块双叉缺 | `D:\Aworker\anysearch-cli\apps\plugin\package.json` `files[]` 收 `AGENTS.md`；`D:\Aworker\anysearch-cli\apps\plugin\test\plugin.test.ts` 增随包断言；`D:\Aworker\anysearch-cli\docs\codex-integration.md` §5 增可选贴入步骤；`D:\Aworker\anysearch-cli\CHANGELOG.md` 补条目 | tarball 实测 `package/AGENTS.md` 在包；Plugin tests 17/17 PASS |
| F-02 绝对路径 | report 35 处 + next-round.md 2 处 + 本交接 17 处 + 台账 1 处全部绝对化 | 三文档+台账扫描零相对路径残留 |
| F-03 未验证面列尽 | `D:\Aworker\anysearch-cli\README.md` Known Limitations 增 "Codex unverified surfaces (0.0.5)" 条（same-turn 变量/hooks.state/query_knowledge stub/abstain=null） | 条目在案 |
| F-04 台账编号 | `D:\Aworker\anysearch-cli\.scratch\grill-round-67\evidence\t1-defect-ledger.md` 增 ER-01..ER-12 编号索引（ID/failure_class/disposition/closure pointer） | 12 行在案 |
| F-05 注释误写 | `D:\Aworker\anysearch-cli\apps\plugin\test\codex-contract.test.ts:1` ADR-0067→0068 | — |
| F-06 P8 证据档 | 新建 `D:\Aworker\anysearch-cli\.scratch\grill-round-67\evidence\t2-p8-restart.log` | 在案 |
| 附修 codex.ts 哨兵 | `Object.keys>1` 隐式哨兵 → `decision.additionalContext \|\| decision.permission` 显式 | dist 冒烟信封照常+非 ans 静默；test 11/11 |

**修复轮同套验收**：`pnpm build` 4/4、`check` 7/7、`lint` 3/3、`test` 11/11（codex-contract 11/11、plugin.test AGENTS.md 新断言 PASS）、plugin tarball 含 AGENTS.md、适配器 dist 冒烟信封+静默双通。全部复绿。

## 审计结论

**PASS**：代码面与发布工程面经审计窗口独立重跑全绿，报告 14 条关键声明抽查全数坐实、无夸大；F-01..F-06 经修复轮 `llk` 收口并同套验收复绿。**分支可 push**；T7（merge→tag v0.0.5→push→publish）等用户当场授权序列启动。

## 移交下一轮（候选 grill 方向，按建议优先级）

1. **T7 执行**（非 grill，当场授权序列）：merge 路线（A: push r67-grill+PR merge / B: 本地 merge）→ `git tag v0.0.5` + `git push`（F-07 灰区）→ release-gate post-tag assert + publish job（OIDC TP+provenance，0.0.4 已实证通道）→ `npm view` 四包 0.0.5 + `dist.attestations` + 净机 `npm i -g` 冒烟 → ADR-0068 Closure(ii) 实填 + 报告 T7 段回填。
2. **F-01/F-02/F-03 顺修小轮**（若选修）：AGENTS.md snippet 随包化+doc 可选步骤+绝对路径回写+README 未验证面补齐——可并入 R68 due-chore。
3. **既有 deferred 池**（沿用）：provider 服务端排查、projectIndex 双库裁决、interactive TUI、embedding arm、跨 OS matrix、**Cursor/Antigravity 真宿主验证**（契约族覆盖下一族——cursor/antigravity 仍是裸契约未验面）、plugin 升格默认路径、F-01a ship-gate×GitButler clean-tree、watch 观测窗。
4. **观测项**：query_knowledge adapter=none stub 实装候选；OOD abstain 形状；PostToolUse ctx 同-turn 可靠性跨宿主基线。

## 关键事实（勿重查）

- Codex 0.142.5 契约：stdin `hook_event_name`；stdout 仅 `hookSpecificOutput` 信封有效（裸字段 ~80% 丢、裸 deny 不拦、exit2 不拦）；hooks 须官方 `{matcher,hooks:[{type,command,timeout}]}`；matcher 全匹配 regex；`-c` 不能表达 hooks；required=true MCP 硬退；hook env 继承 codex 进程 env。
- 发布面：四包 0.0.5 已 pack 演练；ship-gate 净 clone exit=pass；release.yml 通道 0.0.4 实证未改。
- VC：r67-grill 栈顶 `706f056`（审计时 workspace commit `225f7e4`）；tag 无 but 命令（R66 灰区）。

## Suggested skills

- T7 执行：无（当场授权序列，手工+release.yml）
- R68 grill 开门：`$grill-me` / `$to-questionnaire`（主题定界+账本），方向见 §移交下一轮
- 若 F-01 打回返工：返工窗口执行后须重跑本文件 §硬验收亲跑记录 同套
