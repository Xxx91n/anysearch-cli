# Round-60 Decision Ledger（grill-round-60）

**Round 主题**: 产品正文轮（继承 Round-59 硬约束：新代码行 > 治理行）
**开始日期**: 2026-09-13

## 记录

### D-001 Round-60 主题选型 = B（垂直领域可交付闭环）

- **原问题**: Round-60 产品正文轮主题选哪个？A 检索质量深化 / B 垂直领域可交付闭环 / C 产品化可靠性
- **用户原回答原文**: "推荐 B"
- **规范化需求**: Round-60 主轴 = 垂直领域可交付闭环；任务集含 B1 示例域 walking skeleton、B2 装到用链路 CI 实测、B3 doctor 自服务增强、B4 badcase 回灌循环、C1 release-lines 对真实产物实跑、G1 graceWindow/deepMode 治理小票
- **显式约束/负向需求**: (1) B 非裸 B——首张票即含 C 的最小切片（pack→干净环境装→doctor→search 实跑）；(2) A 不独立成轮，仅作 B 的薄探针（真实 badcase 回灌 Golden）；(3) 治理项（graceWindow/deepMode 收尾）走独立小票，diff 行数不计入正文行数对比；(4) 无真实流量时不靠合成题扩 Golden 覆盖；(5) macOS 无双平台实测条件，列为 documented limitation 不虚报
- **状态**: current
- **证据**: `.scratch/grill-round-60/q1-atomcode.md`（atomcode 深调研：6 次搜索 + 6 次全文核验；本地事实交叉）

### D-002 示例域 = docs（技术文档检索，窄切片）

- **原问题**: Round-60 示例垂直域选哪个？（cc-persona / 技术文档检索域 / 代码仓库知识域 / 自选新域）
- **用户原回答原文**: "OK"（对 atomcode 推荐 docs 域方案拍板确认）
- **规范化需求**: 示例域 = `docs` 域（技术文档检索，窄切片）；语料锚定团队日常依赖的一手文档（MCP 规范 / TypeScript / pnpm 等）；golden 首批 10-20 条按八维切片（意图五类/信源层级/新鲜度/中文查询/claim 级归因/多跳/弃答负例/注入），落在 `eval-looks.json`（`anysearch/eval-looks@2`），不复用 golden-cases.ts；验收判据 A1-A6（五端联动可见 / pack 真实装+离线 golden CI / 归因 URL 硬断言 / 弃答+注入复用既有机制 / 诚实性 macOS limitation+golden 全真源 / 行数纪律）
- **显式约束/负向需求**: (1) golden 只收真实提问 + 可回访一手 URL，禁合成题；(2) cc-persona 非现成域（本地 glob 证伪），B1 spec 叙述修正该失实前提；(3) 候选 3（代码/仓库域）推迟至 Embedding Circuit Breaker 浸泡期之后；(4) live golden 首轮只记录不设阈；(5) 候选 4 作为 B2 之后的扩展轨保留
- **状态**: revised（见 D-004 与 D-005，2026-09-13 两次拍板；原记录保留）
- **证据**: `.scratch/grill-round-60/q2-atomcode.md`（本地 glob 证伪 + 7 域名全文 + 三引擎交叉）

### D-003 票序 = 串行里程碑 B1→B2→B4→B3 + C1/G1 挂尾

- **原问题**: Round-60 分票结构与票序（串行小三票 / 并行两流 / 单一大票 / 其他）
- **用户原回答原文**: "OK"（对 atomcode 推荐串行里程碑结构拍板确认）
- **规范化需求**: 票序 M1 B1（docs 域 skeleton + golden 首批，含 C 最小切片）→ M2 B2（装到用 CI 实测）→ M3 B4（badcase 回灌）→ M4 B3（doctor 增强）→ 尾 C1（release-lines 对真实产物实跑，依赖 B2 产物）+ G1（graceWindow/deepMode 裁决治理小票，依赖 B1-B4 使用证据）；每票独立验收；G1 豁免写 Round-60 ADR 含 sunset（Round-61 不得自动沿用）
- **显式约束/负向需求**: (1) G1 diff 行数不计入正文行数；(2) C1 不申报豁免，CI 脚本归类在 B1 spec 显式声明；(3) B1 spec 须显式定义"正文行"归类（域代码+golden 数据计正文）；(4) B1 spec 须核对 eval-looks@2 与 golden.test.ts schema 兼容性；(5) R1 张力（离线 CI × 归因 URL 硬断言）由 B1 spec 分层裁定：URL 断言走 online/真源校验，离线用快照 fixture；(6) G1 允许合法结局 "documented deferral + 下轮复核条件"
- **状态**: current
- **证据**: `.scratch/grill-round-60/q3-atomcode.md`（三源一致+账本无冲突）

