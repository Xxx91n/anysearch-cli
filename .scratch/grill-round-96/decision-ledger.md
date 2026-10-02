# R96 Decision Ledger（grill-round-96）

> 唯一事实源。每条：ID / 原问题 / 用户原回答原文 / 规范化需求 / 显式约束·负向需求 / 状态（current/revised/stale/deferred）。


## D-001 — R96 正题定界

- **原问题**：R96 这一轮正题选什么？（A 专修 F8 门禁假绿 / B 并题 / C 换题 / D 另指）
- **用户原回答原文**：「采纳」（对推荐项 A 的采纳——先经 atomcode 深调呈报后确认）
- **规范化需求**：R96 正题=F8 门禁假绿收口，专修 `ship-gate.mjs` handoff-lint 腿三缺陷（a 模板↔门禁 PENDING 冲突 / b liveness 静默折叠+祖先性冒充 / c CI 拓扑使必填字段物理不可满足）；三缺陷同属「门禁出口语义」一个设计面，一轮闭环。
- **显式约束·负向需求**：①不并题（ADR-0029 单题性）——r95-rework 分支处置、上游 finding --live 重跑、fundamental×cn_code 新格/全语料体检均挂台账不入题；②claims 内容级抽查不占正题位，仅可作 F8 修复后 closeout 的 dogfooding 验证步；③不重开评测矩阵（R95 读数=证据非裁定），不动 r88 formally-declined，不追写已冻结 closeout-claims.json，不代持/改凭证；④三修法方向锚定：PENDING 须为门禁可证实状态非容忍状态、run 核验由祖先性升等值性、拓扑出口须离线可机械判定（atomcode 工业论据，待后续问题裁形）。
- **状态**：current

## D-002 — run-URL 字段出口语义（三态受控判定）

- **原问题**：「绿色 run URL」腿出口语义重构成什么形态？（A' 三态+受控理由码 / B 最小豁免 / C 恒必填 / D 四态扩展）
- **用户原回答原文**：「采纳」（对修正后推荐项 A' 的采纳——atomcode 深调呈报+GitButler 拓扑辩证修正后确认）
- **规范化需求**：handoff-lint 的 run-URL 判定重构为封闭三态 `GREEN / PENDING{理由码} / RED`：
  - GREEN：≥1 引用 run 满足 head_sha ∈ 栈内独有 commit 集（`git rev-list origin/main..origin/<Stack具名branch>`，有界祖先性——main 基线 run 天然排除）∧ conclusion=success ∧ workflow ∈ required 名单 ∧ repo 匹配本仓；
  - PENDING 封闭二元词表：`stack-unpushed`（谓词=Stack 具名分支无 origin 跟踪 ref）/ `pushed-no-branch-runs`（谓词=ref 存在 ∧ .github/workflows on: 无覆盖该分支的 push/PR 触发器）；活体核验不可用时 GREEN 路径落 `PENDING + verification-unavailable:{gh-missing|repo-parse|api-failed}` 标注；
  - RED：声明-事实冲突 / 词表外理由 / URL 在但提取不出 id / 声明 GREEN 而不可核验。
- **显式约束·负向需求**：①不设 waived/time-boxed/doc-only 等人为豁免码，词表外一律 RED，扩词表须改门禁代码（fail-closed）；②不开第四态（pass-with-DEGRADED 标注被否——破坏可辩护性），PENDING 承接一切无法证实；③等值目标禁用裸 rev-parse HEAD（GitButler workspace 合成 commit 自指悖论）；④祖先线 run 永不参与 GREEN 判定，至多作 PENDING 旁注；⑤降级文案成因分流，禁共用单一 skip 文案；⑥B/C/D 已否：无证实豁免=ADR-0035 D6 反模式 / 恒必填与「不 push 不 PR」纪律冲突 / WAIVED=词表外后门。
- **状态**：current

## D-003 — Stack 行校验设计（三要素分级校验+环境分级降级）

- **原问题**：Stack 行（branch→but-id→sha@date 链）怎么机检？（A' 三要素分级+环境降级 / B 只验存在性 / C 不机检 / D 全覆盖严校验）
- **用户原回答原文**：「采纳」（atomcode 深调呈报+两处辩证修正后确认）
- **规范化需求**：Stack 行校验 = 三要素三级：(i) 每 but-id ∈ but status 解析集；(ii) 每 capture sha cat-file -t =commit；(iii) 链尾 sha ∈ Stack 具名分支历史（membership 非 tip 等值，容忍 gate 晚跑新增 commit——此谓词即 F5R「缺尾」型的机械杀手）。环境分级降级：本地全验模式（but 可执行 ∧ but status exit 0 ∧ workspace 属本仓）/ CI 及无 but 环境 git 层校验照跑 + 显式降级码。
- **显式约束·负向需求**：①RED 三码封闭——but-id-not-resolved / sha-not-commit / chain-tail-not-in-branch；②环境降级码并入统一受控词表：stack-unavailable（无 but/元数据）、ref-unavailable（CI 未 fetch 具名 ref）、shallow-clone；③聚合分流：verified-PENDING=合法出口、env-PENDING=显式标注非阻断（CI 恒无 but，阻断即恒红）、声明不可核验→RED；④but status 解析契约预写死（首 token=CLI id、commit 行以 change-id 或 sha 前缀开头、(sha…) 仅 informational、无 change-id 行与 capture sha 交叉验证本身非 RED）；⑤新鲜度界采纳但宽松可配（STACK_CAPTURE_MAX_AGE_DAYS 量级 45d 起，防「早已失效」伪装「晚跑」，过紧会误红轮间反复 lint）；⑥B/C/D 已否：单验存在性漏 F5R 主型 / 退回人眼 / 移动栈假红；⑦change-id 无 trailer 无 ref，唯一通道=but status 现态解析——时限语义诚实标注。
- **状态**：current

