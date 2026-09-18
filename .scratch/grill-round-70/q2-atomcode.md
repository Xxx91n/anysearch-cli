# R70 Q2 AtomCode 调研存档 — completion 时钟锚点裁决

日期 2026-09-18 · atomcode resume id: e708f061-3450-43c5-b240-d5a9d1e2cccf

## 执行摘要

裁决：Option A（timeout-min 从进程起点计的总量锚）+ Option D 的错误信息拆分并入 A 落地。Confidence 高。

## 四轴辩证

1. lewagon 契约保真（决定性轴）：action.yml 全文实证——lewagon 只有 checks-discovery-timeout（default 60s）一个时间输入，completion 段在 action 层无超时参数，靠外层 job timeout-minutes 兜底。真实契约形状=discovery 嵌套快败子窗+completion 外层总钟，正是 A。B 是唯一真正偏离其宣称契约的选项。
2. deadline 语义（pvk.ca + NILUS）：外层绝对 deadline、内层嵌套阶段预算；事件发生时重置锚=反模式（中间流逝时间逃出核算）。Temporal start_to_close+schedule_to_close 双预算=C 的形状，但那是分布式每阶段独立远程操作场景；单进程两段谓词下阶段预算=总预算-已耗，天然成立。
3. fail-closed 纪律：A 保 publish 前置等待≤10min 硬承诺；B 最坏 12.2min 静默破坏，且可能与外层 step timeout-minutes 撞车产生混乱外层失败。
4. over-engineering：五 family 每 push 近即时注册，120s 只是事件投递抖动天花板非耗时常态；--completion-min 对单用途固定 5-family 脚本=YAGNI。C 升格触发器写入 ADR：discovery 常态>30s 或 completion 预算真实吃紧事故。
5. D 单独不够，但错误行拆分（phase 标注+missing/present 分列）随 A 一起落地。

## 子问题裁决：严格 all-5-families discovery 正确

- GitHub 官方文档：原生 paths: 过滤被跳过的 workflow 根本不创建 check-run（required check 永 pending——monorepo 痛点，community #44490 原文）。
- 标准 workaround=N+1 stub workflow：不被 path 过滤的壳 workflow+条件置 skipped——本仓 memory-eval 步级过滤正是此模式产物。
- 严格谓词前提是仓库自选不变量：「每个 required family 必有壳保证注册」——须入 ADR 显式 invariant；若未来改回原生 paths: 过滤则严格 discovery false-fail。
- lewagon fail-on-no-checks default=true，false 是 conditional check 的显式 opt-in；发布闸 5 family 全 required，opt-out 不适用，缺失即阻塞是正确失败模式。

## 信息缺口

- lewagon completion 无内建超时→run bound 由使用方 job timeout-minutes 承担（action.yml 反推，未逐行读 entrypoint.rb——不影响方向）。
- 「5 family 近即时注册」是内部运行事实外部不可验；建议 ADR 附近 30 次发布 check 耗时分位数作证据（若 memory-eval/test:online p99≈8min，A 尾部侵蚀从理论变现实）。

## 落地建议

Phase 1 严格谓词+120s 快败+exit 2 分列 missing/present；Phase 2 process-start+timeout-min 绝对 deadline+terminal-allowed 短路；ADR 记录 stub-registration 不变量+C 升格触发器；错误行按 phase 拆分。

## 来源

1. lewagon/wait-on-check-action action.yml（全文）
2. lewagon README（全文）
3. GitHub workflow syntax 官方文档
4. GitHub Community #44490（原文）
5. pvk.ca Specify absolute deadlines not relative timeouts（全文）
6. NILUS Distributed Deadline Propagation
7. Temporal Timers Timeouts and the Art of Waiting
8. 本仓 CONTEXT.md+release.yml（ctx 召回）
