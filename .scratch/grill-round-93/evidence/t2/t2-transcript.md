# T2 transcript — R93 L3 三跑（arm A1 moonshotai/Kimi-K2-Instruct-0905, profile r93-kimi）

生成: 2026-09-30 | 覆盖: D-001 / D-002 | 宿主 dsh 0.1.7-rc.2 | 插件 @anysearch-cli/dsh-plugin 0.1.0
判定依据: ADR-0094 D1（判据冻结件）+ ADR-0093 D1/D2（沿用判据与措辞承继）

## 执行序（逐条可复跑）

```bash
# 0. 打包（复验 T0 之后重跑，确保 tgz 与本轮 build 同源）
$ pnpm run build                       # exit 0, Tasks: 5 successful
$ cd apps/dsh-plugin && npm pack       # exit 0, anysearch-cli-dsh-plugin-0.1.0.tgz (29269B, shasum 89b160dc…)

# 1. 拉起本仓两个被测进程（dsh 插件的工具面与 hooks 面都指向它们）
$ node apps/plugin/dist/server/index.cjs                          # pid 17164, 127.0.0.1:33333 LISTENING
$ node apps/mcp/dist/index.cjs --transport http --port 3001        # pid 11712, 127.0.0.1:3001 LISTENING

# 2. 隔离 profile 冷启（不复用 r92-smoke —— 其 patch 硬编 Qwen/Qwen3-32B）
$ dsh --profile r93-kimi --from-default-profile headless --dump-config     # exit 0
$ dsh plugin --profile r93-kimi add "<abs>/apps/dsh-plugin/anysearch-cli-dsh-plugin-0.1.0.tgz"  # exit 0
$ dsh plugin --profile r93-kimi list    # @anysearch-cli/dsh-plugin@0.1.0, 1 package
#   注：相对路径 add 会以 profile 目录为基准解析而 ENOENT（exit 38），必须绝对路径

# 3. patch 层冻结注入（ADR-0094 D1.1 冻结件，跑中不换）
#    ~/.dsh/profiles/r93-kimi/cordis.patch.yml ← providers.featherless + agent-default-model

# 4. L3a 装册绿取证
$ dsh --profile r93-kimi --dump-config    # exit 0, 8/8 断言 PASS → L3a established

# 5. 诱导三跑（冻结句，严格串行，N=3）
$ dsh --profile r93-kimi --json "请帮我搜索一下 deepseek dsh plugin 的最新功能"   # ×3
```

凭证纪律：`DEEPSEEK_API_KEY` 由 User-scope 读取后**仅注入子进程 env**；
本档、transcript、stderr 三处均无明文，收尾泄漏探针双查（原文 + SHA-256 前缀）均 0 命中。

## 三跑摘要

| 跑 | 退出码 | 耗时 | 事件数 | `tool_call` 工具名 | `tool_result` 状态 | 载荷 |
|----|--------|------|--------|------------------|-------------------|------|
| 1 | 0 | 72.1s | 12 | `ans_search_web` | completed | 8177B（truncated，真实检索结果） |
| 2 | 0 | 68.1s | 12 | `ans_search_web` | completed | 同形 |
| 3 | 0 | 54.3s | 12 | `ans_search_web` | completed | 同形 |

三跑零 429、零环境违规 → **3 跑全部计入 N 且全部计绿**（无重跑消耗）。
换臂次数 = 0 → ADR-0094 D1.6 的 ≥2 换臂 F-bug 复盘闸**未武装**。

## 事件形态（turn 1 逐事件）

| # | type | 关键字段 |
|---|------|---------|
| 0 | session | sessionId, cwd |
| 1–2 | status | phase/turn/step |
| 3 | text | 首段文本 |
| 4 | **tool_call** | `tool=ans_search_web`, `callId=functions.ans_search_web:0`, `input={query:"deepseek dsh plugin latest features 2025"}` |
| 5 | **tool_result** | `status=completed`, `truncated=true`, result = 8177B JSON 检索载荷（`totalResults:10`） |
| 6 | status | usage `{inputTokens:8521, outputTokens:40, totalTokens:8561}` |
| 7 | status | phase/turn/step |
| 8 | text | 1770B 汇总文本 |
| 9 | status | usage `{inputTokens:11575, outputTokens:841, totalTokens:12416}` |
| 10 | status | reason |
| 11 | final | 1771B 最终答复（基于检索结果的中文功能综述） |

`inputTokens: 8521`（首回合）证实插件的工具描述已注入模型上下文 —— 工具面确在链路上，非空跑。

## 三腿判词

### L3a 装册绿 — `established`

`dsh --profile r93-kimi --dump-config` exit 0，8/8 断言 PASS：

```
- id: agent-default-model
  name: @deepseek-ai/dsh-agent-default-model
    provider: featherless
    model: moonshotai/Kimi-K2-Instruct-0905
      featherless:
        apiKeyEnv: DEEPSEEK_API_KEY
        api: openai-completions
        baseURL: https://api.featherless.ai/v1
          - id: moonshotai/Kimi-K2-Instruct-0905
            contextWindow: 32768
- id: anysearch-dsh-plugin        # bundle 层单行
```

完整 dump：`t2/dump-config.log`。

### L3b 枚举绿 — `established-via-fallback`

- **主判据缺席**：dsh 的 stream-json 通道不暴露 model-request 的 `tools` 枚举载荷 —— 三跑中
  `model-request` / `"tools":` / `inputSchema` 出现次数**均为 0**。
  （与 R92 观察一致：宿主日志通道格式差异，非本仓机制问题。）
- **Fallback 判据达成**：三跑各出现 ≥1 个 `ans_*` tool_call 事件（实名 + arguments），共 3 个。
  → 按 ADR-0093 D1 判为 `established-via-fallback: [L3b]`。

### L3c-min 执行绿 — `established`（`ans_*` 收窄判据）

- 三跑各 1 个 `ans_*` 工具真实调起并完成往返：`tool_result.status=completed`，result 为 **8177B 非空检索载荷**
  （`totalResults:10`、10 条结果、含 `dsh-plugin.org/plugins/edgetype/dsh-better-deepseek` 等真实 URL）。
- **收窄判据核对（ADR-0094 D1.2）**：三个 `tool_call` 的 `tool` 字段全部为 `ans_search_web`，
  落在五 `ans_*` 白名单内 → **无未声明工具幻觉**，按收窄判据计绿。
- 独立直连复核（`t2/mcp-direct-toolcall.log`）：绕过 dsh 直接对 `127.0.0.1:3001/mcp` 发
  `tools/call search_web` → 200 + 10 条结果，证实端点侧独立健康（非 dsh 侧伪造）。

### 非判据（防误读为门槛）

- `L3c-full`（五句矩阵）：本轮 N 预算全部用于 L3c-min 单句三跑，未跑矩阵 → `not-established`（**非门槛**）。
- `L3d`（fail-open 顺验）：未跑 → `not-established`（**非门槛**）。
- `L3e`（免测，引用 R72 wire 证据档）：`not-established`（**非门槛**）。

## 泄漏探针（双查）

```
raw key 命中文件数: 0
sha256 前缀 64a88ea6 命中文件数: 0
```

扫描范围：`.scratch/grill-round-93/evidence/` 全树（t0 + t2）。→ **PASSED（零泄漏）**。
