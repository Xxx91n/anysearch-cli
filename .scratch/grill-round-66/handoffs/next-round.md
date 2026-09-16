# R66 → next implementation handoff（常驻任务书，2026-09-16 grill 定稿，全绝对路径）

## 零上下文摘要
R66=串行双主题轮（D-001）：**先 B**=真 Claude Code 宿主验证（R65 探针矩阵全移植+增补+方法论升级）；**后 A**=0.0.4 发布工程（OIDC trusted publishing，兑现 R63 D-006 欠条）。账本=唯一事实源；实施=七票串行 T1-T7，B 段不绿不许 bump。仓库根=D:\Aworker\anysearch-cli。

## 事实源
- 账本：D:\Aworker\anysearch-cli\.scratch\grill-round-66\decision-ledger.md（D-001..D-007 全 current）
- 调研存档：D:\Aworker\anysearch-cli\.scratch\grill-round-66\q3-atomcode.md（plugin vs settings.json，混合方案+CLAUDE_PLUGIN_ROOT Windows bug 链）
  D:\Aworker\anysearch-cli\.scratch\grill-round-66\q4-atomcode.md（探针移植方法论，全移植+四态分类账+tag 分层）
- R65 可复用资产：D:\Aworker\anysearch-cli\.scratch\grill-round-65\scripts\probe.mjs 与 D:\Aworker\anysearch-cli\.scratch\grill-round-65\scripts\mcp-call-tool.mjs（改 claude flag 移植）、e2e 现场做法、evidence 命名惯例
- ADR 载体：D:\Aworker\anysearch-cli\docs\adr\0067-*.md 待建（T5）

## 宿主/环境事实（已实测，勿重推）
- Claude Code **2.1.251** @ C:\Users\Administrator\.local\bin\claude；本地代理 http://127.0.0.1:15721 鉴权（PROXY_MANAGED token，模型映射 deepseekpro）。headless 一次真调成功：assistant "ok" / result success / $0.21 / 5.4s。
- headless 协议面：claude -p "…" --output-format stream-json **--verbose（必填，缺即报错）** --max-turns N --dangerously-skip-permissions --mcp-config <file> --strict-mcp-config --settings <file|json> --plugin-dir <dir>
- hooks 实证：stream-json 见 system/hook_started|hook_response 事件；全局 context-mode SessionStart hook 真注入 hookSpecificOutput.additionalContext——信封契约在真 Claude 上是活的。全局 C:\Users\Administrator\.claude\settings.json 已有该 hook，项目级 .claude/settings.json 与其合并并存，transcript 须能区分两者。
- e2e 现场：D:\Aworker\e2e-r66-claude（已建，含 live-probe.jsonl 首证）。仓库外纪律同 R65（防 D:\Aworker\anysearch-cli\AGENTS.md 污染）。
- env（用户级已设，新进程继承，键值不落盘）：ANYSEARCH_API_KEY、ANYSEARCH_ENDPOINT=http://127.0.0.1:20128/v1/search、ANS_LLM_PROVIDER=openai、ANS_LLM_MODEL=nvidia/nvidia/nemotron-3-ultra-550b-a55b、ANS_LLM_BASE_URL=http://127.0.0.1:20128/v1、ANS_LLM_API=chat、ANS_LLM_API_KEY、EXA_API_KEY（在场）。
- 发布面：published npm 0.0.3 四包（cli/mcp/plugin/embedding，access:public）**不含** R65 修复；main 含全部修复。D:\Aworker\anysearch-cli\.github\workflows\release.yml 仅评测闸（pre-tag OF look/post-tag 断言），无 publish job。npm 本机 11.6.1（>=11.5.1 够 TP）；CI setup-node 22 自带 npm~10.x——publish job 内须升级。版本 bump=全包手工（0.0.3 同制）。

## 预期红清单（B 段，实现票的既定捕获对象）
1. D:\Aworker\anysearch-cli\apps\plugin\configs\claude\hooks.json 模板为 {name,command,args[],timeout}+${CLAUDE_PLUGIN_DIR} 形，**与 Claude Code 官方 {matcher,hooks:[{type:command,command}]} schema 不匹配**——settings.json 与 plugin hooks.json 均不认；
2. D:\Aworker\anysearch-cli\apps\plugin\src\hooks\adapters\claude.ts 的 additionalContext/updatedInput 与 D:\Aworker\anysearch-cli\apps\plugin\src\hooks\session-start.ts 的 additionalContext 在**顶层**输出（信封仅包 permissionDecision）——真 Claude 是否忽略顶层事件字段待 P6x 实证；
3. plugin 骨架不存在（建议落点 D:\Aworker\anysearch-cli\apps\plugin\.claude-plugin\：plugin.json+同构 hooks/hooks.json+.mcp.json，单一源生成防漂移，**禁依赖 ${CLAUDE_PLUGIN_ROOT}**，标 experimental）。

## 探针矩阵（D-004）
P1 tools/list | P2 域内 search | P3 OOD abstain | P4 ans_chat | P5 recall 往返 | P6 hooks 三事件 | P7 fail-open | P8 research_web 多轮+query_knowledge stub 实录 | P9 同题对照（双跑记方差，结论限“该宿主工具增量”）| **P6x 信封对照**（顶层 vs hookSpecificOutput 哪个真生效）| **P10 http 型 hooks 可行性**（settings.json 是否接受 type:http 直 POST 33333）| **P11 plugin 骨架 validate+--plugin-dir 加载级**。
规则：每探针拆不变量/变量子断言（不变量跨宿主必绿=移植缺陷；变量照跑记录建 Claude 独立基线）；expected-red 四态分类账（not-scored/pending/xfail-strict/skip-with-reason，编号理由+failure_class，XPASS 自动转正）；tag 分层（core 必绿/host-variable 记录/host-specific 条件化/experimental 不挡门）；每探针隔离 mcp.json；transcript+debug 全量落 D:\Aworker\anysearch-cli\.scratch\grill-round-66\evidence\；“调用过”不等于“有效”——验返回内容；stub 不当通过。

