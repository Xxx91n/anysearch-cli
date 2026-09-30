# ADR-0094: Grill Round 93 — L3 修复续轮【换模三跑】（Kimi-K2-Instruct-0905 冻结臂 + B1 单链 + 签名族三形态 + 判词门控转向票 + r88 sunset 硬截止 + 权限缺口分型 + 证据效力两态）

## Status

Accepted (grill round r93; 主轴票 dsh-l3-smoke-kimi-rerun). Records T0–T7 per task book `.scratch/grill-round-93/handoffs/next-round.md`. Ledger: `.scratch/grill-round-93/decision-ledger.md` (D-001~D-003, all `current`). Evidence root: `.scratch/grill-round-93/evidence/`.

## Context

dsh L3 冒烟验收线连续两轮 F-bug：

- **R91**（ADR-0092）：根因 = 宿主环境 `DEEPSEEK_API_KEY` 缺位 → 环境面，非机制故障。
- **R92**（ADR-0093）：宿主升到 `0.1.7-rc.2`、featherless 路由注入、凭证提升全部到位后，判词仍为 F-bug —— 上游 `Qwen/Qwen3-32B` 为 reasoning 形态，`reasoning` 与 `content` 共享 `max_tokens` 预算，预算被 reasoning 吃满即产出「`finish_reason=length` + 空 content + 零 tool_calls」。

两轮均未触及本仓机制面（`ans_*` 原生工具注册 + hooks 层），均属上游模型能力面。本轮（D-001）主轴 = **换模三跑**：把冻结模型从 `Qwen/Qwen3-32B` 换成 grill 期已裸探针实证具备真实 tool-call 能力的 `moonshotai/Kimi-K2-Instruct-0905`，复跑 T2 三跑。

R92 遗留三轮悬空的骑手（rider）连锁：判词达标才解锁 README 双语行对齐（live-verified 图章）、`readme-token-pin` 机器腿首跑、deprecate 再尝试。D-001 ④ 明确 **rider 链条件化**——A 不绿则三者全顺延，不硬凑收口。

T0 已完成哨戒与五件探针（but-id `trm`），关键事实：

- `@deepseek-ai/dsh` dist-tags = `{alpha: 0.1.7-alpha.2, latest: 0.2.0-rc.2, next: 0.2.0-rc.2}`，**无 `stable`** → **TC 不启、不留痕**，判定窗口本轮一次定死。宿主维持 `0.1.7-rc.2` 不升不降。
- 探针 1：`Kimi-K2-Instruct-0905` 裸探针 `200 + finish_reason=tool_calls + ans_search_web 载荷` → 主臂准入成立。
- 探针 2：`max_tokens=8` 即触发 `length` → **max-tokens 预算下限判据的钉死证据**（见 D1）。
- 探针 3：`Kimi-K2-Instruct`（非 0905）亦 `200 + tool_calls` → B1 第二臂换臂前 preflight 义务已履行。
- 探针 4：`Qwen/Qwen3-32B` R92 签名复现（`reasoning` 串 `!!!!!` 起始 + body 于 3129 字节 JSON 截断）→ 确认非瞬态。
- 探针 5：托管目录对**两个** Kimi 臂均返 `context_length: 32768` + `tool_use: true` → `contextWindow=32768` 冻结成立；调和 R92 已同向调和过的「`/v1/models` 404 Gone」过期记述（本轮为第二次独立复现 200 OK）。

## Decision

### D1（=D-002）T2 三跑执行设计全包

#### D1.1 隔离 profile 与注入面

新建隔离 profile `r93-kimi`（`~/.dsh/profiles/r93-kimi/`，机外路径）。 <!-- machine-local: 用户级 dsh home 机外路径 @ 2026-09-30 -->**不复用 `r92-smoke`**——其 `cordis.patch.yml` 两处硬编 `Qwen/Qwen3-32B`（探针 6 只读勘查确认，行 11/16）且属 R92 证据工件，冻结零触碰；证据链须独立可归因。

注入面 = dsh-llm-pi-ai dormant 路由激活（承 ADR-0093 D1）：

<!-- machine-local: 用户级 dsh home 机外路径 @ 2026-09-30 -->
```yaml
# ~/.dsh/profiles/r93-kimi/cordis.patch.yml（跑前冻结，跑中不换）
llm-pi-ai:
  providers:
    featherless:
      apiKeyEnv: DEEPSEEK_API_KEY
      api: openai-completions
      baseURL: https://api.featherless.ai/v1
      models:
        - id: moonshotai/Kimi-K2-Instruct-0905
          contextWindow: 32768
  agent-default-model:
    provider: featherless
    model: 'moonshotai/Kimi-K2-Instruct-0905'
```

