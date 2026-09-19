# atomcode 调研存档：薄 bundle 包形态与安装面 A/B/C/D（R72 Q2）

> exec 后台运行 stdout 原文

# 结论：推荐 A（新零运行时依赖包 @anysearch-cli/dsh-plugin），带两处修正

**Tl;dr（Confidence: 高）**：A 是成熟的行业形状——薄适配器 + 类型级宿主 API 耦合 + 最小安装面，完全符合 dsh 官方 bundle 模型（"bundle = 一个只贡献 patch 层 + 少量模块的 npm 包"）。B 会把 better-sqlite3 的构建脚本审批流拖进第三方管理的 profile 目录，是明确的反模式；C 内聚性错误；D 放弃了 `dsh plugin add` 的幂等装卸能力。两处修正：① one-step install（bundle patch 里声明 mcp-client 行）**建议做，但加一层防御**；② `private:true` + 本地路径验证**本轮足够**，但要把"可发布性检查"纳入验证清单。

## 对比矩阵

| 项 | 进程内占用 | 安装面风险 | 内聚性 | 可维护性 | 备注 |
|---|---|---|---|---|---|
| **A** 独立零依赖包 | 极小（~150 行 + fetch） | 干净：无 native 构建 | 高：hooks-layer 专属 | 好：类型合并即编译期 churn 告警 | **推荐** |
| B 扩展 @anysearch-cli/plugin | 拖入 better-sqlite3 + embedding peer | **pnpm 11 pendingBuilds 审批流在 profile 内触发** | 差：宿主包 ≠ 适配器 | 糟：发布宿主包 = 发布 dsh 适配 | 反模式 |
| C 塞进 @anysearch-cli/mcp | 小 | 干净 | **差**：hooks 层不是 MCP | 一般 | 内聚性错误 |
| D 无包 + 手工文档 | 零 | 零（但零自动化） | — | 差：丢掉 `dsh plugin add/remove` 的声明式装卸 | 仅作 fallback 文档 |

## 逐项分析

### A vs B：决定性因素是 pnpm 构建审批流，且已被官方文档实锤

官方 publish.md（deepseek-harness master）确认：`dsh plugin --profile <name> add` 就是转发给 profile 目录内的 pnpm，而 pnpm ≥10 拒绝运行未审批的构建脚本；pnpm 11.0 blog + `pnpm approve-builds` 文档确认该流程就是 `allowBuilds` 手动审批。我们 AGENTS.md 里已 pin `allowBuilds: better-sqlite3: false`——**在一个我们不拥有的 profile 目录里，用户面对的第一个 pnpm 交互就是"要不要批准 better-sqlite3 的构建脚本"，这是最差的第一印象**，而且 better-sqlite3@13 的 prebuilt 路径（dlopen，无需构建）在 profile 里反而会因审批流而困惑用户（不批准 → 也能跑，但 pnpm 会留下 pending 提示/警告）。官方文档自己给出的教训是 *"distribute built artifacts — neither form needs any build permission"*——A 天然满足：零运行时依赖 = 零构建脚本 = 零审批。

B 还有一个隐性代价：宿主包 `@anysearch-cli/plugin` 的版本节奏（SQLite schema 迁移、embedding peer 变化）会被 dsh 适配器的 churn 绑架，反之亦然。官方 bundle 模型里 "bundle 是你 author & distribute 的东西，profile 是用户 boot 的东西，nothing is both"——把适配器塞进宿主运行时包混淆了这两个角色。

### A 的两个设计点都是行业先例支持的

1. **devDeps 类型级耦合作为 churn 告警**：dsh 开发者预览期"预期兼容性破坏变化"（官方口径），社区生态已有每日兼容性矩阵追踪 patch 应用/编译成功（allclaw + dsh-plugin-shop discussion 佐证）。`import type { Context } from '@deepseek-ai/cordis'` 的声明合并让 rc 升级时 `tsc` 直接报错——这是免费且正确位置的告警，比运行时才炸好得多。
2. **"配置其他插件 config 行"的先例**：官方文档明确说 *"a patch replaces a row's entire config value… your patch can override rows from earlier layers by id — the same way the dsh-web-app bundle overrides dsh-base rows"*。bundle 之间通过 patch 行互相配置是**官方设计内的常规操作**，不是 hack。nvim/Plate 等生态的 "preset/pack installs and configures other plugins" 模式（GridPresetPlugin、pack-config.nvim）也是同构先例。

