# R66 defect 台账（found/fixed/deferred + expected-red 四态）

> 宿主：Claude Code 2.1.251（headless -p + stream-json + --verbose），模型走本地代理 deepseekpro。
> 基线对象：published npm 0.0.3（registry 真包，bin=null/files=["dist"]，不含 R65 修复）。
> 状态字段沿用 q4 方法论四态：not-scored / pending / xfail-strict / skip-with-reason。

## expected-red 分类账（B 段捕获对象）

| ER | 条目 | 状态 | 编号理由 | failure_class | 证据 |
|----|------|------|----------|---------------|------|
| ER-1 | configs/claude/hooks.json 模板 {name,command,args[],timeout}+${CLAUDE_PLUGIN_DIR} 非官方 schema | **xfail-strict**（该工作但有 bug，T3 修） | 官方 settings hooks schema={matcher,hooks:[{type:command,command}]}（code.claude.com/docs/en/hooks） | schema-mismatch | t1-p2-indomain.stream.jsonl：3 SessionStart hooks（全 global/plugin 源），0 anysearch；t1-hooks-mixed：合法 sentinel 同数组被**连带抑制** |
| ER-2 | claude.cjs/session-start.cjs 信封字段写顶层（additionalContext/updatedInput/updatedToolOutput）而非 hookSpecificOutput | **pending**（P6x 实证顶层字段是否被真 Claude 忽略） | 合成 stdin 已证 0.0.3 输出顶层 updatedToolOutput；真宿主是否吞顶层字段待 P6x | envelope-shape | t1-synthetic-red：event 字段输出 `{"updatedToolOutput":...}` 顶层 |
| ER-3 | plugin 骨架不存在（.claude-plugin/plugin.json+hooks/hooks.json+.mcp.json） | **xfail-strict**（T3 建，experimental） | D-003 随包骨架+单一源生成；CLAUDE_PLUGIN_ROOT Windows bug 链 #16116/#11984/#15481/#26389 不依赖 | missing-artifact | 0.0.3 files=["dist"] 无 configs 更无 .claude-plugin；repo 现状同 |
| ER-4 | P6 hooks 三事件真宿主注入（B 段正常面，非红项——0.0.3 上不可达因 ER-1） | pending | 依赖 ER-1 修复后复验 | — | T4 复跑 |

## found（T1 新发现）

| ID | 发现 | 证据 | 严重度 | 处置 |
|----|------|------|--------|------|
| R66-B01 | **settings.json 事件数组里一条非法条目会连带抑制同事件全部合法条目**：sentinel-only→4 hook_started+ANS_SENTINEL_FIRED；template+sentinel→回退 3、sentinel 被抑制。即坏模板不只是 no-op，还会静默拖垮同文件内其他 SessionStart 钩子 | t1-hooks-sentinel-only vs t1-hooks-mixed 对照 | 高（用户面：按文档抄模板会拖死既有 hooks） | T3 修模板（schema 修正即消解）；记录为宿主行为事实 |
| R66-B02 | 0.0.3 模板命令引 `${CLAUDE_PLUGIN_DIR}`——settings.json 语境该变量不展开（plugin-dir 专属），即使 schema 修好该路径也解析不到 npm-global | 模板实物 | 高 | T3：模板命令改为 `node <abs-path>`（npm root -g 展开或 ans 自身解析） |
| R66-B03 | R65 probe.mjs `spawn(shell:true)` 在 Windows 把 -p 长 prompt 词切（DEP0190），模型只收到首词——R66 runner 已改 spawn claude.exe 直启 | t1-p2c "只发了 What" 实物 | 中（基础设施） | fixed：probe-claude.mjs spawn 无 shell |

## 基线复现登记（published 0.0.3 上 R65 缺陷全族仍在——预期内）

| R65 ID | 0.0.3 复现证据 |
|--------|----------------|
| F-01 无 bin | package.json bin=null（npm-global 实物） |
| F-02 不 ship configs | files=["dist"]，npm-global 无 configs/ |
| F-03 读 event 非 hook_event_name | t1-synthetic-red：RED CONFIRMED（hook_event_name→0 索引；event→+2） |
| F-04 信封顶层 | 同上：legacy 路径输出顶层 updatedToolOutput |
| F-10 mcp 不 ship domains | files=["dist"]；docs 域查询返回 translate.goog×3+github.com×2（allowlist 外），CLI 对照全 allowlist（mcp-003-search-urls vs cli-003-urls） |

## deferred

- query_knowledge stub（承 R65 F-05，登记不修）
- internal anysearch provider 服务端排查（承 R65，successfulProviders 2/3 面）
- 宿主模型工具调用倾向：deepseekpro 代理模型对泛化 prompt 倾向凭记忆直答（t1-p2/p2b/p2d 零 toolCalls），冷门 query 才触发实调（t1-p2e）——host-variable 观察项，P9 结论须按此校准

## T2 首轮全矩阵（tarball=main 代码，npm-global 安装）补账

