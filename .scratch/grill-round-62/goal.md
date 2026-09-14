# /goal — Round-62 fixer 轮（防止目标丢失）

**日期:** 2026-09-15
**身份:** 修复子 Agent（fixer）
**目标:** 完整执行 `.scratch/grill-round-62/handoffs/next-round.md` 的 fixer 任务表 T1→T9 串行：T1 docs-g0007 出处一行修 → T2 install-smoke 离线腿（ANYSEARCH_ENDPOINT） → T3 embedding 降可选 → T4 F1 teardown 修 + macOS 探针臂 → T5 ship-gate 静态断言四件 → T6 golden 双层执行器+scope → T7 pi-runtime span 透传（F3） → T8 tavily 探针回填判据5 → T9 README/ADR-0063/handoff 模板收口。逐票独立验收，每票一 but 分支、票号中文 commit，覆盖账本 D-001..D-011。
**验收标准（用户原文）:** 编译通过、打包通过、启动并测活软件进程；每个平台都要有 test 闭环，避免只引入却没做到。
**验收总闸（D-009 收口判据）:** main tip 上 ci + ship-gate 双 workflow run 全绿（ship-gate macOS 腿按 D-007 探针语义：探针绿计入、仍崩不计阻塞但结果必须落盘）；绿色 run URL 写入 Round-62 ADR 证据栏与 handoff；`gh run list` 一条命令可复验。终点 = npm 0.0.1 发布 go/no-go 显式拍板（D-001）。
**硬约束:** 账本冲突不改向——标 revised + 新 D-xxx 呈报用户；禁 while-you-are-there 顺手改（ADR-0029）；禁按 expected 构造 stub 输入（D-006）；零新 npm 依赖（D-002/D-005/D-006/D-011）；key 不明文（D-008：TAVILY_API_KEY 在用户环境变量 `1`，程序化读取禁 echo/落盘/进 git）；不动 better-sqlite3 pin 与 allowBuilds=false（D-002/D-007）；探针臂 TTL 制禁无限期挂、禁工作流级静默跳过（D-007）；live 层不挂 ship-gate --offline 路径（D-006）。
**偏好:** atomcode-research 联网调研（工业级成熟轮子优先，不自研）；每票先写失败测试再修（tdd 接缝点）；Ponytail full 模式（remove-or-implement）。
**版本控制:** GitButler 虚拟分支、每票一独立分支、禁裸 git 写命令、不 push 不 PR、commit 中文带票号、哈希以 git log 实物为准。
**交付:** 报告 `.scratch/grill-round-62/reports/`（每条声明附可复跑证据）+ handoff + ADR-0063（T9）。
**已读:** next-round.md / decision-ledger.md(D-001..D-011) / q2,q4,q5,q5b,q6,q7,q11-atomcode.md / ADR-0033,0057,0059,0060,0061,0062 / CONTEXT.md。
**已完成:** （待填）
**未解决/待 brain 决策:** T1 出处指向哪个已跟踪文件（票内裁决）；T8 的 `gh secret set TAVILY_API_KEY` 把 key 推上 GitHub 属外部副作用需用户当场点头；macOS 探针结果未定（B 方案先验推断，失败即回落剪枝+H3 台账，D-007 已预注册）；npm go/no-go 本体属实现后终审（非本票范围）。
