# R88 Decision Ledger — grill-round-88

> 数据源纪律：本账本是唯一事实源。每条含 ID/原问题/原回答原文/规范化需求/显式约束/状态。
> 承继：R87 账本 D-001~D-005（全 closed 于发布收口轮），registry open=17。

## Current

（D-001 已落账）

## Revised / Stale / Deferred

（空）

## D-001 — R88 主轴裁决：搜索面卫生轮（A′）

- **原问题**：R88 主轴——A 搜索面卫生轮（F-6+同域 r83 三票）/ B 垂域方向重议候审轮 / C 广义清债轮 / D 另指。（经 atomcode 调研修订为 A′）
- **用户原回答原文**：采纳
- **规范化需求**：R88=「搜索面卫生轮」。正题=F-6 refactor 施工（scripts/probe-anysearch-mcp-raw.ts：??/|| 一致化+sanitize 对称遮 endpoint+版本字面量护栏+CHANGELOG 归位）+同域纳编 r83-a03（CLI flagValueSet 吞词）/a06（垂域组装+require-domain guard 三处近重复）/a08（dead maxResults）三票——五件同落 search/tooling 面，一单 ADR-0029 合规主题。**预注册条款**：a06 归并边界（三处近重复统一到哪一层）必须写入 ADR 验收判据后再动工，防施工中临时改判。
- **显式约束/负向需求**：B 垂域方向重议候审不复活（prefer-capable 具名重开条件 |ΔarmHostHit|≳0.4 未达、0.1.0 无新证据——重议=goalpost-shifting；漂移风险由 r88-candidate 候选票+触发器制度对冲）；C 广义清债否（违 ADR-0029 单主题纪律+aalonso 无偿还计划的票不是债）；上游触发债（r86×2/r81/r84）维持具名触发不主动推进；常驻背景债×8 维持挂账+触发条件；钉版 0.1.0 不动包；无外发动作（本轮无 tag/publish）。
- **依据**：atomcode 调研 q1-atomcode.md（Atomic Object post-release grooming/Fowler 债务四象限原文/Back Market 利息判据/benny 触发式复盘/Google Fixit/Bourgau boy-scout 失效/aalonso 债票纪律；最强反对论据=低利息债不必急还——反驳：利息在位置不在行数，三票全落核心交付面）。
- **状态**：current

## D-002 — a06 归并边界裁决：双层归并（A1′，写入 ADR-0089 验收判据）

- **原问题**：a06 三处近重复的归并边界——A1 双层归并（retriever 运行面+kernel schema 面）/ A2 仅 MCP 双站 / A3 kernel 大一统 / A4 另指（含不归并）。（经 atomcode 调研修订为 A1′）
- **用户原回答原文**：采纳
- **规范化需求**：
  - 运行面：buildVerticalSpec({domain?,subDomain?,params?}) 归 packages/retriever/src/contract.ts（与 canonicalizeVertical 同址=VerticalSpec 语义单一权威），返回判别联合 {ok:true,vertical}|{ok:false,reason:结构化短码枚举}——cli/search.ts、search-web.tool.ts、research-web.tool.ts 三站共享组装+require-domain 守卫语义；
  - 错误通道各 surface 自行渲染（CLI→stderr+exit(2)、MCP→tool error text），**人话文案归各 surface、结构化 reason 归共享函数**（与仓内 IpcError 模式同构：typed error enum+i18n_key，surface 渲染）；
  - schema 面：kernel/tool-schemas.ts 抽共享 verticalSpecProps TypeBox 片段供 SearchWebInput/ResearchWebInput 复用，additionalProperties:false 与注释随片段走。
  - 验收判据预注册（写入 ADR-0089）：①reason 短码枚举集+各 surface 文案映射表；②错误输出形状与现状 byte-identical（ADR-0084 D-006 错形不许改的镜像）；③tsc --noEmit 级验证 TypeBox Static 推断命名一致性。
- **显式约束/负向需求**：错误语义本身不许改（ADR-0084 D-006/A-02 已立法 fail-fast——只归并重复代码）；共享函数不得识调用方（零 caller 条件分支、零参数分歧——差异全在渲染层）；A2 否（留语义发源地 CLI 在共享面外）、A3 否（kernel 持运行变换语义=分层倒置）、不归并否（知识重复非巧合重复，Rule of Three+已立法双条件击发）。
- **依据**：atomcode 调研 q2-atomcode.md（Sandi Metz Wrong Abstraction/Kent Dodds DRY 原文/sergiodxa monorepo 分层/nazarboyko 能力划包/JSON Schema 官方 structuring/Conlin Durbin WET；Tavily 超限由 Exa+AnySearch+知识库顶替，关键结论 ≥2 独立信源）。
- **状态**：current

## D-003 — a08 dead maxResults 去向：删解构+契约测试加固（A′）