#### D1.2 门判据三腿（承 ADR-0092 D1 / ADR-0093 D1，判据机制冻结不换）

- **L3a 装册绿**：`dsh plugin --profile r93-kimi add <tgz>` 成功 + `dsh --profile r93-kimi --dump-config` 可见 bundle 单行（含 `anysearch-cli/dsh-plugin`）**且**可见 `providers.featherless` 与 `agent-default-model` 覆写。dump-config 无 featherless 痕迹 → 直落 F-bug（`not-established: [L3a]`），禁现场发明分支。
- **L3b 枚举绿**：stream-json transcript 的 `model-request tools` 载荷含五个 `ans_*` 裸名（`ans_search_web` / `ans_recall_memory` / `ans_query_knowledge` / `ans_research_web` / `ans_chat`）+ `inputSchema`。若通道未显性暴露但 transcript 出现 ≥1 `ans_*` tool_call 事件 → `established-via-fallback: [L3b]`。
- **L3c-min 执行绿（本轮收窄）**：≥1 个 **`ans_*`** 工具真实调起并完成 `POST http://127.0.0.1:3001/mcp` 往返，response `content` 存在 OR `isError: true` 均算。

**L3c-min 判词收窄条款（D-002 新增入册）**：绿判词只认 **`ans_*` tool_call**。
理由：`Kimi-K2-Instruct-0905` 存在约 24% 未声明工具幻觉率——模型会对未在 `tools` 数组中声明的函数发起 `tool_call`。
故「任意 `tool_call`」不等于「本仓工具被正确枚举并调用」。幻觉调用（函数名不在五 `ans_*` 之列）**不计绿**。
判词字段写 `ans_* 载荷`，**不写** `任意 tool_call`。

**非判据标注（防误读为门槛）**：L3d 顺验 fail-open 同台架顺验为 evidence-only，不入门；L3e 免测（引用 R72 wire 证据档，不复验）。

#### D1.3 诱导句与 N 预算

诱导句（复用 R91/R92 冻结句，跑前定死跑中不得改题迁就模型）：

> 请帮我搜索一下 deepseek dsh plugin 的最新功能

N ≤ 3 次独立 headless turns，**严格串行**（D-001 ③：feather_pro_plus 上限 4 units，Kimi-K2 实测 4 units/req）。
两臂全灭后允许追加**未冻结适配句**作诊断探针（evidence 非 verdict，**不计入 N**、不参与判词）。

#### D1.4 max-tokens 预算判据（跑前钉死，跑中不换）

**诱导轮 `max_tokens` 下限 = 2048。**

判据来源 = T0 探针 2：`max_tokens: 8` 即触发 `finish_reason=length`、content 截断在「Pong! 🏓\n\nThe」——证明 `length` 形态在极小预算下必然复现，**与模型能力无关**。
故 R92 签名族的「length 计 N」条款必须携带预算下限：诱导轮预算 < 2048 时观测到的 `length` 判为**环境违规，不计 N**。

（充足性佐证：探针 1 在 `max_tokens=2048` 下仅用 40 completion_tokens 即达 `tool_calls`，余量充足。）

#### D1.5 签名族三形态（承 D-002 g）

上游模型层失败的归因谓词集合（**闭集**，三形态之外禁现场发明新签名）：

1. `finish_reason=length` + 空 `content`（reasoning 形态吞预算）——计 N 前须过 D1.4 预算门。
2. `finish_reason=stop` + 纯文本续写（模型以散文代替工具调用）。
3. 零 `tool_calls`（无任何工具调用产出）。

补充形态（承 D-001 ①，计入同一签名族）：`server_error` / `no_response`。

#### D1.6 B1 预注册单链与链级硬顶

**B1 链**：`[moonshotai/Kimi-K2-Instruct-0905 → moonshotai/Kimi-K2-Instruct]`

- 每臂**独立 N=3** 诱导预算；两臂共享**「全灭 → F-bug + B 议程」链级硬顶**。
- 单臂失败换臂是标准 failover；**链耗尽才是判词事件**。防「无限换臂稀释 kill criteria」与「单点故障当 kill criteria」两种极端。
- 反对 B2（两臂混归因）：模型层失败 ≠ 机制失败，不得跨臂合并 N 预算。

**换臂三义务**：

1. 换臂**前** preflight 验目标臂 tool_calls（T0 探针 3 已履行：`Kimi-K2-Instruct` 亦 200 + tool_calls）。
2. 换臂事实写入 transcript（which model + why），**禁静默降级**——用第二臂的成功冒充 primary 的判词即违规。
3. ≥2 次换臂**即使终绿也触发 F-bug 复盘闸**（fallback 激活率审计）。