### expected-red 复验

| ER | tarball 复验结果 | 证据 |
|----|------------------|------|
| ER-1 模板 schema | **确认红**：tarball 的 configs/claude/hooks.json 同形原样接入 → 0 anysearch hook_started | t2-p6-template.stream.jsonl |
| ER-2 顶层信封 | **确认红→改判**：P6x deny 三腿——envelope `hookSpecificOutput.permissionDecision:deny`→真实 Bash 调用被拦(permission_denials+tool_result=reason)；legacy `decision:block`→拦；**顶层 `permissionDecision`→真实 `ls -la` 照常执行=被忽略**。adapter 的 additionalContext/updatedToolOutput 写顶层→同理被宿主丢弃 | t2-p6x-env2/t2-p6x-leg2/t2-p6x-toplevel |
| ER-3 plugin 骨架 | **确认红**：`claude plugin validate <npm-global>/plugin`→"No manifest found: Expected .claude-plugin/{marketplace,plugin}.json"；`--plugin-dir`/`--plugin-url` flag 存在可用 | t2-p11-plugin 输出 |

### found（T2 新增）

| ID | 发现 | 证据 | 处置 |
|----|------|------|------|
| R66-B04 | search_web 真实响应存在两形态：全量 `{query,totalResults,results[]}`（直拉/域内命中）vs 瘦身 `{sufficiency,attribution,claims:[]}`（claims 空时）；adapter distill 依赖 `.results`→瘦身响应**正确跳过索引**（非缺陷，但 P5 宿主侧 /index 依赖有结果的响应；契约单测应钉两形态） | t2-p5-realcall tool_result 380ch；synthetic /index 2→4 行 | T3：契约测试钉死两形态；文档说明 |
| R66-B05 | stream-json 只发 SessionStart 的 hook_started/hook_response；Pre/PostToolUse 钩子**运行但零事件**（marker 实证）；输入校验失败(`{}`调用)先于钩子→不触发 | t2-p6x-marker3 | 宿主观测事实→P6 判词口径=副作用而非事件流 |
| R66-B06 | type:"http" settings 钩子静默丢弃（0 hook_started）→2.1.251 上 http hooks 不可行，command 型唯一通路 | t2-p10-http | 文档注明；P10 终结论 |
| R66-B07 | 宿主代理模型行为噪声：首 call 常空 `{}`→InputValidationError 后自愈；WebSearch 402 缺 opencode key；WebFetch 可用；泛化 prompt 凭记忆直答 | 多 transcript | host-variable，不属产品缺陷；探针 prompt 工程注记 |

### T2 探针判定汇总

| 探针 | 判定 | 证据 |
|------|------|------|
| P1 tools/list | 绿（connected+5 工具，真宿主+直拉双腿） | t2-p6-official / mcp-tools-list |
| P2 域内 | 绿（F-10 已修：域内全 allowlist；vs 0.0.3 域灭对照成立） | t2-p2-indomain-direct |
| P3 OOD | 绿（域外 query 被收入 allowlist 语料=域楔工作；abstain=null 为产品行为注记） | t2-p3-ood-direct |
| P4 ans_chat | 绿（真实上游返回 "Agent completed"，isError=null） | t2-p4-anschat |
| P5 recall | 条件绿：协议面 hits 正常；宿主 PostToolUse→/index 链路=合成+marker 双侧证（真跑但瘦身响应合法跳过） | recall / synthetic-post / marker3 |
| P6 三事件 | 部分绿：SessionStart 真注入✓；Pre/Post 钩子真跑（marker）✓但输出信封被丢（ER-2 红） | t2-p6-official / marker3 / p6x 三腿 |
| P7 fail-open | 绿（杀 server 后 session ok，4 钩全 exit=0） | t2-p7-failopen |
| P8 research+qk | 绿（research 真答；qk honest stub deferred） | t2-p8-* |
| P9 对照 | 观测：双腿均答对 0.0.3；宿主自带 Bash/WebFetch/内建浏览可替代版本查询——MCP 差分弱，T4 双跑方差按此校准 | t2-p9a/b |
| P10 http hooks | 终结论：settings http 型静默丢→不可行，command 型唯一 | t2-p10-http |
| P11 plugin | 红确认：无 .claude-plugin manifest；--plugin-dir 可用待骨架 | t2-p11-plugin |

## T4 修复后复跑（t3-pack tarball，npm-global）