### 修正一：one-step install 可做，但要防御 row 替换语义

patch 按 id 整行替换（非深合并）意味着：如果我们的 bundle patch 声明了 mcp-client 行（serverName anysearch），**用户在自己 profile 的 `cordis.patch.yml` 里对同一 id 的定制会覆盖我们的**（profile 层在 bundle 层之后，later wins）——这其实是正确方向（用户优先）。但反过来，如果 dsh-base 未来自己带了一个 mcp-client 默认行，我们的整行替换必须**复述该行所需的每一个 key**（官方明示的坑）。建议：
- one-step install 保留（一个 `dsh plugin add` 交付 tools+hooks，安装面最小化，这是 A 的核心卖点）；
- patch 里 mcp-client 行完整复述所需 keys，并在文档写明用户如何在自己的 patch 层覆盖它；
- **修正**：不要依赖"我们的行永远生效"——文档要写清楚"如果 dsh 未来内置了 mcp-client 行，升级时 diff 一次 `--dump-config`"。这比 two-step docs 省事得多，但不是零维护。

### 修正二：private:true + 本地路径安装本轮足够，但补两项验证

官方 publish.md 直接支持这个路线：*"Publishing to a registry is not required — users can install straight from a git host"*，且 `dsh plugin add ./hello-plugin`（本地路径）是文档一等公民。本轮 private + 本地绝对路径安装验证**完全够格**，前提是把验证清单对齐发布时形态：
1. 用 `pnpm pack` 产物（tarball）安装一次，而不是只 link 源码目录——这能抓到 `files` 字段漏了 `cordis.patch.yml` 或编译产物的问题（git 安装需要 prepare 脚本 + allowBuilds 的坑，官方文档专门写了一节；tarball/npm 安装零权限，正是我们想要的形态）；
2. `dsh --profile demo --dump-config` 验证 `"# == @anysearch-cli/dsh-plugin"` 层出现且 mcp-client 行就位；
3. package.json 预发布检查（name/`dsh.bundle`/`files`/`type:module`）跑一次 lint——这样下轮 publish 是改一个字段而不是一次考古。

## 其他选项快速裁决

- **C（塞进 mcp 包）**：bundle 是 hooks 层（agent 生命周期 + IPC 客户端），MCP 包是 stdio server。把分发单元放进错误的内聚边界，将来 hooks 层要支持别的宿主（Claude/Codex adapter 已有先例）时会被拖累。否。
- **D（无包 + 手工行）**：放弃了 bundle 的核心价值——`dsh plugin remove` 能同时清依赖和层（官方文档确认），手工行做不到幂等装卸；且 patch 行的 `name:` 必须可被 Node 从 profile 目录 resolve（官方明示相对路径会失败的坑），裸文档方案要求用户手工维护绝对路径，恰是生态公认的头号坑。仅保留为"无法用 pnpm 的环境"的 fallback 附录，不作为主交付面。

**最终形状**：A + one-step install（防御性 patch）+ private:true 本轮 + tarball 形态验证。下轮发布时它天然是 dsh-plugin-shop 目录的合格候选（npm 关键字 `dsh-plugin` 即被收录，无需人工审批）。

## 调研过程注

调研配额自查：searches: 6（anysearch ×2、tavily ×2、web_search ×1、角度覆盖 Official/Comparative/Criticism/Community/Currency）| full reads: 3（allclaw.org dsh-plugin 详解、dsh-plugin.org/tutorials 索引、官方 docs/user/develop/basic/publish.md 全文）| 独立信源 4+ 域名 | gaps: dsh-plugin.org 具体教程页 URL 404（仅索引页可读）；dsh 0.1.5-rc.2 与 rc.6 文档间的 CLI 细节可能漂移；publish.md 未直接回答"bundle 能否替别的包声明 config 行"（但 patch 机制本身 by id insert/override 已被官方文档确认）。