#### D1.7 凭证卫生

`DEEPSEEK_API_KEY` 由 User-scope 读取后**仅经子进程 env 注入**；配置只引用变量名（`apiKeyEnv`）。
明文不落盘、不落上下文、不入 transcript；仅记 `len=67` 与 SHA-256 前缀 `64a88ea6`。
收尾泄漏探针 = 全证据树 SHA-256 前缀 grep + 原始 key 精确匹配双探针。

### D2（=D-003）T-B 判词门控转向票（双态记账）

**触发谓词（唯一定义）**：`t2-verdict.json` 的 `verdict` 字段**显式等于** `F-bug`（链尽判词成立）。

**明确排除**：`T2 未绿`、`T2 未跑完`、429、环境违规、preflight 失败、机制不可用分支 —— **一律不触发 T-B**。
环境违规的正确处置是重跑（不计 N），不是转向。

**内容白名单（触发后仅允许两项）**：

1. F-bug 登记（registry `deferred-registry.json` 加条目 + defer 理由）。
2. 开庭议程（r88-candidate 垂域死刑复核）——**引本 ADR 预注册条款，禁现场拟议程**。

**禁项**：任何实施工作、任何顺手重构、任何超出白名单的登记（failure-handler 变垃圾桶）。

**T-B / T3 / T4 三条件票互斥求值谓词（显式声明）**：

| 票 | 触发谓词 | 与其他票关系 |
|---|---|---|
| T-B | `verdict == F-bug`（链尽） | 转向轨 |
| T3 | 判词 ∈ {`established`, `established-via-fallback`} 档 **且 T-B 未启** | 成功轨 |
| T4 | T3 已改 README（真标的）→ 真跑取证；T3 未启（README 未改）→ shadow-run + 挂账 R94 | 桥接轨，**两态产出，票永不空** |

三票同源于 T2 判词，故**互斥求值**：T-B 成立 ⟹ T3 条件假（判词未达档）；T3 成立 ⟹ T-B 条件假。
T4 在两态下均有产出，故不受 T3/T-B 互斥影响。

**条件票纯度（承 ADR-0092）**：条件票**不带立法、不现场拟措辞**。措辞一律引本 ADR 预注册件誊抄。

### D3（=D-001/D-003）README 双语措辞承继与四列表格形态调和

措辞**承继 ADR-0093 D2 双版预注册**（禁现场拟）。本 ADR 只做**形态调和**——
ADR-0093 的预注册行是三列（`| DeepSeek Harness | 0.1.7-rc.2 | native registration (established) |`），
而 `README.md:227` / `README.zh-CN.md:217` 现存行是**四列**（host / version / mechanism / status + doc link）。

**调和规则（形态适配，语义零改动）**：把 ADR-0093 预注册的状态措辞嵌入四列表格的第 4 列（status），
机制列按 R90 后的实际形态填 `native registration (ctx.tools)`，doc 链接列保留。
即：**状态措辞一字不差承继，四列形态对齐现表**。

**版本 A（established 档，T3 触发时誊抄）**：

- `README.md:227` → 状态列含 `live-verified (established)`；版本列 `0.1.7-rc.2`。
- `README.zh-CN.md:217` → 状态列含 `实机验证（established）`。

**版本 B（established-via-fallback 档，T3 触发时誊抄）**：

- `README.md:227` → 状态列含 `live-verified (established-via-fallback: [L3b]) <!-- enumeration side-verified via tool_call -->`。
- `README.zh-CN.md:217` → 状态列含 `实机验证（established-via-fallback: [L3b]） <!-- 枚举经 tool_call 侧证 -->`。

**四列表格形态约束**：两版 README 的第 2 列（version token）必须与实测宿主版本一致，否则 `readme-token-pin` 机器腿（T4）判 MISMATCH。

### D4（=D-001）r88-candidate sunset 硬截止

`r88-candidate-vertical-direction-redeliberation`（registry status `open`，owner `anysearch-eval`）写入 **sunset 条款**：

- **硬截止**：**R95 之前必须开庭**，无论 T2 判词状态（A 绿 / B 降格 / C F-bug 皆触发）。
- **R94 预通知义务**：R94 收口批须在 registry `carried_log` 追加预通知条目 + 点名 owner `anysearch-eval`，不得静默到期。
- **开庭 ≠ 翻案**：`reaffirm` / `revise` / `retire` 三果皆为合法判词；「维持 defer」不再是无期限默认态。
- **反例立档**：rolling 复审的橡皮图章化（存续率 ~100%）是本条款针对的失效模式。

