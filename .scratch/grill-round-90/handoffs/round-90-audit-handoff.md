# Handoff — R90 审计轮收口（2026-09-29）

## 状态

R90 实施轮 + 独立审计均收口：审计通过，无返工项。GitButler 车道 r90-audit 单 commit 叠于 r90 之上（未 push/未 land），公共基 7b938d7e（r89-audit），工作树净。审计 commit 稳定锚=but id mwq（sha 31abfa81；amend 下 sha 滚动以 git log 为准）。硬验收四腿审计窗亲跑全绿（check/build exit0、pack tgz+listing 六项、双进程 /health/401+真链路 hitsCount=5、dsh-plugin 21/21+全仓 test exit0、ship-gate 65/0）。

## 关键产物（按路径引用，勿复读）

- 审计报告：.scratch/grill-round-90/reports/2026-09-29-audit-report.md（声明→证据→结论 15 行对照 + D1-D6 证据 + 双轴评审 + 轻微发现四项 + 过程呈报五条）
- 实施轮收口：.scratch/grill-round-90/handoffs/round-90-closeout.md（票序终态表+挂账+下轮候选）
- 实施轮轮报：.scratch/grill-round-90/reports/2026-09-29-report.md
- ADR-0091：docs/adr/0091-architecture-grill-round-90-dsh-native-tool-plane.md
- 任务书：.scratch/grill-round-90/handoffs/next-round.md（注意：终态戳 sha 为 pre-restack 旧值，以 closeout 双锚为准——审计发现项 2）
- registry：docs/deferred-registry.json（native-tools→closed；defer-r72-dsh-approval-channel 新条目；matrix 收窄）
- 证据：.scratch/grill-round-90/evidence/（t0-* t2-expected-red t3-green t3-bundle-hygiene t5-approval-surface t7-*）

## 若继续此线，必知事实

- 子代理通道本窗不可用（Agent 工具 max_tokens 平台错，Explore/general-purpose 两型同错）——下窗如需并行取证，先试一枚探针子代理，失败即主窗口串行。
- 轻微发现四项待顺手（不阻塞）：ship-gate.mjs:514 正则 s*→\s* 修补；next-round.md 终态戳 sha 改齐；registry carried_log R90 行 restack 注记；WORKFLOW.md §4.2 补件（外部）。
- GitButler amend 滚 sha 教训已立法：committed 文内 commit 引用一律 but-id+sha 双锚。
- dsh 原生面事实（承 closeout）：裸 ToolDefinition 注册五 ans_*；execute=callServer→ans-mcp HTTP /mcp（握手缓存按 base+token；-32001/-32600 重握手一次；fail-open 空 content；isError 物化 throw）；ans-mcp 须 --transport http 常驻才有工具执行面；plugin server(33333) 只管钩子/policy 面。
- 本机 User 级 ANYSEARCH_ENDPOINT 指向 127.0.0.1:20128/mcp 重定向仍在（ADR-0082 迁移态）——search_web 实测走该端点，dead 时回 canonical 空结果。
- 真链路复跑方法（审计窗已验证）：起 ans-mcp（--transport http --port 39999）+plugin server，mock-ctx import built lib/index.js apply() 后调 def.execute——driver 模板见审计窗会话临时区（不入库），按需重建。

## 下轮候选（维持 closeout 三候选，未立项）

1. approval-channel 交互面验证轮（defer-r72-dsh-approval-channel，上游依赖已解除）。
2. dsh 0.2.0 stable 晋升目击→TC 收口探针（每轮 T0 npm view dist-tags 复观）。
3. 原生工具面 dsh 实机冒烟（L3 --profile 彩排）。

## Suggested skills

- 立新轮：$grill-me 或 $grill-with-docs（定形后 $to-spec → $to-tickets → $implement）
- 实施/评审：$implement（tdd at seams）、code-review（双轴）、gitbutler（全程版本控制）
- 上游观测：atomcode-research（0.2.0 stable / changelog 面世信号）
- 再交接：handoff