## D-004 — 门禁改动回归锁形态（判定核模块+真值表单测+薄 E2E 冒烟）

- **原问题**：门禁改动自身的回归锁形态（A 抽纯判定模块+node:test / B 内联 selftest / C 纯手跑 / D A+薄 E2E fixture 冒烟）
- **用户原回答原文**：「采纳」（atomcode 深调推荐 D、我接受升级后确认）
- **规范化需求**：
  - 判定核抽为 scripts/handoff-lint-verdict.mjs 纯模块：输入=文档文本+注入环境快照（git/gh/but 观测值），输出=三态+理由码+标注；核内禁 spawnSync/fs/Date.now()/process.env；
  - packages/store/test/handoff-lint-verdict.test.mjs 穷举真值表：每判定允许+拒绝成对用例（OPA 原则）、降级成因分流各一用例、Stack 三要素 8 格组合、词表外值必报错、空输入/缺字段/超长边界；
  - 薄 E2E fixture 冒烟锁「薄壳接线」（判定对但接线错型）；单测与 E2E 共用同一套 fixtures（packages/store/test/fixtures/handoff-lint/）；
  - 测试数为零=失败（fail-on-empty 红线）；fixture/冒烟 exit 非零即 CI 失败；真实仓库手跑降级为发布前一次性人工验收，不再是回归手段；
  - ship-gate.mjs 薄壳只做「采→传→出口」三步，不写判定 if；快照形状定死防 fixture 悄悄失效。
- **显式约束·负向需求**：①fixture 为最小合成对象（handoff 文本串+注入环境快照），一场景一命名；②环境 seam 注入的是采集结果快照非采集器；③B/C 已否：内联 selftest 使生产脚本继续膨胀且偏离 test/ 惯例 / 纯手跑无回归网；④D-001 的 dogfooding 安排（claims 抽查作 closeout 验证步）与「真实手跑降级为一次性验收」合流不冲突；⑤OPA 核心要求：防只测正路径的假绿。
- **状态**：current

## D-005 — 票序结构与程序出口（T0→T6 + 迁移规则 + F8 台账）

- **原问题**：R96 收口怎么落——(1) 迁移规则（新语法 vs 存量 r95 closeout）选 beta 祖父化/alpha 别名/gamma 改写/delta 红窗的何种形态；(2) F8 是否补登记 registry closed 行；(3) 票序 T0→T6。
- **用户原回答原文**：「采纳」（atomcode 续跑呈报+No-Grandfathering 词条实证核查+形态重构后确认）
- **规范化需求**：
  - 票序：T0 轮内 goal 定锚 → T1 判定核模块 scripts/handoff-lint-verdict.mjs + 真值表单测 + fixtures → T2 ship-gate.mjs 薄壳接线 + E2E 冒烟 → T3 handoff-template.md 语法同步 → T4 验收实跑+claims 抽查 dogfooding → T5 簿记（ADR-0097+CONTEXT 词条+CHANGELOG+registry）同轮闭环 → T6 轮报+收口交接；
  - 迁移规则=**生效域划定**（非内容豁免）：新三态语法适用于 round≥96 closeout，round<96 按旧 presence-only 评；lint 靶位=最新有 closeout 轮目录致豁免自失效零残留；立法边界写入 ADR-0097；
  - F8 台账=deferred-registry.json **补登记一行**：status=closed、closed_by=ADR-0097、closed_at、evidence、opened_at 记 R95 发现时点——Fail-Closed Existence Assertion 双向漂移核查所需；
  - T6 收口件按「全绿/降格/F-bug」三态**预写骨架**；条件措辞随 ADR-0097 立法预注册、执行票只誊抄（Conditional-Ticket Purity）。
- **显式约束·负向需求**：①遵守 No-Grandfathering 词条（CONTEXT:870）——迁移规则只准「生效域划定」形态，禁止任何形式内容豁免保留（alpha 别名/gamma 改写已审计件/delta 带病红窗全被否）；②豁免须判据化+不自动续+可审计；③T7/T8 式同轮闭环延伸：ADR-0097+CONTEXT 词条+模板语法同轮完成，杜绝悬空引用；④一票一 commit、but 写操作、新开 R96 分支；⑤原 alpha/gamma/delta 备选与 atomcode 四档递进模型均否决——单件点迁移不需多档权重，其「豁免判据化」原则以生效域形式吸收。
- **状态**：current
