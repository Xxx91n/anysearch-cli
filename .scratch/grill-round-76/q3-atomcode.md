# R76-Q3 atomcode 调研存档 — 受治理 JSON 文件的 canonical 形态锁方案

Date: 2026-09-22. Runner: `atomcode -p "$(cat q3-prompt.txt)"` via ctx_batch_execute (concurrency 1).

## 1) 执行摘要（TL;dr）

**推荐方案 A（ship-gate 新增 fail-closed canonical-JSON 断言），并做四处加固**：字节级全等断言（不是语义级）、**报错不自动改写**（gate 自修是反模式）、错误文案附一条可直接复制的 `node -e` normalize 指令、文件清单硬编码常量 + ADR 编号并留注册制迁移口。**不引入 prettier**——与本仓 1 空格 canonical 形态冲突，除非把 canonical 重定义为 prettier 输出（额外依赖+版本漂移面），对 n=1 不成比例。Confidence：**高**——「CI 内 regenerate-then-diff」是工业界对 generated/normalized 文件 drift 的标准防御（alint generated_file_fresh、sqlc/Go 社区、prettier --check 设计多源交叉）；GitButler 使 hook 不可靠有官方 issue 实证（#5735、#12748），恰好排除 D。

本地实证核验：deferred-registry.json 当前 14378 字节、1 空格缩进、末尾单换行，roundtrip 成立；gate 脚本已是 step 编号+fail-closed+report() 结构，新腿可无缝挂入。

## 3.1 防御模式真实防御力排序

**CI 内 canonical 断言 > formatter --check > pre-commit hook > .gitattributes**。

- 「run generator && git diff --exit-code」是 generated/normalized 文件一致性校验标准惯例（Go `go generate`、sqlc、wire）；alint 形式化为 `generated_file_fresh` 规则——「committed artefact must equal what a declared command generator produces」，*verify, don't regenerate*。A 方案=该模式最小特化：generator=`JSON.stringify(JSON.parse(file),null,1)+'\n'`，纯函数无 spawn 确定性输出。
- prettier `--check`/`--list-different` 设计本意就是 CI fail-closed——但对我们错配（见 3.4.2）。
- **.gitattributes 防御力为零**：属性集是 eol/text/diff/merge/filter 传输展示层行为，无「内容必须等于 canonical 序列化」机制。
- **hook 防御力弱且本仓实证排除**：GitButler #5735 确认 pre-commit 静默不执行（绕过 staging area 直接建 tree）；#12748 显示 `but setup` 覆盖 hook 管理器、`but commit` 特判 guard 错误为成功；Lobsters/Reddit 共识「hook 人人可绕，CI rejection is the final guard」；jyn.dev：提交动作改写被审阅 diff 本身是反模式。

## 3.2 canonical 断言实现细节选型

- **字节级全等（推荐）**：`Buffer.equals(file, canonical)` 最简单零误判，可精确报「first differs at byte/line N」（alint 黄金 UX）。语义级深比较**漏报**（重排缩进语义不变恰是要拦的）；容错自我拆台。唯一可吸收容差=trailing-newline churn（alint `normalize: none|trim|final-newline`），当前单换行 canonical 已覆盖，未来尾换行抖动再升档。
- **键序稳定性**：ECMAScript 普通对象属性序确定（integer-like 升序+字符串插入序），`JSON.stringify` 按此序输出且 roundtrip 保序。风险=未来某流程用排序序列化（safe-stable-stringify）→canonical 翻转。加固：ADR 写明「canonical=V8 原生 JSON.stringify(_,null,1) 键序（插入序），禁用 replacer/排序序列化」；键序被外部重排是语义可见重排，字节断言失败正是期望行为。
- **autofix：仅报错+指引不自修**——① jyn.dev/Lobsters：检查动作静默改写内容制造「提交内容≠审阅内容」；② prettier 分工惯例 `--write` 归人 `--check` 归 CI；③ gate 自修污染 working tree（alint 特意 leaves working tree byte-identical）。指引给可粘贴 node -e 指令；JSON.parse 失败时先报「invalid JSON」独立错误，normalize 指引只在 JSON 合法但字节不匹配时给出。

## 3.3 登记清单治理形态

- **硬编码常量（推荐，n=1）**：本仓强先例——ship-gate step1 静态断言即硬编码清单+ADR 编号；同构延续成本最低、grep 可审计、无「config 文件自己没被治理」元问题。
- 注册制 config：linter 生态通用形态但 n=1 是 YAGNI，且把受治理清单放进同样可能被重排的 JSON=元治理循环。**演化路径**：常量旁注「n≥5 或需包级自服务时迁移注册制 config」——留迁移口不付现成本。
- 文件名约定/marker：改文件名破坏既有引用、marker 污染数据模型且本身不防重排——不推荐。

## 3.4 对 A 的辩证审查与薄弱点

1. **1 空格缩进可维护性**——真实但被高估：1 空格是机器 canonical 非手编排版，断言+一键 normalize 消掉手写需求。真风险=新人/agent 见 1 空格误为损坏而「修复」——缓解：文件顶层 `note` 字段写一句「canonical form locked by ship-gate / ADR-00xx; run <cmd> to fix」（成为 canonical 一部分，一次定稿）。
2. **不引 prettier**：① 冲突——prettier JSON 默认 2 空格，与已实证 1 空格 canonical 直接矛盾；② 成本——新依赖+版本钉死（latchkey 点名 prettier 版本/配置漂移坑）+全仓基线整理；③ 收益——只防 1 个文件，20 行断言即可。**条件性翻案**：治理清单扩到 n≥5 且含 md/ts 多类型、团队要全仓统一格式化时再引，并把 canonical 重定义为 prettier 输出（断言改 `prettier --check`）——A 的检查腿与 formatter 天然可互换。
3. **JSON 不支持注释**——真约束（npm/cli #793）；惯例=注释搬进数据字段（你们已有 `note` 顶层字段=标准解法）或换 JSONC/JSON5（破坏 JSON.parse 纯净性，**不要**）。
4. **A 残余薄弱点对冲**：① 常量清单腐化（文件改名后没人知道清单在哪）——错误信息打印清单常量所在脚本+行号；② gate 未跑环境拦不住——所有 CI 方案共同边界，accept；③ roundtrip 依赖 V8 行为——Node 已 engines 钉死，风险可忽略。

## 最终推荐（一句话）

**采纳 A，落地为：step1 内新增 `stepGovernedJsonCanonical()`——对硬编码清单（n=1，注 ADR 编号）逐文件断言 `Buffer.from(JSON.stringify(JSON.parse(src),null,1)+'\n')` 与原始字节全等；JSON 非法→单独 fail；字节不匹配→fail 附一行 normalize 指令；不自修、不引 prettier、不动 .gitattributes；ADR 记录键序语义（V8 插入序）与「n≥5 迁移注册制」触发条件。**

## 完整来源清单

alint `generated_file_fresh` 规则页 · prettier CLI docs（--check）· vgsn 博客 generated-files 守门示例（sqlc）· latchkey.dev go generate CI failures · gitbutler#5735（pre-commit 静默失效官方确认）· gitbutler#12748（but setup displaces hooks）· Lobsters「pre-commit hooks are fundamentally broken」（源 jyn.dev）· Reddit r/programminghorror hooks-can-be-bypassed 共识 · MDN/Execute Program（JSON 键序）· npm/cli#793（JSON 无注释）等