| 项 | 结果 | 证据 |
|----|------|------|
| ER-1 模板 schema | **转绿**：出厂 template（官方 schema + `ans-hook-*` bin）→ anysearch SessionStart 钩子真实触发，hook_response 收到完整路由卡 | t4-p5-realcall.stream.jsonl hook_response |
| ER-2 顶层信封 | **转绿**：session-start 实发 `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"[anysearch plugin active]..."}}` | 同上；126 单测含信封断言 |
| ER-3 plugin 骨架 | **转绿**：`claude plugin validate` repo+installed 均 pass（0 warn）；`--plugin-dir` 实测加载——init `plugin:anysearch:anysearch:connected` + plugin SessionStart 钩子真触发（`${CLAUDE_PLUGIN_ROOT}` 本机展开正常） | t4-p11-plugindir.stream.jsonl |
| 新增：validate 字段 | `plugin.json` repository 须 string（npm 对象形态报错）；SKILL.md 须 frontmatter——已修 | validate 输出 |
| host 观测 | Claude `-p` 模型调用前 init/hook 链路完整产出（api_retry 循环=模型代理 127.0.0.1:15721 宕机所致，与产品无关） | api_retry 事件 |

### T4 待补（模型代理恢复后）
- template 注入→模型引用路由卡（injection→awareness 闭环最后一环）
- 真实 search_web 成功调用→PostToolUse→projectIndex 行增量（t2-p5-realcall 形态为瘦身响应、合法跳过索引；须结果承载形）
- P9 双跑方差第二跑

## T4 复跑收尾（代理恢复后）

| 项 | 结果 | 证据 |
|----|------|------|
| 注入→模型引用闭环 | **转绿**：template 接线后模型逐字引用路由卡首条 trigger rule（`"- Fresh facts / current events -> search_web"`） | t4-p6-template.stream.jsonl result |
| 真实 search→index 增量 | **host-variable 结论**：宿主路径真实 search_web/research_web/ans_chat 调用均执行；本环境 sufficiency gate 恒 `ambiguous`（crossEngineVerify agreement jaccard=0）→ 瘦身响应无 results[]→PostToolUse 合法跳过索引。索引代码路径已由 T2 合成 stdin +/index round-trip + 契约测覆盖 | t4-p5-realcall3/4/5/6 |
| P9 第二跑（方差） | **完成**：t4-p9b2-mcp 工具腿真实调用 search_web+ans_chat 答对 0.0.3；双腿跨跑一致性=均正确 | t4-p9b2-mcp.stream.jsonl |
| 额外 live 发现 | **PreToolUse URL 策略真拦**：host 内 WebFetch 域名外 URL 被 anysearch hook 拒（`URL not on allowlist … ans hitl review --allow-url`）——B01 之后的正向实证 | t4-p5-realcall3 transcript |
| 宿主模型观测 | deepseekpro 存在"叙述调用而非实发"行为（t4-p5-realcall2 口述 service error 但 transcript 零 tool_use）——prompt 须强制 tool_use 实证 | 同上 |
| ans_chat 空正文 | host 上 ans_chat 返回 "Agent completed"——ANS_LLM_* 上游在本环境未供可用端点（env 缺）——记录为环境项非产品红 | t4-p5-realcall6 |

## R66 审计返工（2026-09-17，post-release）

| 编号 | 发现 | 修复 | 证据 |
|------|------|------|------|
| F-01 | ship-gate.mjs 版本钉仍 `!== "0.0.3"`——0.0.4 bump 未同步，合 main 即红 | 钉改 `0.0.4`+注释补"版本 bump 与钉同 commit"纪律 | scripts/ship-gate.mjs:214 |
| F-02 | claude-contract 漂移守卫先 regen 再快照→永不能发现手改，且写源树 | 生成器加 `ANS_GEN_OUT` 输出根；测试改 快照→regen 到 tmp→对比（不动源树） | gen-claude-configs.mjs、claude-contract.test.ts |
| F-03 | session-start.cjs 五宿主共享，改信封后 Codex/Cursor/Antigravity 裸 `additionalContext` 契约被破（已随 0.0.4 发布=已发布缺陷） | `--envelope` 旗标分流：Claude 生成配置带旗→信封；默认回裸形；contract 双形断言 | session-start.ts、hooks.test.ts、claude-contract.test.ts；README 已记 0.0.4 已发布缺陷 |
| F-04 | README banner/Known Limitations 仍 0.0.3 口径 | banner→0.0.4；五条 ≤0.0.3 项标"fixed in 0.0.4"；新增 0.0.4 session-start 缺陷条目 | README.md |
| F-05 | 报告 vitest 命令名不实 | 改 `pnpm test`（node --test） | reports/2026-09-17-report.md |

### 返工 live 复验

- 发现链：首轮复验真宿主裸形输出→追出 npm prefix 双根（`D:\nodejs` vs `Roaming\npm`，脚本锚定后者而 `npm i -g` 落前者）——装包须 `--prefix` 钉 Roaming。 <!-- machine-local: user-level agent/tooling config path on build host @ 2026-09-19 -->
- 修正装包+server 重启后：`ans-hook-session-start --envelope` 经 shim 真发信封（hook_response `hookSpecificOutput` 头）+模型逐字引第二条 trigger rule——t4-rework-p6b.stream.jsonl。
- `pnpm test` 8/8 套全绿（codebuddy-contract 修 bin 带参解析+session-start 裸形断言两处）；tsc/lint clean；repack tarball 验证 SessionStart 命令=`ans-hook-session-start --envelope`。