本轮为**条款写入**（立法规），开庭主体在 R94/R95 —— 故本轮**显式范围外**（承 D-001 范围外条款之例外：sunset 条款写入 + T-B 触发的开庭议程）。

### D5（=D-002/D-003）deprecate 权限缺口三型枚举

外发动作受阻时的记账字段枚举（每型含 fallback 行为字段）：

| 缺口类型 | 判定信号 | fallback 行为（默认） |
|---|---|---|
| `credential-scope` | `npm whoami` → 401（无有效 token） | 纯备准核销 + 6 版本枚举填值，EOTP 呈报待用户亲触自执 |
| `maintainer` | 已认证但对该包无 write 权限（403/E404 on PUT） | 同上，并额外登记「需 maintainer 代执行」 |
| `org-owner` | 包已转让/归属变更，当前身份非 org owner | 暂停外发，**先定位新 owner 再执行**；不借他人凭证绕闸 |

**禁项**：为跑通而借他人凭证绕权限闸；记账只写 `E401/E404` 不分型。

**双态措辞预注册（承 R92 T5）**：

- 达成态：`T5 deprecate 尝试：6 版本枚举文案已修正为单空格`
- 未达成态（按实际缺口型填充）：`T5 deprecate 执行尝试：命中 npm 权限屏障 (<缺口类型>) 挂账待用户亲触自执`

### D6（=D-003）证据效力口径（d7 保守默认）

**本机门禁证据 = advisory，非 blocking。**

缺席裁定的保守默认：CI-only 强制令若在裁定前被当作 blocking 执行，属越权阻断。
本轮及后续：本机 `check` / `test` / `ship-gate` 产出进证据档并如实记档，但**不作为发布阻断**。

**显式登记下轮复核**：该口径为 d7 缺席下的保守默认，R94 须复核「本机门禁是否应升级为 blocking」并给出裁定。
规则制定**不混入收口票**。

### D7（=D-003）票序与 commit 结构

| 票 | 内容 | 覆盖 | commit 类型 |
|---|---|---|---|
| T0 | 哨戒（dist-tags 定死 TC）+ check/test/ship-gate 基线 + 五件探针归档 | D-001/D-003 | chore+evidence |
| T1 | 本 ADR 立法 + index 更态 | D-001/D-002/D-003 | docs |
| T2 | 串行 preflight → 建 `r93-kimi` → plugin add 冷启（L3a）→ dump-config → 诱导 turns → transcript/verdict 双工件 → 泄漏探针 → 判词 | D-001/D-002 | evidence |
| T-B【条件】 | 链尽判词显式成立 → F-bug 登记 + 开庭议程 | D-001/D-003 | docs |
| T3【条件】 | README 双语行对齐（达档且 T-B 未启，誊抄 D3 措辞） | D-001/D-003 | docs |
| T4【条件】 | readme-token-pin 机器腿（README 改→真跑 / 未改→shadow+挂账 R94） | D-001/D-003 | evidence |
| T5 | deprecate（权限到位执行 / 未到位纯备准 + 三型枚举填值） | D-001/D-002 | chore |
| T6 | 收口批（6 分节，节节独立可 revert） | D-001/D-003 | docs |
| T7 | 门禁 + 审计 LOOP（≤2） | D-001/D-003 | — |
| TC | T0 目击 `0.2.0` stable → closing probe | D-001 | — |

**跨票硬约束**：一票一 commit 类型不混；票级熔断 2-LOOP；T1 立法先于 T2 行为；条件票不带立法；pathlint 冻结；无 tag/push/publish；判词词汇从 `t2-verdict.json` 一字不差取。

### D8（=D-002）Known-Non-Goals 新增入册

**多轮 `tool_call` ID 污染**：Kimi 依赖历史 ID 格式 `functions.<func_name>:<idx>`（探针 1 实测 id = `functions.ans_search_web:0`）。
多轮同会话内若索引复用，Kimi 侧可能回指历史 tool_call ID，致合法调用被丢弃。
本轮三跑为单轮独立 headless turn（N≤3 各自独立），风险低 —— **显式入 Known-Non-Goals，本轮不测不修**。

**上游签名之外的新签名**：三形态闭集之外的新失败形态**禁现场发明**；
若观测到闭集外形态，记为 evidence 并停下升级为本 ADR 的轮内 amend（不擅自扩集）。

## Consequences