## 票序（D-006，串行）

### T1 B 部署腿+0.0.3 基线【覆盖 D-002】
新进程 env 继承验证→D:\Aworker\e2e-r66-claude 接线→published 0.0.3 轻量三探针（P1 tools/list、域内 search 看 F-10 域灭在 Claude 复现、hooks 按现状模板接入=no-op 实证）+合成 stdin 红实证。证据+defect 台账建账（四态），落 D:\Aworker\anysearch-cli\.scratch\grill-round-66\evidence\。
验收：三探针 transcript+台账建账。suggested skills：无（直跑）；参考 R65 T1 证据形。

### T2 tarball 首轮全矩阵【覆盖 D-002/D-004】
pnpm build+pack 本地 tarball→干净目录安装→P1-P9+P6x/P10/P11 全跑→expected-red 逐条四态入账。
验收：每探针 transcript+子断言 verdict；增补探针结论落账。suggested skills：无。

### T3 修复票【覆盖 D-003】
D:\Aworker\anysearch-cli\apps\plugin\configs\claude\hooks.json 改官方 schema；D:\Aworker\anysearch-cli\apps\plugin\src\hooks\adapters\claude.ts 与 D:\Aworker\anysearch-cli\apps\plugin\src\hooks\session-start.ts 输出对齐 hookSpecificOutput 信封；plugin 骨架三件套单源生成；合成 stdin 契约单测；T2 缺陷修复/挂账。
验收：先红后绿证据对；双配置同源。suggested skills：code-review（diff 双轴复核）。

### T4 复跑【覆盖 D-002/D-003/D-004】
修复后 tarball 全矩阵转绿+P9 双跑方差+plugin validate/--plugin-dir 实证+http hooks 终结论+expected-red 逐条闭环（XPASS 摘标/deferred 挂账）。
验收：core tag 全绿；变量项建 Claude 基线；experimental 不挡门。suggested skills：无。

### T5 文档票【覆盖 D-003/D-004 文档面】
ADR-0067（D:\Aworker\anysearch-cli\docs\adr\0067-*.md：主题/双轨/部署形态+plugin 升格判据/探针口径/发布通道/closure 回填位）+D:\Aworker\anysearch-cli\README.md verified-hosts 增 Claude Code 2.1.251（版本/日期/验证面）+D:\Aworker\anysearch-cli\CHANGELOG.md+D:\Aworker\anysearch-cli\CONTEXT.md 词块按实施实绩校准+D:\Aworker\anysearch-cli\docs\claude-integration.md。
验收：不过度宣称（plugin=experimental、未验证面列尽）。suggested skills：domain-modeling。

### T6 发布工程票【覆盖 D-005】
全包 bump 0.0.4（D:\Aworker\anysearch-cli\apps\cli\package.json、D:\Aworker\anysearch-cli\apps\mcp\package.json、D:\Aworker\anysearch-cli\apps\plugin\package.json、D:\Aworker\anysearch-cli\packages\embedding\package.json）+CHANGELOG；D:\Aworker\anysearch-cli\.github\workflows\release.yml 追加 publish job（needs:release-gate；permissions id-token:write+contents:read；job 内 npm i -g npm@latest 并断言 >=11.5.1；pnpm pack x4→npm publish <tgz> x4，TP 自动附 provenance）；TP 逐字配置指令（repo+workflow 文件名+约束值）文档化交用户；--dry-run 只验打包面。
验收：workflow 语法过 CI；TP 指令可逐字照抄；**B 段不绿不开此票**。suggested skills：无。

### T7 发布执行+收口【覆盖 D-005/D-006/D-007】
用户配 TP（当场授权）→git tag v0.0.4+push（授权）→release-gate post-tag 绿+publish job run URL→npm view 四包 0.0.4+provenance attestation 实测（registry manifest 复核）→净机 npm i -g 0.0.4→doctor→search 冒烟→ADR-0067 closure 四段回填（B 宿主证据/A 发布证据/缺陷台账/产品面结论+OIDC 欠条关闭声明+0.0.4=首个 OIDC 发布口径）。
验收：D-007 四段全回填；72h unpublish 窗内完成自验。suggested skills：neat-freak（收口核对）、handoff。

## 范围外登记（D-001）
- internal anysearch provider 服务端排查（需用户侧服务窗口）
- projectIndex 双库不同根设计裁决（另轮 grill 主题）
- interactive TUI/embedding arm/跨 OS matrix 散件
- Cursor/Codex/Antigravity 真宿主验证（后续宿主轮）
- plugin 升格默认路径（须满足调研判据>=2 条）
- watch 观测窗值守（运行中义务，不占票）

## 红线
- 键值永不进对话/证据/提交物；e2e 现场留仓外；transcript 入库前扫密钥模式
- publish/tag/push 当场授权；版本控制写操作一律 but（禁 git 写）
- `> nul` 在 Git Bash 产实体 nul 文件断 but 扫描——用 `>/dev/null`
- B 段不绿不许 bump/发布；plugin 路径不谎称 verified；不把 stub 当通过
- 实测对象=published 0.0.3 或 pnpm pack tarball；不用 repo build 冒充发布物
- 预期红进四态分类账（编号理由），不静默修
