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
