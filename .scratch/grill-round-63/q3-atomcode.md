# atomcode 调研 — Q3: 10 条隔离 live 金案例对 0.0.1 的处置（2026-09-15, grill-round-63）

## 1) 执行摘要
**推荐 A（带病放行+机器护栏），关键修正：把“entries≤10”容量预算式绝对数断言改为棘轮（ratchet）式单调断言**——隔离集只许缩不许涨、renewals 恒为 0、TTL 到期必须二选一裁决。语义=“锁定现状”而非“背书 10 是可接受水位”（10/12=83% 隔离率在任何工业先例都不可接受，仅因隔离原因全为环境性 live drift 才可容忍）。Confidence：护栏形态高；阻断线划法中～高。

## 2) 分点结论
### Q1 隔离规模/增速是否进发布门
共识=**TTL 硬裁决进门、绝对规模不进门、增速作为健康度指标**：
- Chromium TestExpectations（原文）：Failure=照跑但失败算通过=台账式隔离；每条强制 bug+标签+owner；**无规模上限条款**；积压走 StaleTestExpectations 结构性分流；baseline 漂移正规处置是 rebaseline 非隔离——本案 10 条 live drift 定性更接近“基线漂移”而非“产品回归”。
- GitLab（手册原文）：隔离是临时态（fixed/removed/moved 三出口）；fast ≤3d、long-term ≤3mo、3mo 后 Cleanup System **自动开删除 MR**；增速账龄进 Test Health 面板不进发布门。
- Datadog（原文）：Active→Quarantined→(30d 未修)→Disabled→(30d 稳)→Fixed 状态机；**broken（近7天100%失败）不自动转 Fixed**——机器裁决保留人工对真回归的截留。
- oneuptime：双闸=population cap（个位数百分比）+ per-test deadline；到期只有修好或删除两出口；反面案例=140 条无死线隔离=“带纸质痕迹的慢速删除”。
### Q2 正确性 vs 精度缺陷的阻断线
- broken/flaky 分界是工业共识：真回归不豁免；never-quarantine 类（数据完整性、回滚）永不豁免。
- 正确性线（abstain 失效/双闸失效/召回断裂/崩溃）→ Azure DevOps “no P0 bugs”式硬阻断，任何版本都拦。
- 精度线（host 命中页面失手/verdict 漂移）→ 排序质量，先例一致归“可带台账放行”桶，条件=有归属+有到期+有裁决。
- semver 0.x 原文：initial development，anything MAY change——0.x 生态契约放宽质量线**不放宽诚实线**；发布材料夸大即触发 LYING-class。
- 与 D-002 一致：dedup 失效=正确性契约缺陷→Blocker；mustHitUrl 精度短板不同类。
### Q3 机器护栏先例形态
| 先例 | 机制 | 启示 |
|---|---|---|
| GitLab 自动删除 MR | 到期自动开删除 MR | TTL 裁决应机器化非提醒 |
| Datadog 状态机 | 30d 自动迁移+broken 截留 | 到期 promote/retire 二元裁决成熟；可加第三出口“转长期” |
| Chromium unexpected_pass_finder | 自动 CL 移除 stale expectations | 机器清理台账有先例 |
| oneuptime 双闸 | cap 用百分比+deadline | 规模上限先例形态=百分比而非绝对数 |
**形态修正**：entries≤10 是把当前快照写成容量预算。正当用法是棘轮：①entries 相对基线只减不增（新增即红）；②renewals 恒 0（续期即红）；③任一条目过 expiresAt 而无 promote/retire 裁决记录即红。
### Q4 页面级精度带病的叙事与证据风险
- 风险面：垂直检索核心承诺=“答案+可归因证据”；错误页面级归因在受信场景变“幻觉指控且无法自证”（tianpan）；promptfoo 列伪造 source attribution 为 red-team 一级插件；fram：错页引用毁信任最快。
- 缓冲面：0.0.1+如实记载=受控窗口；叙事“初版仪器：域内可答、答必对主机、页面级精度在改进、域外不猜”可辩护。
- **红线**：release notes/README 写“精准命中”之类不带口径表述=LYING-class；诚实写法须给口径：host 级 12/12、abstain 在线验证过、页面级硬断言 2/12、10 条隔离有 TTL 裁决时限。

## 3) 对比矩阵
A(棘轮修正)=推荐：先例契合高，叙事风险如实记载后低。B=拿质量线当地线，过严（先例只对 broken/never-quarantine 硬阻塞）。C=护栏恰是 A 的价值，无机器断言=制度化忽视红（oneuptime）。D=静默 weakening=最坏实践，维持否决。

## 4) 治理冲突检查
- entries≤10 绝对数与先例不符且 83% 下有误导→改棘轮后无冲突。
- TTL 二元裁决与 D-001 三出口无冲突；GitLab 第三出口“转长期”可对齐但**仅限一次**防续期漏洞。
- D 与 D-005 断言方向相抵，否决自洽。其余构件与三门模型/Quarantine-by-Ledger/Gate-of-the-Gate 兼容。

## 5) 来源清单
Chromium expectation_files/web_test_expectations（原文）· GitLab quarantine-process handbook（原文）· Datadog test-visibility quarantine 状态机（原文）· oneuptime flaky-test 批评（2026-07）· semver.org spec item 4（原文）· Azure DevOps release gates P0 查询（Official）· tianpan.co 引用忠实性（原文）· promptfoo red-team 插件文档 · fram 引用信任评论 · 本仓知识库召回 Wave6/票93 前期调研背书。

## 6) 信息缺口
- Chromium 无文档级“规模上限”条款直接证据（“绝对数不进门”是多厂缺失的反推否定性结论）。
- 0.0.1 首见用户对页面级精度失手容忍度无实证基准。
- 同类垂直检索 CLI 发布期精度门槛无一手材料。
- **10 条隔离的 provider drift 根因是否单一**（如单 provider 排序算法变更）未在外部调研范围——若单一根因，排序回归票可能比预期更收敛（票内可查）。

**最终推荐**：A（棘轮形态），D-002 Blocker 维持，D 维持否决；TTL 到期裁决对齐三出口但“转长期”至多一次。
