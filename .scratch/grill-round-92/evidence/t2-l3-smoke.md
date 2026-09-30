# T2 L3 冒烟执行 — Evidence

时间戳: 2026-09-30T09:10+08:00
宿主版本: dsh 0.1.7-rc.2
插件版本: @anysearch-cli/dsh-plugin 0.1.0
隔离配置: r92-smoke
上游配置: https://api.featherless.ai/v1 (model: Qwen/Qwen3-32B, apiKeyEnv: DEEPSEEK_API_KEY)

## 执行流程

### Step 1: 票内前置 Entry-criterion 探针 (preflight tool_calls)
命令: `node .scratch/grill-round-92/preflight.cjs`
目标: 裸 POST /v1/chat/completions + tools 数组验证模型真 tool-calling
结果:
- HTTP 状态码: 200
- 响应内容: Featherless 代理返回了畸形双重 JSON：前半段为生成的大量感叹号（未生成任何 tool_calls），后半段拼接了 `{"error":{"message":"No successful response received from completion service","type":"server_error","code":"no_response","param":null}}`。
- 判定: Preflight tool_calls 探针失败（模型/上游服务层面异常）。按立法条款直落 F-bug 分支备忘。

### Step 2: 隔离 profile r92-smoke 创建与冷启
命令: `dsh --profile r92-smoke --from-default-profile headless --dump-config`
结果: 成功从 headless 模板创建隔离 profile `r92-smoke`。

### Step 3: plugin add tgz
命令: `dsh plugin --profile r92-smoke add apps/dsh-plugin/anysearch-cli-dsh-plugin-0.1.0.tgz`
结果:
- 依赖解析与安装成功，写入 package.json `dsh.profile.bundles`。
- `dsh plugin --profile r92-smoke list` 确认 `@anysearch-cli/dsh-plugin@0.1.0` 已挂载。

### Step 4: patch 层注入与 dump-config (L3a 验证)
配置: `cordis.patch.yml` 中针对 `id: llm-pi-ai` 注入 `providers.featherless`，针对 `id: agent-default-model` 覆写 `provider: featherless, model: Qwen/Qwen3-32B`。
命令: `dsh --profile r92-smoke --dump-config`
结果:
- plugins 列表中可见 bundle 层单行 `- id: anysearch-dsh-plugin, name: '@anysearch-cli/dsh-plugin'`。
- patch 层可见 `providers.featherless` 完整配置，`agent-default-model` 成功指向 `featherless/Qwen/Qwen3-32B`。
- **L3a 判词: established** ✓

### Step 5: 诱导 turns (定死句，N≤3)
诱导任务措辞（跑前定死）: **「请帮我搜索一下 deepseek dsh plugin 的最新功能」**
命令: `dsh --profile r92-smoke --json "请帮我搜索一下 deepseek dsh plugin 的最新功能"`（注入 User-scope `DEEPSEEK_API_KEY`）

**尝试 1**:
- 运行时表现: 进程正常启动并向 Featherless 发送请求，`inputTokens: 10274`（证实 plugin 及其 tool 描述已注入上下文）。
- 上游返回: 上游生成大量感叹号触达 `max-tokens`（4096 tokens），未产出 tool-calling。
- transcript 记录: `.scratch/grill-round-92/evidence/t2-transcript.jsonl`（7 行 stream-json 事件，退出码 0）。

### Step 6: 凭证泄漏探针 (Leak Probe)
命令: 全文检索 `t2-transcript.jsonl` 与 `t2-stderr.log` 中是否含有 User-scope 密钥的 SHA-256 前缀（`64a88ea6`）或密钥明文。
结果:
- Transcript contains hashPrefix? false
- Transcript contains raw key? false
- Stderr contains hashPrefix? false
- Stderr contains raw key? false
- **泄漏探针结论: PASSED (零泄漏)**。

## L3b 判定
- 主判据: stream-json 未直接输出底层 model-request tools 载荷。
- Fallback 判据: transcript 中未出现 `ans_*` tool_call 事件（count = 0）。
- **L3b 判词: not-established**

## L3c-min 判定
- 未发生工具调用往返。
- **L3c-min 判词: not-established**

## 最终判词 (三分支)
- **判词: 分支 C — F-bug (L3a: established, L3b: not-established)**
- **败因诊断**:
  - 本地机制层面（dsh-plugin 注册、patch 路由注入、凭证传递、上下文装载）全部正常（L3a 全绿，inputTokens=10274）。
  - 根因在于外部上游服务提供商 Featherless API 及选定模型 `Qwen/Qwen3-32B` 的 tool_calling 功能存在服务故障（响应畸形，返回 `server_error: no_response` 并生成重复字符耗尽 token）。
- **跨票硬闸约束**:
  - 判词未达降格档（分支 B）或全绿档（分支 A），**T3 条件票不满足启动条件**。
  - **T3 判定: 【未启，不留痕】**，README 保持 0.1.5-rc.2 现状，不现场拟写措辞。
  - 按 D-003 规则，转入 F-bug 记账并继续推进后续无条件票（T4/T5/T6/T7）。