- T2 判词以本 ADR 为唯一法律依据；诱导句、模型 ID、`contextWindow`、max-tokens 下限跑中不漂移。
- B1 单链 + 链级硬顶使 kill criteria 既不被无限换臂稀释、也不被单点故障误触发。
- T-B 内容白名单保证熔断转向票不沦为垃圾桶；条件票互斥谓词使「未绿」不误启转向。
- README 状态措辞承继 ADR-0093 预注册件，形态调和到四列表格，条件票无现场拟写空间。
- r88-candidate 获得硬截止与 owner 点名，结束无期限 rolling 候审。
- 权限缺口分型让下轮接手者知道缺哪一层，而非笼统「权限闸」。
- 证据效力 advisory 口径避免本机门禁越权阻断发布，代价是本机绿灯不等于 CI 绿灯——该权衡显式登记待 R94 复核。

## 范围外

- repin（`0.2.0-rc.2` 仅哨戒记档，版本轴与消费轴正交）。
- 垂域死刑复核**主体**（例外 = D4 sunset 条款写入 + T-B 触发的开庭议程）。
- `defer-r72-dsh-web-interactive-matrix` 主体（维持 defer）。
- 评测面（`defer-f17` 等）。
- 常驻债清理（5 项）。
- approval-channel。
- tag / push / publish。
- pathlint 解冻。

## 票序节（逐票 but-id 双锚）

> 文内 sha 一律为**落笔时值**；but-id 为唯一稳定锚；land 后以 main `git log` 为准。
> 「落笔时值」口径：sha 在每次 amend 后即失效，故本 ADR 不写 sha 作为可核锚点，只写 but-id。

| 票 | but-id | 类型 | 判定/结果 | 实证索引 |
|---|---|---|---|---|
| T0 哨戒+基线+探针 | `trm` | chore+evidence | ✅ 完成 | `evidence/t0/t0-baseline.md` + `t0-probes.md` + `check.log`/`test.log`/`ship-gate-quick.log` |
| T1 ADR 立法 | `xrw` | docs | ✅ 完成 | `docs/adr/0094-*`（D1–D8 完成体） |
| T1 ADR index 更态 | `qom` | docs | ✅ 完成 | `docs/adr/index.md` 0094 行（`gen-adr-index --write`，94 ADRs at HEAD，`--check` 绿） |
| T2 三跑执行 | `pzv` | evidence | ✅ **established-via-fallback**（branch_label=A） | `evidence/t2/t2-verdict.json` + `t2-transcript.md` + `t2-transcript.jsonl` + `turn1..3.jsonl` + `dump-config.log` + `mcp-direct-toolcall.log` |
| T-B 转向票 | — | docs | ⏭ **未启**（谓词 `verdict == "F-bug"` 为假） | 判词为 `established-via-fallback`；内容白名单与开庭议程均未触碰 |
| T3 README 双语行对齐 | `qpu` | docs | ✅ 完成 | `README.md:227` + `README.zh-CN.md:217`（措辞版本 B 誊抄） |
| T4 机器腿首跑 | `zln`+`sss`+`syr` | evidence | ✅ 完成（12/12 green） | `closeout-claims.json` 登记与 token 校正 + `evidence/t4/t4-machine-leg.md` + `ship-gate-machine-leg.log` |
| T5 deprecate | `rsr` | chore | ℹ️ 纯备准（`credential-scope` 权限缺口） | `evidence/t5-deprecate.md` + `t5-deprecate-probe.json` |
| T6-2 registry 更态 | `zqq` | docs | ✅ 完成 | `docs/deferred-registry.json`（defer-r92 两项核销 + r88 sunset 条款 + r93 deprecate 条目） |
| T6-4 CHANGELOG | `pqu` | docs | ✅ 完成 | `CHANGELOG.md` r93 条目 |
| T6-1 ADR 完成体 | 本 commit | docs | ✅ 完成 | 本节（逐票 but-id 补记） |
| T6 轮报+终态戳 | 待补 | docs | 待补 | 待补 |
| T7 门禁+审计 | — | — | 待补 | 待补 |
| TC 条件票 | — | — | ⏭ **未触发** | T0 目击无 `0.2.0` stable（`latest` = `next` = `0.2.0-rc.2`），窗口一次定死 |

### 执行期票序调整（如实记账）

**T6④ CHANGELOG 条目前置于 T4 机器腿。**
原因：`scripts/ship-gate.mjs:776` 的 CHANGELOG 检查 `fail()` 即退，
而 `closeout-claims` 腿在 780 行之后 —— 当轮 CHANGELOG 条目缺失时，T4 的机器腿**在门禁内永不可达**。
这不是绕过，是门禁顺序的真实依赖。故 T6④ 提前落笔（but-id `pqu`），T4 机器腿随后可跑。
该依赖已写入 `evidence/t4/t4-machine-leg.md` §2。
