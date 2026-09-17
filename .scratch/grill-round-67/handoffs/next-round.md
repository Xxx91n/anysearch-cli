# R67 → next implementation handoff（常驻任务书，2026-09-17 grill 定稿，全绝对路径）

## 零上下文摘要
R67=串行双主题轮（D-001）：**先 B**=真 Codex CLI 0.142.5 宿主验证（R66 探针矩阵移植+Codex 预期重判+契约形态裁决）；**后 A**=0.0.5 经已实证 OIDC TP 通道发布（session-start 修复随车送达，不发 0.0.4.1）。账本=唯一事实源；实施=七票串行 T1-T7，B 段不绿不许 bump。仓库根=D:\Aworker\anysearch-cli。

## 事实源
- 账本：D:\Aworker\anysearch-cli\.scratch\grill-round-67\decision-ledger.md（D-001..D-005 全 current）
- 调研存档：D:\Aworker\anysearch-cli\.scratch\grill-round-67\q1-atomcode.md（主题定界：契约族覆盖判据+fix rides next release+Codex 契约成熟度表）
  D:\Aworker\anysearch-cli\.scratch\grill-round-67\q2-atomcode.md（证据轨道：三轨方案+四腿裁决设计+隔离姿势+hooks 部署位优先级+信息缺口）
- R66 可复用资产：D:\Aworker\anysearch-cli\.scratch\grill-round-66\scripts\ 探针脚本（改 codex flag 移植）、D:\Aworker\anysearch-cli\.scratch\grill-round-66\evidence\ 证据形惯例、D:\Aworker\anysearch-cli\.scratch\grill-round-66\handoffs\round-66-audit-closeout.md 宿主契约事实
- ADR 载体：D:\Aworker\anysearch-cli\docs\adr\0068-*.md 待建（T5）

## 宿主/环境事实（已实测/调研，勿重推）
- Codex CLI **0.142.5** @ C:\Users\Administrator\AppData\Roaming\npm\codex；auth=custom provider→同代理 http://127.0.0.1:15721，模型 deepseekpro，wire_api=responses。
- headless 协议面：codex exec "…" --json（JSONL 事件流，**无需 --verbose**） -o <file> --output-schema <file> --ephemeral --cd <dir> --add-dir <dir> --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust --ignore-user-config --ignore-rules -c key=value -p <profile>
- config.toml（C:\Users\Administrator\.codex\config.toml）：features.hooks=true 已开；hooks.state 显示 plugin 捆绑 hooks 已跑（context-mode+ponytail）；mcp_servers 已有 1mcp/node_repl；project_doc_max_bytes=88304。
- 配置 precedence（三源一致）：CLI/-c > trusted project config > profile > user > system > defaults。**每腿单层注入**——混层无法归因；profile 可被 trusted project 静默遮蔽，不当主轨。
- hooks 契约事实：GA 五事件（SessionStart/Stop/UserPromptSubmit/PreToolUse/PostToolUse）；输出三形态=hookSpecificOutput 信封/legacy 顶层 decision/exit-2+stderr；**顶层裸 additionalContext 在官方文档中不存在**（0.0.4 缺陷判别面）；hooks 加性合并、并发触发无顺序保证；非 managed hook 按定义 hash 记信任（改即回未信任，headless 摩擦点）；项目级 .codex/hooks.json 需 project trust；plugin 捆绑无免信任通道。
- MCP stdio 一等公民：config.toml [mcp_servers]；required=true 时初始化失败=exec 硬退出（**非 fail-open**，P7 预期改判）。
- 0.0.4 已知缺陷：session-start 无 --envelope 旗标=信封-only；对 Codex 的真实影响面是**未验证假设**（README 记“Codex 裸契约破”系推测，裁决探针定谳后须文档对账——破与不破两方向都要改文档）。
- 现有未过真机资产：D:\Aworker\anysearch-cli\apps\plugin\src\hooks\adapters\codex.ts（输出顶层 additionalContext）、D:\Aworker\anysearch-cli\apps\plugin\configs\codex\hooks.json（{name,command,args[],timeout}+${CODEX_PLUGIN_DIR} 非官方形）。
- env（用户级已设，新进程继承，键值不落盘）：ANYSEARCH_API_KEY、ANYSEARCH_ENDPOINT=http://127.0.0.1:20128/v1/search、ANS_LLM_*（openai/nemotron/127.0.0.1:20128/chat）、EXA_API_KEY。
- 发布面：npm 0.0.4 四包在 registry+provenance；release.yml publish job 已实证（tag 触发+id-token+npm 升级+pack×4+publish --provenance）——T6 只复核沿用。

## 探针矩阵与裁决实验（D-002）
**Track A（published 0.0.4，证据权威轨）**：契约形态 smoke——四腿信封裁决 L0 {}（基线排假阳）/L1 信封/L2 顶层裸字段=裁决腿即 0.0.4 现状/L3 plain-text/L1′ 混合载荷画宽容边界；+required=true MCP 初始化哨兵+OOD 拒答腿+Windows hooks 可用性腿（失败记宿主限制）。隔离主轨=--ignore-user-config+-c 逐层注入；旁证轨=项目级 .codex/ 走真 trust 流程（验迁移假设）。marker 用随机 nonce；判读=marker 是否进下一 turn 指令流（非仅 hook fired 事件）。
**Track B（tarball 0.0.5 候选体，回归轨）**：P1-P9 直移+Codex 预期改判（required 硬失败/exit-2 形态/并发无序/Pre-Post 覆盖 apply_patch 与 MCP 调用）+双位置腿（项目级主+用户级加性旁证）。
**Track C**：dev-iteration 快跑，不进证据档案。
方法纪律沿用 R66：不变量/变量子断言、expected-red 四态分类账（编号理由+failure_class）、tag 分层门禁（core/host-variable/host-specific/experimental）、transcript+debug 全量落 D:\Aworker\anysearch-cli\.scratch\grill-round-67\evidence\。

