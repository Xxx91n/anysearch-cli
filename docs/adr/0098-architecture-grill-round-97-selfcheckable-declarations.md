# ADR-0098: Grill Round 97 — 自造失效声明可机检类别（统一立法 + 形态一/三实现 + 形态二先立规则）

R97 为自造失效声明收口轮：同族缺陷第三次出现且首次被机器捕获（R95 F5R push 自造失效 / R96 P5→LOOP2 F1 ADR 实测值写入即失准 / R96 §10.3 改写打断机械锚 claim，全靠人工审计；R96 LOOP3 push 后 PENDING{stack-unpushed} 被 declaration-fact-conflict 当场抓出）。正题 A 把「自造失效声明」立法为可机检类别；并行处置轨 B 清算未合并分支栈（另见 goal.md，land 需 owner 授权）。

## Status

Accepted (grill round r97; 票序 T0→T7 per `.scratch/grill-round-97/handoffs/next-round.md`). Ledger: `.scratch/grill-round-97/decision-ledger.md` (D-001~D-006, all `current`). Goal: `.scratch/grill-round-97/goal.md`.

## Context

门的可信度上限取决于喂入声明是否诚实。R96 已修门腿（纯核 + 薄壳 + 三态），但声明本身仍是自证（self-attestation 最弱档）。R97 立法使声明自带可机检谓词：写时真、运行时仍真，两问同答。

## Decision

### D1 统一类别：三元组 + 封闭注册表

「自造失效声明」= `{词表项, 机械核验谓词, 失效触发谓词}` 三元组 + 封闭谓词注册表（`STATE_PREDICATE_REGISTRY` in `scripts/handoff-lint-verdict.mjs`）。

- 每词表项登记 `{核验谓词, 失效触发, 环境需求, reuse 指针}`。
- 扩表须改门禁代码（fail-closed）；扩表 PR 自身受三态门禁约束（自指收敛，防注册表成后门）。
- 失效语义 = 词表项的 valid-time 属性（bitemporal：如 `unpushed` 失效条件 = origin ref 出现）；机检须同答「写入时为真」与「门禁运行时仍真」（日期位 + 运行时复核）。

### D2 词表初版：3 项全离线（活体延后）

| 词表项 | 核验谓词 | 失效触发 | 环境需求 | reuse |
|---|---|---|---|---|
| `unpushed` | `origin/<branch>` ref 缺位 | origin ref 出现 | git | — |
| `unlanded` | `git rev-list origin/main..origin/<branch>` 非空 | 成员集变空 | git | — |
| `no-branch-runs` | workflows `on:` 无分支覆盖 | pushBranches 覆盖该分支 | workflows | `parseWorkflowTriggers/collectWorkflowTriggers` |

活体谓词 `no-pr`/`unpublished` 延后 = 首张扩表票（自带验收：扩表须改门禁代码 + 扩表 PR 自身受门禁约束闭环）。初版锁 3 项不外溢（flaky 假红信用损失大于覆盖收益）。

### D3 形态一落地参数：单行标记 + 自移靶位 + 离线判定

- 标记语法：单行 HTML 注释 `<!-- state: <predicate> <args> @ <iso-date> -->`；单条正则整体可解析；args 禁 `--`（CommonMark 严格性）；`stack` 占位 = 解析 Stack 行具名分支。`docs/agents/handoff-template.md` 给状态声明定语法家（run-URL `PENDING{code}` 为先例形态）。
- 裸词违例：词表英文 token + 登记中文等价短语封闭枚举（`unpushed:未推送 / unlanded:未合流 / no-branch-runs:无分支覆盖`），字面匹配非 NLP；代码 span/fence 豁免；散文从属于标记，禁反向。
- 靶位：沿用最新含 closeout 轮目录自移（= 自动滚动 ratchet）；无靶位显式 no-op + 日志；靶位解析进 golden 测试。报告级全量扫只出报告不开门禁；门禁级增量扫（diff-touch + 最新轮）开门禁（两速分权，gitleaks scheduled 同构）。`docs/adr` 不入形态一靶（形态二地盘，防双重管辖）。
- 判定：声明-事实冲突 → `declaration-fact-conflict`；词表外谓词 → RED；核验环境不可用 → env-PENDING；失效触发求值（写入真且运行仍真）。

### D4 形态三：verbatim 字节锚 + 重锚仪式

- claims schema 新增 `verbatim` kind：整句字节级锚（防同数换位/语义弱化盲区；现有 `count` 锚存在同数不同语义静默过检，SwiftLint baseline #6871 同型）。
- 重锚仪式：改写须携变更理由 + 落审计记录 + ratchet 可见的重批计数。verbatim 不脱离仪式单独立法（无显式重登记通道的字节锁等于逼人绕行）。
- R97 `closeout-claims.json` 首批用 verbatim 锚自证（dogfooding）。

### D5 形态二内容规则（先立规则，机检腿先 PENDING）

- 权威文档（ADR/CHANGELOG/轮报）实测数值须同段挂复现命令或治理型 marker 锚（借 `<!-- machine-local: ... -->` 标记语法族）。
- 机检入 lint 先落 PENDING 位（surfaced 非阻断），ratchet 收敛后升 RED。deferred：形态二 ratchet→RED 排程票（见 deferred-registry）。
- 实测值定义：运行复现命令在注记树上产出的数字（命令 + 树 + 时间三要素同段）；手工计数、估算、转述不算实测值，不得以实测口吻陈述。
- marker 示例沿 `machine-local` 语法族：`<!-- machine-local: <reason> @ <YYYY-MM-DD> -->`；机检腿以 PENDING 位挂接（surfaced 标注先行），ratchet 收敛后升 RED，排程见 T6 登记的 deferred 票。
- 存量声明过渡期豁免 = 流程豁免（No-Grandfathering 合规）；新声明自立法日起须过机检。

### D6 生效域边界

新声明自立法日起过机检；存量 = 流程豁免（自移靶位自然消退，零残留）。禁 NLP/散文近似匹配（谓词仅标记内匹配；宁词表小+误报趋零）。

## Consequences

- 门禁新增 state 腿：RED（冲突/越表/语法/裸词）> PENDING（env）> GREEN。旧 27 fixtures 无标记 → state GREEN，零回归。
- GREEN 兑现边界：ff-land 后 `origin/main..origin/<branch>` 为空 → 栈内 commit 集为空 → run-URL 字段仍 PENDING（已知风险，待 PR 拓扑兑现）。
- 活体谓词 flaky 记项：初版排除活体依赖，扩表票另立。

## Known-Risks

1. `count` 锚同数换位盲区：同数量不同语义静默过检；verbatim 为补丁，存量 count 声明不追写。
2. 活体谓词 flaky：`no-pr`/`unpublished` 入表即 flaky 假红风险，故延后扩表。
3. 标记散文并存 intent 漂移：裸词规则 + 单正则解析为栏；frontmatter 只剥离不校验已否。
4. 全量回溯海啸：禁全量回溯门禁化；报告级只读。
