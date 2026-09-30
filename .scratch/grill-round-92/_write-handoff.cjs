const fs = require('fs');
const p = 'D:\\Aworker\\anysearch-cli\\.scratch\\grill-round-92\\handoffs\\next-round.md';

fs.writeFileSync(p, `# R92 常驻任务书 — 售后收口续轮（T2 复跑 + README 对齐 + claims 接线 + deprecate）

**签发**: 2026-09-30 grill 定稿 | **账本**: .scratch/grill-round-92/decision-ledger.md（D-001~D-003 全 current）
**上游工件**: R91 审计收口 .scratch/grill-round-91/handoffs/round-91-audit-closeout.md（审计通过，挂账 5 项）；R91 T2 判词 evidence/t2-verdict.json（F-bug，根因=DEEPSEEK_API_KEY 环境缺位）
**调研归档**: q2-atomcode.md（注入机制/宿主/L3b 修订/凭证卫生/模型冻结）；q3-atomcode.md（票序符合度+四子题裁决+隐藏依赖）

## 开工三件套（必读，顺序不限）

1. 本文件（票序+闸+范围外+汇报纪律）
2. 账本 .scratch/grill-round-92/decision-ledger.md（D-001~D-003 唯一事实源）
3. ADR-0092（判据/词汇表/D4 两拍义务）+ .scratch/grill-round-91/evidence/（t1-probe/t2-smoke/t2-verdict/t4b-deprecate 先例形态）

## 事实底账（已实证，勿重跑）

- User-scope DEEPSEEK_API_KEY SET len=67；直连 featherless POST /v1/chat/completions → 200（model=Qwen/Qwen3-32B）。值不入档不落上下文。
- featherless 端点面：GET / → 200；GET /v1/models（含 capabilities 过滤）→ 404 Gone 双态（带/不带 key 同）；POST /v1/chat/completions 假 key → 401。枚举端点缺席=厂商侧文档-实现漂移，模型 id 走文档点名（Qwen3/Kimi-K2 家族原生 tool-calling）。
- 本机 dsh=0.1.7-rc.2；npm dist-tags: latest=next=0.2.0-rc.2（rc 升 latest≠stable 晋升，不触发 soak 判词）。
- headless profile 已装 dsh-plugin@0.1.0（R91 遗产）；~/.dsh/profiles/{headless,web}/。
- README.md:227 / README.zh-CN.md:217 仍为 0.1.5-rc.2+MCP bridge 旧表述（T3 条件票未启过）。
- scripts/ship-gate.mjs 正则笔误已修（fcf97e32）；WORKFLOW.md 判死已立法（ADR-0092 D3）；closeout-claims 机制 schema=anysearch/closeout-claims@1。

## 票序（一票一 commit，类型不混）

| 票 | 内容 | 覆盖 | commit 类型 |
|----|------|------|------------|
| T0 | 哨戒+基线：npm dist-tags 复观（stable 目击→启 TC，一次定死）；check/test/ship-gate --quick 基线快照；五件探针证据归档 evidence/t0-*（env 可见性/User-scope 实测/featherless 四态端点归因/key 直连 200/ANS_LLM_BASE_URL 现状） | D-001/D-003 | chore+evidence |
| T1 | 立法=新 ADR-0093：T2 判据全包（复用 ADR-0092 三腿+三分支）+冻结项（诱导句文案/Qwen/Qwen3-32B/contextWindow 按官方目录/N≤3）+L3b established-via-fallback 词汇增补（标 ADR-0092 D1 revised-in-part）+README 双版措辞预注册（established 版/fallback 收窄版）+机制不可用→F-bug 分支预注册（dump-config 无 featherless 痕迹→not-established:[L3a]）+DEEPSEEK_BASE_URL rejected+凭证卫生条款 | D-002/D-003 | docs |
| T2 | 复跑执行：【票内前置】preflight tool_calls 探针（裸 chat/completions+tools 数组验证模型真 tool-call）→建隔离 profile r92-smoke→plugin add（L3a 冷启）→dump-config→patch 层注入 providers.featherless+agent-default-model 覆写→诱导 turns（定死句，N≤3）→transcript/verdict 双工件→判词三分支→泄漏探针（transcript grep key SHA-256 前缀） | D-002/D-003 | chore+evidence |
| T3【条件票】 | 判词达标（established 或 established-via-fallback）才启：README.md:227+README.zh-CN.md:217 版本+拓扑+status 对齐实测（0.1.7-rc.2+native registration+实际判词档）；按 T1 预注册版誊抄，禁止现场拟措辞；integration 专文同步检查 | D-001/D-003 | docs |
| T4 | readme-token-pin 检查器接线 scripts/ship-gate.mjs（ADR-0092 D4 第二拍，无条件）：断言 README 行版本令牌=实测宿主版本；票内 shadow dry-run（只读、输出归 evidence、写明 shadow 性质、不入判词不阻塞）；首跑专属机器腿显性挂账 R93 | D-001/D-003 | fix |
| T5 | deprecate 双空格执行尝试：复用 .scratch/grill-round-91/evidence/t4b-deprecate.md 备准命令（6 版本枚举+目标文案 Fixed in 0.1.0 upgrade. 单空格）；E401/E404/EOTP→如实记账呈报用户亲触；closeout-claims deprecate 双态措辞随本票预注册 | D-001 | chore |
| T6 | 收口件批：ADR-0093 完成体（票序节填实际执行）+CONTEXT 词块引用锚补齐+registry 更态+closeout-claims（含 deprecate 双态）+轮报（按全绿/降格/F-bug 三态预写骨架选填）+任务书终态戳+CHANGELOG r92 段 | D-001~D-003 | docs |
| T7 | 门禁+审计 LOOP：check/test/ship-gate --quick+惯例双轴复核 | D-003 | — |
| TC | T0 目击 0.2.0 stable 晋升→closing probe；未目击不启不留痕 | D-001 | — |

## 跨票闸（硬约束）

- 判词词汇从 t2-verdict.json 一字不差取（established/not-established/established-via-fallback/F-bug 分支 ABC）；
- T2 判词=F-bug→熔断转修复票（registry 挂 F-bug 项）；判词不达→T3 不启不留痕；
- T3 不携带立法（措辞已于 T1 预注册两版）；
- T4 dry-run 写明 shadow 性质，不得误读为跑了专属机器腿；
- TC 判定窗口=T0 一次定死，T2 启动后不复观 dist-tags；
- 凭证纪律：key 值不入档不落上下文不落 transcript（泄漏探针闭环）；apiKeyEnv 只记变量名；
- pathlint 冻结（.scratch/**/*.md 已在注册面；机外路径须带 machine-local marker）；
- deprecate 外发限双空格+文案质量核对，不改写措辞；EOTP/权限失败按 R87 D4 执行态如实记账；
- 无 tag/push/publish/分支清理。

## 范围外

repin（0.2.0-rc.2 仅哨戒记档）；垂域死刑复核（r88-candidate 明文排期下轮主轴候选）；defer-r72-dsh-web-interactive-matrix 主体；defer-r72-dsh-approval-channel（维持 defer：headless 无 answerer 实证）；评测面 defer-f17；常驻债×5；defer-r86-anysearch-corpus-param-contract。

## 汇报纪律

- 全路径汇报（含 D:\\Aworker\\anysearch-cli\\.scratch\\grill-round-92\\handoffs\\next-round.md 类全路径）；
- 区分 implementation complete/committed/pushed/published/live-verified；
- 判词未达不谎报，如实出 established/not-established 清单；
- 缩轮事件即时呈报。

## Suggested skills

- gitbutler（but）：全部 commit/分支操作；先 but diff 再 but commit -b；
- tdd / diagnosing-bugs：T4 检查器接线与 T2 判词异常排查；
- code-review / handoff：T6/T7 轮末复核与交接；
- context-mode（ctx_*）：取证与文件读取首选面；
- domain-modeling：ADR-0093 词汇表修订措辞。

## 终态戳

- [ ] T0~T7 票序走完或熔断呈报
- [ ] 判词工件 + 双工件落盘
- [ ] T3 条件票状态（启/未启）记录
- [ ] closeout-claims 全绿或双态记账
- [ ] 本文件终态戳位填写
`);

console.log('next-round.md bytes:', fs.statSync(p).size);