### D-004 语料 allowlist = 规则层 C + 首批实例化 A（D-002 revised）

- **原问题**: docs 域语料 allowlist 怎么圈？（A 最小圈三源 / B 宽圈六源 / C 滚筒规则，URL 实现期再定）
- **用户原回答原文**: "接受"（对 atomcode "C 规则层 + A 首批实例化 + D-002 revised" 方案拍板）
- **规范化需求**: 规则层入 ADR——入圈需同时满足一手性/日常依赖/可回访/八维切片有新增益；出圈触发官方 supersede/超期翻 stale/两 round 无 golden 引用/404||410；freshness class：spec-major 90d / reference-stable 180d / reference-active 90d；首批 URL 三源（MCP transports / TS tsconfig / pnpm settings）落 B1 spec 附表，不占 Round-60 ADR 正文行数
- **显式约束/负向需求**: (1) 锚定单元=入圈规则，URL 清单是规则当前输出（D-002 revised 正式措辞）；(2) 出圈 URL 按 Corrective Supersession append-only，reuse 已有 supersession 状态机与 HITL 出口，不另造轮子；(3) 首批三源已原文核验可达；(4) turbo/tsup/node 等宽圈顺延，badcase 回灌（B4）显示缺源时走滚筒补录；(5) golden 全源回溯须保持全真源
- **状态**: current
- **证据**: `.scratch/grill-round-60/q4-atomcode.md`（OWASP/Ground/Waxell/Coalent/Parallel 五源全文核验）

### D-005 首批 golden 来源 = C 混合 + coverage manifest（D-002 二次 revised）

- **原问题**: 首批 golden 真实提问从哪收割？（A 历史回溯 / B 空跑后滚动 / C 混合）
- **用户原回答原文**: "采纳"
- **规范化需求**: 首批 = 自有会话~Round-59 真实技术疑问回溯（provenance `internal-dogfood`）+ 外部真实提问（SO/GH issue 等，provenance `external-community`），量现实区间 8-14 条；B4 为常态来源；新增 `eval-looks.coverage.json` coverage manifest，八维每维标 `covered|deferred`，deferred 维度必须带入账触发（B4 回灌 / 真实弃答事件发生 / 真实注入尝试出现）
- **显式约束/负向需求**: (1) **D-002 二次 revised**：首批 10-20 条八维切片 → 首批 8-14 条实收维度 + manifest 声明未收维度入账触发；10-20 改为 Round-60 收官（B4 回灌后）存量目标，非 B1 上架门槛；(2) 弃答/supersede/注入等被动负例收不齐时按 defer 处理，禁止为凑维度转合成；(3) manifest 是诚实性验收物，验收按"声明了没有"打分；(4) deferred 维度连续两 round 无法真实收割 → ADR 记 documented deferral（对齐 D-004 滚筒出圈）；(5) B1 spec 附"逐条清单收割"作为开工第一项
- **状态**: current
- **证据**: `.scratch/grill-round-60/q5-atomcode.md`（SQuAD 2.0/Harvey/Langfuse/Fireworks/Braintrust 多源交叉）

### D-006 版本策略 = 0.0.1（patch 起步）

- **原问题**: C1（release-lines 实跑）的版本号与首次发布策略？候选 0.1.0 / 0.0.1 / 维持 0.0.0 仅内 tgz
- **用户原回答原文**: "B"
- **规范化需求**: C1 票以 `0.0.1`（patch 起步）发布；诚实信号 = 骨架可装、功能收敛中；不假装已达 0.1.0 水准
- **显式约束/负向需求**: (1) 发布需走 release-lines 门禁对真实产物实跑（非 mock）；(2) 不宣称达到 minor 语义；(3) B1-B4 未完不做 publish
- **状态**: current
- **证据**: user direct decision
