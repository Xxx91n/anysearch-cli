# ADR-0093: Grill Round 92 — featherless T2 复跑冒烟验收 + 售后收口轮（L3 判据复用与 L3b 修订 + 冻结项立法 + 凭证卫生 + 双版措辞预注册）

## Status

Accepted (grill round r92; 主轴票 dsh-l3-smoke-featherless-closeout). Records T0–T7 per task book `.scratch/grill-round-92/handoffs/next-round.md`. Ledger: `.scratch/grill-round-92/decision-ledger.md` (D-001~D-003). Evidence root: `.scratch/grill-round-92/evidence/`.

## Context

R91（ADR-0092）完成 dsh L3 判据立法与冒烟尝试，产出 F-bug 判词（根因为宿主环境 `DEEPSEEK_API_KEY` 缺位，非机制故障），挂账 5 项。
本轮目标：完成售后收口续轮【完整版】（D-001~D-003）：
1. 正题：T2 复跑（自定义上游 `https://api.featherless.ai/v1` + User-scope `DEEPSEEK_API_KEY` 注入）——把 R91 F-bug 补成真实判词。
2. 宿主选型：dsh `0.1.7-rc.2` 不升不降（保持与 R91 同环境连续性及钉版契约，0.2.0-rc.2 哨戒记档，版本轴与消费轴正交）。
3. 机制选型：pi-ai 自定义路由注入 `providers.featherless`，`baseURL: https://api.featherless.ai/v1`，使用 User-scope `DEEPSEEK_API_KEY` 注入子进程。
4. 判词达标启 README verified-hosts 双语行对齐（`README.md:227` / `README.zh-CN.md:217`，现状为 0.1.5-rc.2+MCP bridge 旧表述）。
5. readme-token 检查器无条件接线 `scripts/ship-gate.mjs`（ADR-0092 D4 第二拍）并做 shadow dry-run。
6. deprecate 双空格执行尝试（外发，EOTP 呈报）。

## Decision

### D1（=D-002）T2 判据全包与冻结项立法

**门判据三腿（复用 ADR-0092 D1 并修订）**:

- **L3a 装册绿**（确定性）:
  `dsh plugin --profile r92-smoke add <tgz>` 成功 + `dsh --profile r92-smoke --dump-config` 输出在 plugins 列表中可见 bundle 层单行（含 `anysearch-cli/dsh-plugin` 标识符），且可见 patch 层注入的 `providers.featherless` 与 `agent-default-model` 覆写。
  *机制不可用预注册*：若 dump-config 无 featherless 痕迹，直落 F-bug 分支（`not-established: [L3a]`），避免现场发明分支。

- **L3b 枚举绿（经修订，标 ADR-0092 D1 revised-in-part）**:
  - 主判据：headless turn 产出的 stream-json transcript 中，model-request tools 载荷含五个 `ans_*` 裸名（`ans_search_web`/`ans_recall_memory`/`ans_query_knowledge`/`ans_research_web`/`ans_chat`）+ `inputSchema` 字段。
  - Fallback 判据：若载荷在 stream-json 中因宿主通道未显性暴露，但 transcript 中出现 ≥1 个 `ans_*` tool_call 事件（实名+arguments），记为 `established-via-fallback`。
  - *Entry-criterion 探针义务*：T2 票内前置 preflight tool_calls 探针（裸 chat/completions + tools 数组验证模型具备真实 tool-call 能力）。探针失败直接落 F-bug 分支。

- **L3c-min 执行绿**:
  ≥1 个 `ans_*` 工具真实调起并完成 ans-mcp /mcp 往返（POST `http://127.0.0.1:3001/mcp`），response content 存在 OR `isError: true` 均算（连通性验证）。
  诱导任务措辞：**「请帮我搜索一下 deepseek dsh plugin 的最新功能」**（跑前定死，跑中不得改题迁就模型）。
  重试上限：N≤3 次独立 headless turns。

**模型与环境冻结项**:
- 模型 ID：`Qwen/Qwen3-32B`（featherless 官方点名原生支持 tool-calling 家族）。
- 上下文窗口：`contextWindow: 32768`（按官方目录 /v1/models 声明字段）。
- 上游路由：`https://api.featherless.ai/v1`，协议 `openai-completions`。
- `DEEPSEEK_BASE_URL` rejected 条款：featherless 官方仅暴露 OpenAI 面，无 Anthropic Messages 面；env 覆写存在翻译层断点与全局污染副作用，显式记录为 Rejected，不作为备选方案。

**凭证卫生条款**:
- apiKeyEnv 名引用解析：配置仅引用环境变量名 `DEEPSEEK_API_KEY`，值由运行时子进程注入。
- 零明文纪律：密钥明文绝不落盘、不落上下文、不入 transcript。
- 泄漏探针：T2 运行收尾执行泄漏探针，全文检索 transcript 是否存在密钥的 SHA-256 前缀（`64a88ea6`）。

### D2（=D-002）L3b 词汇增补与 README 双版措辞预注册

**词汇表正式增补（供 T6 机检 claims 与 t2-verdict.json 一字不差复用）**:
```
established: [L3a, L3b, L3c-min, L3c-full, L3d, L3e]
not-established: [L3a, L3b, L3c-min, L3c-full, L3d, L3e]
established-via-fallback: [L3b]
```