- **原问题**：a08 dead maxResults——A 删解构 / B schema 增键 / C 另指。（经 atomcode 调研修订为 A′）
- **用户原回答原文**：采纳
- **规范化需求**：移除 apps/mcp/src/tools/search-web.tool.ts:22 的 maxResults 解构与 :37 传参（零行为变化——AJV additionalProperties:false 现状已硬拒），refactor commit 不混特性面；三入口对齐「全表面不暴露=引擎统一默认 10」；ADR 注记「暴露 maxResults 是特性决策非卫生项——未来须特性轮正式设计（Integer 边界/NaN/负值/三入口一致性/semver minor 叙事）」；**新增验收判据：单测断言 SearchWebInput 拒收 maxResults 键**（契约不暴露固化为显式契约测试，schema entropy 的 CI 对策）。
- **显式约束/负向需求**：本轮不得对任何入口暴露 maxResults（B 否——单方面扩大已发布 MCP 公共契约+单口暴露造三入口分叉新债，且 schema 是 LLM ground truth 每加一键扩大出错面）；不得借卫生轮做契约扩张；未来恢复路径=git 考古+ADR 注记。
- **依据**：atomcode 调研 q3-atomcode.md（Hyrum 定律前提为空——无可观察行为被依赖/契约演进 additive-MINOR vs breaking-MAJOR 三源/tianpan.co Schema Entropy/SO+dev.to 死码判例/MCP 官方 schema 纪律；最强反对论据=引擎已支持砍能力——反驳链三段成立；Tavily 超限双引擎顶替，结论≥2 信源）。
- **状态**：current

## D-004 — 轮内票序+commit 结构（A′ 修在前并随收口）

- **原问题**：轮内票序+commit 结构——A 修在前并随收口一票一 commit / B 归并先行 / C 另排。（经 atomcode 调研修订为 A′）
- **用户原回答原文**：采纳
- **规范化需求**：七票序——T0 哨戒续班（dsh watch+CI 观测）+基线快照（check/test/ship-gate 当前态）；T1 a08 删解构+契约拒收测试；T2 a03 位置化旗值消费+先补吞词回归测试再修（characterization-test 纪律）；T3 a06 双层归并（在 a03 落定后归并=搬已修复形态，buildVerticalSpec→retriever+verticalSpecProps→kernel+三站接线+错形 byte-identical+tsc --noEmit）；T4 F-6 probe 卫生（独立文件最后做）；T5 收口件（ADR-0089+CONTEXT 词块+CHANGELOG [Unreleased] Removed/Fixed 段+registry 四票核销转 closed+claims+任务书，单文档 commit）；T6 门禁+审计 LOOP（pnpm -r check/test+ship-gate --quick+惯例复核）。Commit 结构：T1–T4 各一 commit、T5 一 commit；type 纪律——a03=fix、其余=refactor（Conventional Commits 定义一致）。
- **显式约束/负向需求**：B 否（归并先行=preparatory refactoring 误用——搬含 bug 代码进新边界后 a03 修法必混 refactor commit 或落边界外，可推演失败非假设）；C 无必要；refactor 与 behavior fix 不混 commit；无外发动作；DRY 归并搬的必须是已修复形态。
- **依据**：atomcode 调研 q4-atomcode.md（Feathers characterization-test/Fowler 两顶帽子 Nicolas Carlo/Jake Goulding commit 拆分/Google eng-practices/Conventional Commits refactor 定义原文/lobste.rs；全文已索引 ctx FTS）。
- **状态**：current

## D-005 — 三缺口闭合包：新债闸显式继承+a06 断言载体预注册+熔断规则（A′）

- **原问题**：盲区审计发现的 frontier 残余三面——①执行中新债处置闸是否显式沿用 R84 D-007 三向失真判据；②a06 byte-identical 冻结的断言载体（靠什么证明输出字节不变）；③票失败/轮失控的熔断规则。（经 atomcode 盲区审计修订为 A′ 一揽子）
- **用户原回答原文**：采纳
- **规范化需求**：
  - ①新债处置闸：**显式继承 R84 D-007 三向失真判据**——T1–T4 执行中发现非预期问题时：不修则主票验收失真→前置并入主票；不失真但同文件收口→复核行；完全不影响→登记清障轮。**发现者无权就地扩票**（stop-the-line：暂停+裁决非就地私修）。
  - ②a06 断言载体预注册：T3 归并施工前先为三 surface（cli/search.ts+search-web+research-web）错误输出形状补 golden/快照断言作 byte-identical 真理源（等价断言已存在则复核豁免并在 ADR 注明）；**reason 短码枚举集升票内前置立法**——枚举值写入 ADR-0089 验收判据，不留施工自定（Pact Golden Rule：契约面枚举须预注册非实现随行）。
  - ③熔断规则：单票门禁失败→就地修重跑；同票**连续 2 轮 LOOP 修复失败→回退该票 commit（一票一 commit 粒度已备）、该票挂回 registry、其余票推进**——缩轮不整轮挂起；缩轮事件回呈用户裁决。
- **显式约束/负向需求**：三缺口属追加立法非重开主轴；a03 已有测试锁行为而 a06 原本没有=不对称遗漏现已补齐；回滚手段（一票一 commit）与回滚决策规则（本条款）两者皆备；发现新债不得静默顺手修。
- **依据**：atomcode 盲区审计 q5-atomcode.md（premortem Klein/nesslabs、stop-the-line businessmap、Pact Golden Rule、Feathers characterization 复用；判 frontier 非严格空但残余小，单一追加决策闭合）。
- **状态**：current
