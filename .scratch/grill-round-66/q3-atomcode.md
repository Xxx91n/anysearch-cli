# atomcode 调研存档（ctx_batch_execute 输出原文，含索引节重排）

研究问题=Q3 B 段 hooks 部署形态（settings.json 直挂 vs plugin 完整体）

---

Executed 1 commands (119 lines, 15.4KB). Indexed 11 sections. Searched 5 queries.

## Commands

- atomcode-q3-claude-plugin-vs-settings: `atomcode -p "调研任务：Claude Code 官方 plugin 系统能力边界与成熟度，服务于一个部署形态决策。背景：我们有一个通过 npm 分发的三件套产品（CLI + MCP stdio server + 本地 hooks 适配器集合与本地 HTTP server），要在 Claude Code 上提供：5 个 MCP 工具、PreToolUse/PostToolUse/SessionStart 三个 hooks、一个长驻本地 server。当前计划是把 hooks 通过项目级 .claude/settings.json 注册（matcher+hooks type command 官方 schema），模板命令是 node 绝对路径指向 npm 全局安装目录里的适配器文件。候选方案 C 是改做真正的 Claude Code plugin 包（.claude-plugin/plugin.json + hooks/hooks.json + .mcp.json 声明）。请调研并回答：1）Claude Code plugin manifest 的必填字段与目录约定；2）plu…`

## Indexed Sections

- atomcode-q3-claude-plugin-vs-settings (1.3KB)
- atomcode-q3-claude-plugin-vs-settings > 1) 执行摘要（Tl;dr） (0.7KB)
- atomcode-q3-claude-plugin-vs-settings > 2) 分点结论 (0.0KB)
- atomcode-q3-claude-plugin-vs-settings > 2) 分点结论 > Q1. Plugin manifest 必填字段与目录约定 (1.2KB)
- atomcode-q3-claude-plugin-vs-settings > 2) 分点结论 > Q2. hooks/hooks.json schema 同构性与 Windows 变量替换可靠性 (1.9KB)
- atomcode-q3-claude-plugin-vs-settings > 2) 分点结论 > Q3. Plugin 内声明 MCP server 的机制与 stdio 可移植性 (1.2KB)
- atomcode-q3-claude-plugin-vs-settings > 2) 分点结论 > Q4. 分发与安装通道 (2.0KB)
- atomcode-q3-claude-plugin-vs-settings > 2) 分点结论 > Q5. 两条路径工业界对比 (1.4KB)
- atomcode-q3-claude-plugin-vs-settings > 6) 对本场景的推荐：**混合方案（settings.json 默认路径 + plugin 骨架进阶分发）** (2.2KB)
- atomcode-q3-claude-plugin-vs-settings > 7) 完整来源清单 (2.5KB)
- atomcode-q3-claude-plugin-vs-settings > 8) 信息缺口 (0.9KB)

## plugin manifest

### atomcode-q3-claude-plugin-vs-settings > 2) 分点结论 > Q1. Plugin manifest 必填字段与目录约定
### Q1. Plugin manifest 必填字段与目录约定