## 票序（D-004，串行）

### T1 部署腿+Track A【覆盖 D-002】
Codex env/auth 继承验证→e2e 现场 D:\Aworker\e2e-r67-codex（仓外纪律同 R65/R66）→published 0.0.4 契约形态 smoke 全腿（裁决+哨兵+OOD+Windows 可用性）→合成 stdin 红实证→expected-red 四态台账建账→**裁决结论落账**（Codex 吃信封/裸字段/双吃=0.0.4 缺陷影响面定谳）。
验收：每腿 transcript+判读依据；裁决结论写进台账。suggested skills：无（直跑）；参考 R66 T1 证据形。

### T2 tarball 首轮全矩阵【覆盖 D-002】
pnpm build+pack 本地 tarball→干净目录安装→Track B 全矩阵跑完→expected-red 逐条四态入账。
验收：每探针 transcript+子断言 verdict（Codex 预期已改判）。suggested skills：无。

### T3 修复票【覆盖 D-003】——备份先行
**修改任何现有文件前先做可回滚备份**（D-003 显式约束）。D:\Aworker\anysearch-cli\apps\plugin\configs\codex\hooks.json 改官方 schema（事件→匹配→hooks 数组）；D:\Aworker\anysearch-cli\apps\plugin\src\hooks\adapters\codex.ts 与 D:\Aworker\anysearch-cli\apps\plugin\src\hooks\session-start.ts 输出形态按 T1 裁决结果对齐（吃信封则统一信封/吃裸字段则 codex 裸契约+claude 信封双形并存）；随包 AGENTS.md 说明块（ans_* 白名单+fail-open 语义，供贴入项目 AGENTS.md）；合成 stdin 契约单测；T2 缺陷修复/挂账。
验收：先红后绿证据对；备份可还原。SUGGESTED SKILLS：code-review（diff 双轴复核）。

### T4 复跑【覆盖 D-002/D-003】
修复后 tarball 全矩阵转绿+P9 双跑方差+expected-red 逐条闭环（XPASS 摘标/deferred 挂账）+迁移假设旁证腿复核。
验收：core tag 全绿；变量项建 Codex 基线；experimental 不挡门。suggested skills：无。

### T5 文档票【覆盖 D-002/D-003/D-005 文档面】
ADR-0068（D:\Aworker\anysearch-cli\docs\adr\0068-*.md：主题/三轨/部署形态+裁决结论/发布沿用/closure 回填位）+D:\Aworker\anysearch-cli\README.md verified-hosts 增 Codex CLI 0.142.5（版本/日期/验证面+0.0.4 缺陷裁决结论修正或坐实）+D:\Aworker\anysearch-cli\CHANGELOG.md+D:\Aworker\anysearch-cli\CONTEXT.md 词块按实施实绩校准+D:\Aworker\anysearch-cli\docs\codex-integration.md（含 AGENTS.md 说明块可选步骤）。
验收：不过度宣称；裁决结论两方向均已文档对账。suggested skills：domain-modeling。

### T6 发布工程票【覆盖 D-001】
全包 bump 0.0.5（D:\Aworker\anysearch-cli\apps\cli\package.json、D:\Aworker\anysearch-cli\apps\mcp\package.json、D:\Aworker\anysearch-cli\apps\plugin\package.json、D:\Aworker\anysearch-cli\packages\embedding\package.json）+CHANGELOG；D:\Aworker\anysearch-cli\.github\workflows\release.yml publish job 复核沿用（0.0.4 已实证，不新增）；打包演练（pnpm pack×4 内容核）。
验收：**B 段不绿不开此票**；演练产物清单核对。suggested skills：无。

### T7 发布执行+收口【覆盖 D-001/D-004/D-005】
git tag v0.0.5+push（当场授权）→release-gate post-tag 绿+publish job run URL→npm view 四包 0.0.5+provenance attestation 实测→净机 npm i -g 0.0.5→doctor→search 冒烟→ADR-0068 closure 四段回填（B 宿主证据/A 发布证据/缺陷台账/产品面结论+0.0.5=session-start 修复送达版口径）。
验收：D-005 四段全回填。suggested skills：neat-freak（收口核对）、handoff。

## 范围外登记（D-001）
- internal anysearch provider 服务端排查（需用户侧服务窗口）
- projectIndex 双库不同根设计裁决（另轮 grill 主题）
- interactive TUI/embedding arm/跨 OS matrix 散件
- Cursor/Antigravity 真宿主验证（后续宿主轮）
- plugin 升格默认路径（判据>=2 条）
- F-01a ship-gate×GitButler clean-tree + npm prefix 双根陷阱（工具链轮候选）
- watch 观测窗值守（运行中义务，不占票）

## 红线
- **修改任何现有文件前先做可回滚备份**（D-003）
- 键值永不进对话/证据/提交物；e2e 现场留仓外；transcript 入库前扫密钥模式
- publish/tag/push 当场授权；版本控制写操作一律 but（禁 git 写）
- `> nul` 在 Git Bash 产实体 nul 文件断 but 扫描——用 `>/dev/null`
- B 段不绿不许 bump/发布；预期红进四态分类账不静默修
- 每腿单层配置注入；--dangerously-bypass-hook-trust 不进主轨；SessionStart 探针不假设独占 stdout
- 实测对象=published 0.0.4 或 pnpm pack tarball；不用 repo build 冒充发布物
- exec 负载中不写连续反斜杠对（源码里的 \\ 会被传输层折叠成 \）——源码用前斜杠路径+String.fromCharCode(92) 运行时转换
