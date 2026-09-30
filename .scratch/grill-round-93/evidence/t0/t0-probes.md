# T0 五件探针证据归档

时间戳: 2026-09-30 | 覆盖: D-001 / D-003 | 原始输出: `t0/featherless-probes.log`

凭证纪律：DEEPSEEK_API_KEY 由 User-scope 读取后**仅经子进程 env 注入**；明文不落盘、不落上下文、不入 transcript。
仅记 `len=67` 与 SHA-256 前缀 `64a88ea6`（收尾泄漏探针比对用）。

## 探针 1 — `moonshotai/Kimi-K2-Instruct-0905` tool_calls 裸探针（主臂冻结模型）

```
key_len=67 sha_prefix=64a88ea6
P1 status=200
P1 finish_reason=tool_calls tool_calls=1 names=["ans_search_web"] ids=["functions.ans_search_web:0"] content_len=33
P1 usage={"prompt_tokens":59,"completion_tokens":40,"total_tokens":99,"cached_tokens":0}
P1 rate_hdr={}
```

**结论：established。** 200 + `finish_reason=tool_calls` + 正确函数载荷（`ans_search_web`，args 合法）。
复现 R92 决策账本记载的 grill 期裸探针实证，且本轮为独立重跑。

**附带实证（ID 形态，支撑 D-002「ID 污染」入册）**：tool_call `id` 为 `functions.ans_search_web:0`，
即历史 ID 复用 `functions.<name>:<idx>` 格式——多轮同轮内若索引复用，Kimi 侧可能回指历史 ID。
三跑为单轮独立 turn（N≤3 各自独立 headless turn），风险低，入 ADR Known-Non-Goals。

## 探针 2 — units/plan 核查（P2）

```
P2 status=200 hdrs={}
P2 body_head={"id":"56b17f77-...","model":"moonshotai/Kimi-K2-Instruct-0905","choices":[{"index":0,"message":{"role":"assistant","content":"Pong! 🏓\n\nThe"},"finish_reason":"length"}],...}
```

**结论：端点正常无 429 屏障，但响应头零 rate-limit 语义**——`x-ratelimit-*` / `retry-after` / quota / plan 全部缺位。
故 D-001 事实底账的「feather_pro_plus 上限 4 units、Kimi-K2 实测 4 units/req」**无法从响应头自证**，
只能作为串行纪律的经验依据被继承（保守方向一致：串行是更严的一侧）。

**max-tokens 预算判据钉死（D-002 g 项，本探针即为钉死证据）**：
`max_tokens: 8` 即触发 `finish_reason=length`，且 content 截断在「Pong! 🏓\n\nThe」——
证明 **`length` 形态在极小预算下必然复现，与模型能力无关**。故 R92 签名族三形态的「length 计 N」条款必须携带预算下限：
**诱导轮 `max_tokens` 下限 = 2048**（P1 同预算下 40 completion_tokens 即达 tool_calls，余量充足）；
低于此值的 `length` 判为环境违规不计 N。此判据跑前钉死，跑中不换。

## 探针 3 — `moonshotai/Kimi-K2-Instruct`（非 0905）tool_calls 预检（B1 链第二臂）

```
P3 status=200
P3 finish_reason=tool_calls tool_calls=1 names=["ans_search_web"]
```

**结论：established（换臂前 preflight 义务已履行）。** 跨票闸第 4 条「换臂前先 preflight 验 Instruct tool_calls」——
本探针即为该义务的履行证据。第二臂 `Kimi-K2-Instruct` 亦具备真实 tool-call 能力，
故若主臂 0905 链尽需换臂，换臂不构成「盲切」，且**换臂事实必须写入 transcript**（which model + why，禁静默降级）。

## 探针 4 — `Qwen/Qwen3-32B` R92 签名复现（回归确认）

```
P4 status=200
P4 parse_err=Unexpected non-whitespace character after JSON at position 3129 (line 1 column 3130)
P4 raw_head={"id":"d9549d1a-...","model":"Qwen/Qwen3-32B","choices":[{"index":0,"message":{"role":"assistant","reasoning":"!!!!!!!!!!!!!!!!!
```

**结论：R92 F-bug 签名复现，非瞬态。** 200 但 body 在 `reasoning` 字段以 `!!!!!` 串起始并在 3129 字节处 JSON 截断，
`JSON.parse` 失败 → 无法判定 `finish_reason` / `tool_calls`。

**归因（对 D-002 g 的实证支撑）**：Qwen3-32B 是 reasoning 形态，`reasoning` 与 `content` 共享 `max_tokens` 预算；
reasoning 预算吃满即产出「length+空 content+零 tool_calls」。本探针在 `max_tokens=2048` 下仍因 reasoning 串爆掉预算，
印证 R92 记录「45s+ 只产 reasoning 字段」——**该失败属模型能力面，不是本仓机制故障**。

## 探针 5 — 托管目录 context_length 实证（冻结 contextWindow=32768）

```bash
$ curl -s https://api.featherless.ai/v1/models | jq 数据集筛选
catalog total=22078  kimi hits=2
{"id":"moonshotai/Kimi-K2-Instruct","context_length":32768,"tool_use":true}
{"id":"moonshotai/Kimi-K2-Instruct-0905","context_length":32768,"tool_use":true}
```

**结论：32768 冻结成立。** 托管目录对**两个** Kimi 臂均返回 `context_length: 32768` 与 `tool_use: true`，
故 B1 链两臂的 `contextWindow` 同取 32768（runtime > provider > native 解析序，原生 256K 仅 capability 说明，不进 models 段）。

调和注记（覆盖事实底账漂移）：决策账本/next-round 记载「`/v1/models` 枚举端点 404 Gone（厂商侧缺席）」，
本轮 T0 现场实测该端点 **200 OK** 且返回 22078 条目录。R92 已做过同向调和（ADR-0093 D1 contextWindow 条），
本轮为**第二次独立复现**——以现场实测为准，`404 Gone` 属过期记述。

## 探针 6 — `r92-smoke` profile 硬编勘查（冻结零触碰前置校验）

<!-- machine-local: 用户级 dsh home 机外路径 @ 2026-09-30 -->
```bash
$ grep -rn "Qwen/Qwen3-32B" ~/.dsh/profiles/r92-smoke/
.../r92-smoke/cordis.patch.yml:11:          - id: Qwen/Qwen3-32B
.../r92-smoke/cordis.patch.yml:16:    model: Qwen/Qwen3-32B
```

**结论：两处硬编确认**（D-001 ② 属实），`r92-smoke` 作 R92 证据工件**本轮零触碰**（只读勘查）。
profile 目录实测清单：`headless` / `node_modules` / `r92-smoke` / `web`；`r93-kimi` 尚不存在 → T2 需新建。