**判词三分支**:
- **分支 A（全绿）**：L3a + L3b + L3c-min 全部通过 → README 改行解锁；status 措辞 `established`。
- **分支 B（降格）**：L3a + L3b(或 established-via-fallback) 通过，L3c-min 未达 → README 改行解锁（携降格措辞）；status 措辞 `established-via-fallback: [L3b]; not-established: [L3c-min]`。
- **分支 C（F-bug）**：L3a 或 L3b 败 → README 改行锁定；开 F-bug 修复票；如实呈报。

**README 双版预注册措辞（供 T3 条件票严格誊抄，禁止现场拟措辞）**:

1. **版本 A（全绿 established 版，分支 A 触发）**:
   - `README.md:227`:
     `| DeepSeek Harness | 0.1.7-rc.2 | native registration (established) |`
   - `README.zh-CN.md:217`:
     `| DeepSeek Harness | 0.1.7-rc.2 | 原生注册 (established) |`

2. **版本 B（降格 established-via-fallback 版，分支 B 或 fallback 路径触发）**:
   - `README.md:227`:
     `| DeepSeek Harness | 0.1.7-rc.2 | native registration (established-via-fallback: [L3b]) <!-- enumeration side-verified via tool_call --> |`
   - `README.zh-CN.md:217`:
     `| DeepSeek Harness | 0.1.7-rc.2 | 原生注册 (established-via-fallback: [L3b]) <!-- 枚举经 tool_call 侧证 --> |`

### D3（=D-003）票序 + commit 结构（A″）

| 票 | 描述 | 覆盖 D-xxx | commit 类型 |
|----|------|-----------|------------|
| T0 | 哨戒+基线快照+五件探针归档 | D-001/D-003 | chore+evidence |
| T1 | ADR-0093 立法 + index 更新 | D-002/D-003 | docs |
| T2 | T2 复跑执行（preflight+r92-smoke+turns+verdict+泄漏探针） | D-002/D-003 | chore+evidence |
| T3【条件票】 | README 双语行对齐（仅判词达标启用，按预注册誊抄） | D-001/D-003 | docs |
| T4 | readme-token 检查器接线 + shadow dry-run（无条件票） | D-001/D-003 | fix |
| T5 | deprecate 双空格执行尝试（外发，EOTP 记账） | D-001 | chore |
| T6 | 收口件批（ADR 完成体+CONTEXT+claims+轮报+终态戳+CHANGELOG） | D-001~D-003 | docs |
| T7 | 门禁+审计 LOOP（check/test/ship-gate 全闭环） | D-003 | — |
| TC | 0.2.0 stable 目击（T0 一次定死未目击，不启不留痕） | D-001 | — |

**硬约束**:
- 一票一 commit，类型不混。
- 票级熔断 2-LOOP：若机制不可用（dump-config 无 provider）或 preflight 探针失败，直落 F-bug 分支并熔断转修复票。
- TC 窗口由 T0 一次定死，不再复观。

### D4（=D-001/D-003）readme-token 检查器无条件接线与 shadow 纪律

- ADR-0092 D4 确立的 `readme-token-pin` claim kind，在本轮 T4 于 `scripts/ship-gate.mjs` 中正式接入断言检查器（两拍节奏第二拍）。
- 票内 shadow dry-run 执行：检查器输出归入 evidence 档，显式标注 `shadow` 性质，不阻塞流程、不入正式判词。
- 检查器首跑专属机器腿显性挂账至 R93。

## Consequences

- T2 复跑判据以本 ADR 为唯一法律依据，诱导句文案与模型 ID 跑中不漂移。
- 引入 `established-via-fallback`，解耦枚举机制与宿主日志通道格式差异。
- T3 严格按预注册文案誊抄，杜绝条件票现场拟写措辞。
- 凭证纪律与泄漏探针闭环防范敏感信息外泄。

## 范围外

- repin（0.2.0-rc.2 仅哨戒记档，不消费升级判词）。
- 垂域死刑复核（r88-candidate，明文排期下轮主轴候选）。
- defer-r72-dsh-web-interactive-matrix 主体。
- 评测面 defer-f17 与五项常驻债。
- tag/push/publish/分支清理。

## 票序节（逐票 sha+but-id 双锚）

| 票 | commit (sha + but-id) | 类型 | 判定/结果 | 实证索引 |
|---|---|---|---|---|
| T0 哨戒+基线+探针 | f2be8015 (wst) | chore | ✅ 完成 | `.scratch/grill-round-92/evidence/t0-baseline.md` + `t0-probes.md` |
| T1 判据立法 | 待填 | docs | 待填 | `docs/adr/0093-*` + `docs/adr/index.md` 0093 行 |
| T2 复跑执行 | 待填 | chore | 待填 | `.scratch/grill-round-92/evidence/t2-l3-smoke.md` + `t2-verdict.json` |
| T3 README 对齐 | 待填 | docs | 待填 | `README.md` + `README.zh-CN.md` |
| T4 readme-token 接线 | 待填 | fix | 待填 | `scripts/ship-gate.mjs` + evidence |
| T5 deprecate 尝试 | 待填 | chore | 待填 | `.scratch/grill-round-92/evidence/t5-deprecate.md` |
| T6 收口件批 | 待填 | docs | 待填 | CONTEXT + registry + claims + 轮报 + CHANGELOG |
| T7 门禁+审计 | — | — | 待填 | check + test + ship-gate 全绿 |
| TC 条件票 | — | — | ⏭ 未触发 | T0 目击无 0.2.0 stable 晋升 |
