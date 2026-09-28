# ADR-0089: Grill Round 88 — 搜索面卫生轮（a06 双层归并 + a03 位置化旗值 + a08 死参清除 + F-6 探针卫生）

## Status

Accepted (grill round r88; 主轴票 search-surface-hygiene). Records T0–T6 per task book `.scratch/grill-round-88/handoffs/next-round.md`. Ledger: `.scratch/grill-round-88/decision-ledger.md` (D-001~D-005). Evidence root: `.scratch/grill-round-88/`（reports/baseline-2026-09-28.md + 轮报）。

## Context

发布收口后的批次化清债：r83 审计挂账三票（a03 flagValueSet 吞词 / a06 垂域组装+require-domain guard 三处近重复 / a08 dead maxResults）+ r86 F-6 探针卫生候选，同落 search/tooling 面，一单 ADR-0029 合规主题。施工纪律：一票一 commit；a03=fix，其余=refactor；refactor 不混 behavior fix。

## Decision

### D1 a06 归并边界——双层归并（运行面 + schema 面）

**运行面**：`buildVerticalSpec({ domain?, subDomain?, params? })` 归 `packages/retriever/src/contract.ts`（与 `canonicalizeVertical` 同址 = VerticalSpec 语义单一权威），返回判别联合：

`{ ok: true; vertical: VerticalSpec | undefined } | { ok: false; reason: VerticalSpecRejectReason }`

三站共享组装 + require-domain 守卫语义：`apps/cli/src/commands/search.ts`、`apps/mcp/src/tools/search-web.tool.ts`、`apps/mcp/src/tools/research-web.tool.ts`。守卫谓词 `verticalSpecReject` 单独导出供 CLI 在旗值 JSON 解码前先取守卫判决（错序保持条款，见 D2④）。

**schema 面**：`packages/kernel/src/tool-schemas.ts` 抽共享 `verticalSpecProps` TypeBox 片段供 SearchWebInput/ResearchWebInput 复用；`additionalProperties:false` 与注释随片段走。

**渲染分工（IpcError 同构）**：结构化 reason 归共享层，人话文案归各 surface——CLI→stderr+exit(2)，MCP→tool error text。共享函数不识调用方（零 caller 分支、零参数分歧）。

### D2 验收判据（预注册——先于施工立法）

① **reason 短码枚举集**（本条立法，施工不自定）：

| reason | 语义 |
|---|---|
| `missing-domain` | subDomain/params 存在而 domain 缺席（**空串或仅空白**视同缺席——空值不携信号，与 params:{}≡absent 同一惯例；各 surface 的更早校验使该分支仅作防御性兜底） |

（R88 审计 addendum：审计呈报 F-a——实现以 `trim()` 把仅空白 domain 亦判 absent，超出本条原立法「空串」字面；审计裁决采纳为防御性加固并据此追认立法，golden 断言增补在案。）

② **各 surface 文案映射表**（错形冻结对象的唯一真理源）：

| surface | 输出（byte-exact） | 通道 |
|---|---|---|
| ans search（CLI） | `ans search: --vertical-sub-domain/--vertical-params require --vertical-domain\n` | stderr + exit 2 |
| search_web（MCP） | `search_web error: verticalSubDomain/verticalParams require verticalDomain` | tool content text |
| research_web（MCP） | `research_web error: verticalSubDomain/verticalParams require verticalDomain` | tool content text |

③ **byte-identical**：三 surface 错误输出形状与归并前逐字节一致，golden 断言（CLI 精确行 / MCP 全字符串相等）为唯一真理源；等价断言已存在者复核豁免（CLI 既有 regex 断言升级为准等价——golden 以精确串断言为准）。

④ **错序保持**：CLI 内 require-domain 守卫先于 --vertical-params JSON 解码发弹（既有次序），`verticalSpecReject` 的 params 入参接受 presence 标记（未解码原值亦可）——双重畸形输入（无 domain + params 非 JSON）的报错优先级不变。

⑤ **类型级验证**：`tsc --noEmit` 级验证 TypeBox Static 推断与具名别名一致（`typeof SearchWebInput.static` 与导出的 `SearchWebInput` 类型别名互赋兼容）。

### D3 a08 注记——maxResults 暴露=特性决策

dead 解构已删（T1），契约拒收固化为 `Value.Check` 显式断言（schema entropy 的 CI 对策）。**暴露 maxResults 是特性决策而非卫生项**——未来须特性轮正式设计（Integer 边界 / NaN / 负值 / 三入口一致性 / semver minor 叙事）；恢复路径 = git 考古 + 本注记。

### D4 a03 修法——位置化旗值消费

flagValueSet 值集合剔除改为位置消费：已知值旗位 i+1 为值位按位置剔除；查询词与旗值同形不再被吞。回归锁：`--vertical-domain finance finance` / `--mode deep deep` 类用例先行（红→绿实证在案）。

### D5 横切纪律条款（继承+熔断）

- **新债闸（继承 R84 D-007 三向失真判据）**：执行中发现非预期问题——不修则主票验收失真→前置并入主票；不失真但同文件收口→复核行；完全不影响→登记清障轮。发现者无权就地扩票（stop-the-line：暂停+裁决，非就地私修）。
- **熔断**：单票门禁失败→就地修重跑；同票连续 2 轮 LOOP 修复失败→回退该票 commit、挂回 registry、其余票推进（缩轮不整轮挂起）；缩轮事件回呈用户裁决。
- **错形不改**：错误语义本身不许改（ADR-0084 D-006/A-02 已立法 fail-fast）——本轮只归并重复代码。

## Consequences

- VerticalSpec 语义单一权威落 `retriever/contract.ts`；三站组装/守卫重复面收敛为一处判别联合 + 各自渲染层。
- schema 面 `verticalSpecProps` 片段复用消灭 TypeBox 三参块平行抄写；additionalProperties:false 闭合保持。
- a03 吞词修复解锁「旗值与查询词同形」合法用例；CLI 其余旗路径行为不变。
- F-6 探针卫生收口（env 空串 POSIX 一致化 / sanitize 对称遮 / 版本字面量钉包 / CHANGELOG 旧段归位）。
