# atomcode R91-Q2 调研归档：L3 冒烟验收判据 + 宿主版本选型

> 存档于 2026-09-29。调研 prompt=.scratch/grill-round-91/q2-prompt.txt。以下为报告全文要点归档（FTS5 索引内有全文，source=atomcode）。

## 执行摘要
推荐 A 方案修订形态 A′（置信高），版本选型=升 0.1.7-rc.2 单版本。判据分层与工业界四信源同构（mcp-smoke/Autonoma/AgentV/Agent smoke testing）。三处盲点修正：①L3b 取证物须落到 stream-json transcript 的 model-request tools 载荷（非 UI/日志自述）；②L3c 「限次」须预注册数值；③L3d fail-open 测的是 ans-mcp 侧契约非注册面，降为顺验项。最强反对论据=「c 层部分绿算什么」灰区，必须预注册。

## 分点结论
1. 确定性 vs 模型相关判据分层立法=行业共识（Autonoma 三层法/AgentV 四层 taxonomy/Agent smoke viability-gate 切分）。A 骨架同构。
2. L3b 枚举绿=真正主轴；工业界为此失败模式造了品类=silent first-turn tool loss（mcp-smoke：server 正常+注册成功但真客户端 turn1 组包工具不在场，无 error 无 warning——恰是 R65 F-09..F-12 风险类）。方法学三件套搬入：wire 载荷为 ground truth、verdict 双工件对质（客户端 init 工具集 vs 线上应答）、全量工件落盘（transcript.jsonl/verdict.json）。
3. 预注册判据惯例成立且「跑前定、跑中不改」（Momentic：thresholds 在 testing begins 前设定+具名 owner 例外机制；Kualitatem/Enov8 entry/exit criteria 佐证）。
4. 测哪版记哪版直接先例（zimster：「Only observations against that exact build are current claims」，host 行带精确版本号+日期+verification level；hermes-qvac 精确 hash+「not tested or claimed」原则）。
5. as-is 缺陷被低估：rc 线非稳定被测对象（Agent smoke testing 把 model version change 列为独立重跑触发——「the system under test moved without any change of yours」）；0.1.5-rc.3 与 0.1.7-rc.2 跨三代，as-is 的绿保质期到下一 rc 为止而那个 rc 已存在。
6. 失败处置三值连续谱先例（zimster LIVE/INSTALLED_PACKAGE/STRUCTURAL 三级+not-established 列；Momentic 具名 owner+mitigation 记录放行）。A 三分支判词=该连续谱三采样点，工业先例支持；建议补「记录为已知限制」中间档。
7. B 与 C 各被独立信源否定：B=验证无人新装的旧宿主；C=无信息增量检查留门内=反模式（「every addition individually reasonable and collectively fatal」）。

## 盲点与过度设计
- 盲点1（最重要）：L3c 缺三个数=诱导任务措辞跑前定死+N=3 重试上限（mcp-smoke --runs 3 惯例）+部分绿判词。建议 L3c-min=≥1 ans_* 真实调起并完成 /mcp 往返（门判据）；L3c-full=五工具诱导矩阵逐个命中（增强判据，不阻塞 README 改行，只决定 claim 宽窄）→zimster established/not-established 落点。
- 盲点2：L3b 取证物未指名——须为 stream-json transcript model-request 消息 tools 数组（五裸名+inputSchema）；取证通道存在性本身须跑前确认否则 L3b 不可判定。
- 盲点3：L3d 归属错——测 execute 层对 ans-mcp 死亡容忍（已双端实证）非 dsh 注册面；降为同台架顺验项不计入门。
- 过度设计：d/e 标为「非判据（顺验/免测）」，防「五层全绿」误读为门槛；门内条目 5-8 上限。

## 最终推荐
- Q2.1：A→A′：三判据（a/b/c-min）+两非判据（d 顺验/e 免测）；c 预注册任务措辞+N=3+L3c-min/full 两档；b 先确认 transcript 取证通道再跑；判词三分支保留+降格措辞带 established/not-established 清单。
- Q2.2：升 0.1.7-rc.2 单版本（测=记=钉三版收敛；双版本=rc 生态持续维护税；as-is 验证无人使用配置）。
- 最强反对论据正面回应：「升版引入版本变量，c 败时无法区分注册面病 vs 0.1.7-rc.2 新引入病」——该论据只在 a/b 败时有诊断价值，而 a/b 是确定性层，真败 F-bug 立项后版本二分定位是低成本补跑项；对照冒烟是败因诊断工具非验收门。

## 信息缺口
- dsh 0.1.7-rc.2 changelog 不可公网核验（闭源 rc 生态）——升版风险靠冒烟本身兜底。
- headless 下 model-request tools 载荷是否完整入 stream-json transcript=L3b 跑前确认项（本地验证非外部调研）。
- Cordis ctx.tools.register 官方语义文档未公开——恰论证 L3 必要性。

## 来源（9）
mcp-smoke(GitHub greenchill/mcp-smoke)/Autonoma MCP 三层测试/Momentic QA Release Checklist/AgentV Evaluation Layers/TestMu Agent Smoke Testing/Semaphore Flaky Mitigation/zimster COMPATIBILITY/hermes-qvac compatibility.md/Entry-Exit criteria 两篇。