**来源：[Plugins reference](https://code.claude.com/docs/en/plugins-reference)（已读全文，官方）**

- manifest 位于 **`.claude-plugin/plugin.json`**，且是**可选的**——省略时 Claude Code 自动发现默认目录组件，插件名取自目录名。
- **唯一必填字段是 `name`**（kebab-case）。其余全部可选：`displayName`、`version`、`description`、`author`、`homepage`、`repository`、`license`、`keywords`、`metadata`（Claude Code 不读、纯自留）、`defaultEnabled`、`dependencies`（支持 semver 约束）。
- 组件路径字段（均可 string|array|object）：`skills`、`commands`、`agents`、**`hooks`**（指向 hooks.json 或内联 config）、**`mcpServers`**（指向 .mcp.json 或内联）、`outputStyles`、`lspServers`、`experimental.themes/monitors/evals`。
- **未知顶层字段被忽略**（validate 只警告）——官方明确说这让一个 manifest 可以兼作 VS Code/Cursor 扩展 manifest、npm package.json 或 MCPB/DXT manifest。这一点对你们的三件套产品很有利：plugin.json 可以与 npm 包元数据共存。
- 校验命令：`claude plugin validate ./my-plugin`。

### atomcode-q3-claude-plugin-vs-settings
# atomcode-q3-claude-plugin-vs-settings

$ atomcode -p "调研任务：Claude Code 官方 plugin 系统能力边界与成熟度，服务于一个部署形态决策。背景：我们有一个通过 npm 分发的三件套产品（CLI + MCP stdio server + 本地 hooks 适配器集合与本地 HTTP server），要在 Claude Code 上提供：5 个 MCP 工具、PreToolUse/PostToolUse/SessionStart 三个 hooks、一个长驻本地 server。当前计划是把 hooks 通过项目级 .claude/settings.json 注册（matcher+hooks type command 官方 schema），模板命令是 node 绝对路径指向 npm 全局安装目录里的适配器文件。候选方案 C 是改做真正的 Claude Code plugin 包（.claude-plugin/plugin.json + hooks/hooks.json + .mcp.json 声明）。请调研并回答：1）Claude Code plugin manifest 的必填字段与目录约定；2）plu…

现在我来抓取 Claude Code 插件的官方文档。# Claude Code Plugin 系统能力边界与成熟度调研报告

**Sufficiency Gate**: searches: 5+ | angles: Official / Criticism / Comparative / Currency / Community | full reads: 9+（官方 5 页 + GitHub issue 2 + 社区若干） | domains: 5+（code.claude.com, github.com, hidekazu-konishi.com, claudefa.st, getclaudeskills.com, claudeissues.com, reddit 等） | gaps: 见文末

### atomcode-q3-claude-plugin-vs-settings > 2) 分点结论 > Q5. 两条路径工业界对比
### Q5. 两条路径工业界对比

| 维度 | settings.json 直挂 | plugin 包（候选 C） |
|---|---|---|
| 分发 | 模板文件用户手动合并；无目录制 | marketplace/npm/git/zip 多通道，`/plugin` 两步装 |
| 升级 | 改模板→用户重合并，易漂移 | version bump 自动推送到缓存副本 |
| 卸载 | 手动删 JSON 块 | `/plugin uninstall` 一次清除（hooks+MCP+缓存） |
| 权限边界 | 混入项目 settings，与用户自有配置互相污染 | 独立命名空间，enable/disable 粒度细；managed settings 可管控 |
| MCP 工具名 | 干净（`mcp__server__tool`） | 作用域化加长（`mcp__plugin_x_y__tool`），影响文档/提示词 |
| Windows hooks 可靠性 | 高（相对路径/绝对路径自控） | **`${CLAUDE_PLUGIN_ROOT}` 有已知 bug（#16116）** |
| 多宿主一致性 | hooks schema 本身是 Claude Code 专属 | manifest 未识别字段可兼作其他生态 manifest（官方支持），但 hooks/marketplace 机制仍不跨宿主 |
| 发现性/信任 | 无目录、无版本、无元数据 | 有分类/搜索/版本/依赖/sha pin；官方 marketplace 有人工策展 |

与业界形态对照：VS Code extension / JetBrains plugin 都是“目录制 + 版本化 + 独立权限边界 + 自动更新”，plugin 包在结构上收敛于这个工业标准；settings.json 直挂相当于“用户手动抄配置文件”，是 Git hooks/编辑器配置片段的形态，适合单项目低频场景。

## marketplace 上架

### atomcode-q3-claude-plugin-vs-settings > 2) 分点结论 > Q4. 分发与安装通道
### Q4. 分发与安装通道

**来源：[Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)、[Discover plugins](https://code.claude.com/docs/en/discover-plugins)（官方双源，已读全文主体）**

- **本地加载**：`--plugin-dir ./my-plugin`（即装即用，不进缓存，不参与“未使用”追踪）；或 `claude plugin validate` 校验。
- **Marketplace**：自建 marketplace = 一个仓库根放 `.claude-plugin/marketplace.json`（必填 `name` + `owner` + `plugins[]`，每项必填 `name` + `source`）。用户两步：`/plugin marketplace add owner/repo` → `/plugin install name@marketplace`。官方保留名清单（claude-plugins-official 等 18 个）禁止第三方使用，仿冒名也会被拒——**官方 marketplace（claude-plugins-official）由 Anthropic 人工策展，收录完全由其裁量**，应用内提交表单只能进 community marketplace。
- **source 类型**：相对路径 / github / url(git) / git-subdir / npm（支持 `version` 范围 + 自定义 registry）/ **archive（zip + 可选 sha256 完整性 pin，HTTPS 强制，≤256MiB，需 v2.1.224+）** / command（每 session 重跑生成，v2.1.229+）。git 源支持 ref+sha 精确 pin。
- **版本与升级**：`version` 字段即更新信号——bump 了才推送更新给用户；否则一直用缓存副本。安装即复制进 `~/.claude/plugins/cache`（本地相对路径源除外，原地加载）。
- **签名/审核**：无第三方强制签名；可选完整性手段是 archive 的 `sha256` pin 和企业 managed settings 限制（strictKnownMarketplaces 白名单、只允许 private/internal 仓库做 org 分发、可只允许 managed hooks）。
- **企业通道**：Team/Enterprise 的 Organization settings > Plugins 或 managed settings 里 `extraKnownMarketplaces` + `enabledPlugins`（[issue #45323](https://github.com/anthropics/claude-code/issues/45323) 指出 CLI 侧 org 托管插件的自动安装仍有摩擦，截至该 issue 未完全解决）。

### atomcode-q3-claude-plugin-vs-settings > 2) 分点结论 > Q5. 两条路径工业界对比
### Q5. 两条路径工业界对比

| 维度 | settings.json 直挂 | plugin 包（候选 C） |
|---|---|---|
| 分发 | 模板文件用户手动合并；无目录制 | marketplace/npm/git/zip 多通道，`/plugin` 两步装 |
| 升级 | 改模板→用户重合并，易漂移 | version bump 自动推送到缓存副本 |
| 卸载 | 手动删 JSON 块 | `/plugin uninstall` 一次清除（hooks+MCP+缓存） |
| 权限边界 | 混入项目 settings，与用户自有配置互相污染 | 独立命名空间，enable/disable 粒度细；managed settings 可管控 |
| MCP 工具名 | 干净（`mcp__server__tool`） | 作用域化加长（`mcp__plugin_x_y__tool`），影响文档/提示词 |
| Windows hooks 可靠性 | 高（相对路径/绝对路径自控） | **`${CLAUDE_PLUGIN_ROOT}` 有已知 bug（#16116）** |
| 多宿主一致性 | hooks schema 本身是 Claude Code 专属 | manifest 未识别字段可兼作其他生态 manifest（官方支持），但 hooks/marketplace 机制仍不跨宿主 |
| 发现性/信任 | 无目录、无版本、无元数据 | 有分类/搜索/版本/依赖/sha pin；官方 marketplace 有人工策展 |

与业界形态对照：VS Code extension / JetBrains plugin 都是“目录制 + 版本化 + 独立权限边界 + 自动更新”，plugin 包在结构上收敛于这个工业标准；settings.json 直挂相当于“用户手动抄配置文件”，是 Git hooks/编辑器配置片段的形态，适合单项目低频场景。

### atomcode-q3-claude-plugin-vs-settings > 6) 对本场景的推荐：**混合方案（settings.json 默认路径 + plugin 骨架进阶分发）**
## 6) 对本场景的推荐：**混合方案（settings.json 默认路径 + plugin 骨架进阶分发）**

**理由链**：

1. **默认路径继续 settings.json 直挂，但修模板为官方 schema**。你们模板已经用 matcher+hooks type command 的官方 schema（正确），剩余风险在：(a) Windows 上不要依赖 `${CLAUDE_PLUGIN_ROOT}`（settings.json 里本来就没有这个变量，天然免疫 #16116）；(b) node 绝对路径指向全局 npm 目录在 Windows 有空格/反斜杠风险——建议模板用 `node "%APPDATA%/npm/..."` 或安装器生成时用正斜杠绝对路径；(c) 已知边界：VS Code 扩展宿主中 settings.json hooks 不触发（[issue #21736](https://github.com/anthropics/claude-code/issues/21736)，closed as duplicate，属已知缺口）——需在文档标注。
2. **plugin 完整体作为“进阶分发”通道并行提供**，不是替代：plugin.json（name/version/mcpServers/hooks 三件套 + npm 元数据共存）+ hooks/hooks.json（从 settings.json 块逐字复制）+ 根 `.mcp.json`。发到自建 marketplace（npm 或 git 源，version bump 管升级）。成本主要在：工具名作用域化、Windows `${CLAUDE_PLUGIN_ROOT}` 风险（可用 archive+sha256 缓解分发信任，但运行时变量仍需测）、以及保持两份配置不漂移（用构建脚本从单一源生成，知识库里此前调研的“双 manifest 防漂移”经验同样适用）。
3. **plugin 收益盖过成本的判据条件**（满足任两条即值得把 plugin 提为默认路径）：
   - 用户量大且更新频繁（>周级 release，直挂的合并成本显著）；
   - 有企业/团队客户需要 managed settings 管控或统一 enable/disable；
   - 需要 MCP server 的**生命周期托管**（plugin 自动随 session 启停，长驻 server 场景下比 hooks 拉起更干净）；
   - 需要被官方 marketplace 或社区 marketplace 收录以获得发现性；
   - Windows 用户占比低或已验证 `${CLAUDE_PLUGIN_ROOT}` bug 在目标版本已修复（跟踪 #16116 重复链）。

反之，若用户少、更新慢、无企业管控需求，plugin 的作用域化工具名 + 双份配置维护成本不划算，settings.json 直挂 + npm 全局安装即可。

## hooks schema

### atomcode-q3-claude-plugin-vs-settings > 2) 分点结论 > Q2. hooks/hooks.json schema 同构性与 Windows 变量替换可靠性
### Q2. hooks/hooks.json schema 同构性与 Windows 变量替换可靠性

**来源：[Plugins reference](https://code.claude.com/docs/en/plugins-reference)、[Hooks reference](https://code.claude.com/docs/en/hooks)（官方双源）**

- **同构，可直接复制**。plugin 内 hooks 配置格式与 settings.json 的 `hooks` 块完全同构（同样的 `事件 → matcher → hooks[{type, command}]` 三层结构），社区指南（claudefa.st）也确认"copy that block verbatim"。plugin 支持的 hook 类型比 settings.json 更宽：`command`、`http`、`mcp_tool`、`prompt`、`agent` 五种。三个事件 PreToolUse / PostToolUse / SessionStart 官方均支持。
- **变量替换**：command 值支持 `${CLAUDE_PLUGIN_ROOT}`、`${CLAUDE_PLUGIN_DATA}`、`${CLAUDE_PROJECT_DIR}` 及任意 `${ENV_VAR}`；同时这三个变量也会作为环境变量注入 hook 子进程（`process.env.CLAUDE_PLUGIN_ROOT` 可读）。
- **Windows 可靠性：不可靠，有确凿 bug 链**。已读 [issue #16116](https://github.com/anthropics/claude-code/issues/16116)（2026-01，官方仓，closed as duplicate，重复项 #11984、#15481）：Windows 上 `${CLAUDE_PLUGIN_ROOT}` 展开为反斜杠路径后传给 bash 失败，报 `failed to start: The operation was aborted`；即使路径含空格（#15481）也失败。官方 workaround 就是“退回 settings.json 直挂相对路径”——这与你们的默认路径天然一致。另有第三方镜像 [claudeissues.com/issue/26389](https://claudeissues.com/issue/26389-plugin-hooks-fail-on-windows-claude-plugin-root-expands-with-backslashes)（2026-02）佐证：bash 配置下应展开为正斜杠但未修。**结论：截至 2026 年中，`${CLAUDE_PLUGIN_ROOT}` 在 Windows 的 hooks command 里不可作为依赖**；但注意你们如果用 `node C:\绝对路径\adapter.js` 这种不含该变量的 command，则绕开此 bug——受影响的只是“引用 plugin 缓存目录内文件”的形态。 <!-- machine-local: machine-local path cited in committed doc @ 2026-09-19 -->

### atomcode-q3-claude-plugin-vs-settings > 6) 对本场景的推荐：**混合方案（settings.json 默认路径 + plugin 骨架进阶分发）**
## 6) 对本场景的推荐：**混合方案（settings.json 默认路径 + plugin 骨架进阶分发）**

**理由链**：

1. **默认路径继续 settings.json 直挂，但修模板为官方 schema**。你们模板已经用 matcher+hooks type command 的官方 schema（正确），剩余风险在：(a) Windows 上不要依赖 `${CLAUDE_PLUGIN_ROOT}`（settings.json 里本来就没有这个变量，天然免疫 #16116）；(b) node 绝对路径指向全局 npm 目录在 Windows 有空格/反斜杠风险——建议模板用 `node "%APPDATA%/npm/..."` 或安装器生成时用正斜杠绝对路径；(c) 已知边界：VS Code 扩展宿主中 settings.json hooks 不触发（[issue #21736](https://github.com/anthropics/claude-code/issues/21736)，closed as duplicate，属已知缺口）——需在文档标注。
2. **plugin 完整体作为“进阶分发”通道并行提供**，不是替代：plugin.json（name/version/mcpServers/hooks 三件套 + npm 元数据共存）+ hooks/hooks.json（从 settings.json 块逐字复制）+ 根 `.mcp.json`。发到自建 marketplace（npm 或 git 源，version bump 管升级）。成本主要在：工具名作用域化、Windows `${CLAUDE_PLUGIN_ROOT}` 风险（可用 archive+sha256 缓解分发信任，但运行时变量仍需测）、以及保持两份配置不漂移（用构建脚本从单一源生成，知识库里此前调研的“双 manifest 防漂移”经验同样适用）。
3. **plugin 收益盖过成本的判据条件**（满足任两条即值得把 plugin 提为默认路径）：
   - 用户量大且更新频繁（>周级 release，直挂的合并成本显著）；
   - 有企业/团队客户需要 managed settings 管控或统一 enable/disable；
   - 需要 MCP server 的**生命周期托管**（plugin 自动随 session 启停，长驻 server 场景下比 hooks 拉起更干净）；
   - 需要被官方 marketplace 或社区 marketplace 收录以获得发现性；
   - Windows 用户占比低或已验证 `${CLAUDE_PLUGIN_ROOT}` bug 在目标版本已修复（跟踪 #16116 重复链）。

反之，若用户少、更新慢、无企业管控需求，plugin 的作用域化工具名 + 双份配置维护成本不划算，settings.json 直挂 + npm 全局安装即可。

### atomcode-q3-claude-plugin-vs-settings
# atomcode-q3-claude-plugin-vs-settings

$ atomcode -p "调研任务：Claude Code 官方 plugin 系统能力边界与成熟度，服务于一个部署形态决策。背景：我们有一个通过 npm 分发的三件套产品（CLI + MCP stdio server + 本地 hooks 适配器集合与本地 HTTP server），要在 Claude Code 上提供：5 个 MCP 工具、PreToolUse/PostToolUse/SessionStart 三个 hooks、一个长驻本地 server。当前计划是把 hooks 通过项目级 .claude/settings.json 注册（matcher+hooks type command 官方 schema），模板命令是 node 绝对路径指向 npm 全局安装目录里的适配器文件。候选方案 C 是改做真正的 Claude Code plugin 包（.claude-plugin/plugin.json + hooks/hooks.json + .mcp.json 声明）。请调研并回答：1）Claude Code plugin manifest 的必填字段与目录约定；2）plu…

现在我来抓取 Claude Code 插件的官方文档。# Claude Code Plugin 系统能力边界与成熟度调研报告

**Sufficiency Gate**: searches: 5+ | angles: Official / Criticism / Comparative / Currency / Community | full reads: 9+（官方 5 页 + GitHub issue 2 + 社区若干） | domains: 5+（code.claude.com, github.com, hidekazu-konishi.com, claudefa.st, getclaudeskills.com, claudeissues.com, reddit 等） | gaps: 见文末

## settings.json 直挂

### atomcode-q3-claude-plugin-vs-settings > 6) 对本场景的推荐：**混合方案（settings.json 默认路径 + plugin 骨架进阶分发）**
## 6) 对本场景的推荐：**混合方案（settings.json 默认路径 + plugin 骨架进阶分发）**

**理由链**：

1. **默认路径继续 settings.json 直挂，但修模板为官方 schema**。你们模板已经用 matcher+hooks type command 的官方 schema（正确），剩余风险在：(a) Windows 上不要依赖 `${CLAUDE_PLUGIN_ROOT}`（settings.json 里本来就没有这个变量，天然免疫 #16116）；(b) node 绝对路径指向全局 npm 目录在 Windows 有空格/反斜杠风险——建议模板用 `node "%APPDATA%/npm/..."` 或安装器生成时用正斜杠绝对路径；(c) 已知边界：VS Code 扩展宿主中 settings.json hooks 不触发（[issue #21736](https://github.com/anthropics/claude-code/issues/21736)，closed as duplicate，属已知缺口）——需在文档标注。
2. **plugin 完整体作为“进阶分发”通道并行提供**，不是替代：plugin.json（name/version/mcpServers/hooks 三件套 + npm 元数据共存）+ hooks/hooks.json（从 settings.json 块逐字复制）+ 根 `.mcp.json`。发到自建 marketplace（npm 或 git 源，version bump 管升级）。成本主要在：工具名作用域化、Windows `${CLAUDE_PLUGIN_ROOT}` 风险（可用 archive+sha256 缓解分发信任，但运行时变量仍需测）、以及保持两份配置不漂移（用构建脚本从单一源生成，知识库里此前调研的“双 manifest 防漂移”经验同样适用）。
3. **plugin 收益盖过成本的判据条件**（满足任两条即值得把 plugin 提为默认路径）：
   - 用户量大且更新频繁（>周级 release，直挂的合并成本显著）；
   - 有企业/团队客户需要 managed settings 管控或统一 enable/disable；
   - 需要 MCP server 的**生命周期托管**（plugin 自动随 session 启停，长驻 server 场景下比 hooks 拉起更干净）；
   - 需要被官方 marketplace 或社区 marketplace 收录以获得发现性；
   - Windows 用户占比低或已验证 `${CLAUDE_PLUGIN_ROOT}` bug 在目标版本已修复（跟踪 #16116 重复链）。

反之，若用户少、更新慢、无企业管控需求，plugin 的作用域化工具名 + 双份配置维护成本不划算，settings.json 直挂 + npm 全局安装即可。

### atomcode-q3-claude-plugin-vs-settings > 2) 分点结论 > Q5. 两条路径工业界对比
### Q5. 两条路径工业界对比

| 维度 | settings.json 直挂 | plugin 包（候选 C） |
|---|---|---|
| 分发 | 模板文件用户手动合并；无目录制 | marketplace/npm/git/zip 多通道，`/plugin` 两步装 |
| 升级 | 改模板→用户重合并，易漂移 | version bump 自动推送到缓存副本 |
| 卸载 | 手动删 JSON 块 | `/plugin uninstall` 一次清除（hooks+MCP+缓存） |
| 权限边界 | 混入项目 settings，与用户自有配置互相污染 | 独立命名空间，enable/disable 粒度细；managed settings 可管控 |
| MCP 工具名 | 干净（`mcp__server__tool`） | 作用域化加长（`mcp__plugin_x_y__tool`），影响文档/提示词 |
| Windows hooks 可靠性 | 高（相对路径/绝对路径自控） | **`${CLAUDE_PLUGIN_ROOT}` 有已知 bug（#16116）** |
| 多宿主一致性 | hooks schema 本身是 Claude Code 专属 | manifest 未识别字段可兼作其他生态 manifest（官方支持），但 hooks/marketplace 机制仍不跨宿主 |
| 发现性/信任 | 无目录、无版本、无元数据 | 有分类/搜索/版本/依赖/sha pin；官方 marketplace 有人工策展 |

与业界形态对照：VS Code extension / JetBrains plugin 都是“目录制 + 版本化 + 独立权限边界 + 自动更新”，plugin 包在结构上收敛于这个工业标准；settings.json 直挂相当于“用户手动抄配置文件”，是 Git hooks/编辑器配置片段的形态，适合单项目低频场景。

### atomcode-q3-claude-plugin-vs-settings > 8) 信息缺口
## 8) 信息缺口

- **#16116 是否已在某个具体版本修复**：issue 被 closed as duplicate，未读到修复 commit/版本号；落地前应在目标 Claude Code 版本实测 `${CLAUDE_PLUGIN_ROOT}` on Windows。
- **Windows 上 plugin 内 stdio MCP 的 `${CLAUDE_PLUGIN_ROOT}` 展开是否与 hooks 同病**：官方文档未区分，属推断。
- **官方 marketplace 实际收录标准**（策展流程不公开）：只能确认“收录由 Anthropic 裁量”。
- **plugin hooks 的 http 类型**（可直接 POST 到你们的本地 HTTP server）在 settings.json 直挂中是否同等可用——官方 hooks 文档支持 http 类型，但未验证 settings.json 直挂是否接受该 type，若可用可简化“长驻 server + hooks 适配器”链路。
[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。

继续此会话，运行：atomcode -p "…" --resume e55bf914-1c6a-4d08-ac61-1c6c235214be

## 推荐

No matching sections found.


> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use `ctx_search(queries: [...])` or call ctx_batch_execute with `query_scope: "global"`.

Searchable terms for follow-up: claude_project_dir, sessionstart, hidekazu-konishi, getclaudeskills, 26389-plugin-hooks-fail-on-windows-claude-plugin-root-expands-with-backslashes, marketplaces, plugin-marketplaces, discover-plugins, strictknownmarketplaces, claude-plugin, claudeissues, plugins-reference, pretooluse, posttooluse, comparative, workaround, mcp-servers, criticism, my-plugin, anthropic, atomcode, official, currency, validate, discover, archive, session, disable, scoped, source, sha256, enable, 11984, 15481, agent, 26389, 45323, 21736, 绝对路径, 官方双源