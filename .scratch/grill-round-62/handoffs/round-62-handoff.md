# Round-62 → next-round 交接

Stack (primary key = GitButler change-ids; SHAs are time-lagged per
docs/agents/handoff-template.md — absorb/amend/reword 已多次重写 SHA，
引用 but-id 勿引 SHA):

  r62-t1-provenance → r62-t2-offline-leg → r62-t3-optional-embedding →
  r62-t4-teardown-macos-probe → r62-t5-offline-governance →
  r62-t6-golden-executor → r62-t7-span-passthrough → r62-t8-tavily-probe →
  r62-t9-docs + r62-t9-chore-version-pin + r62-t9-chore-help-flag

## 已完成（T1–T9 全票）

- T1 provenance 修：g0007 ref 指已跟踪 ADR-0060（灭 check-build 全 OS 红）
- T2 install-smoke 离线腿：ANYSEARCH_ENDPOINT env + 死端口 + --json
  abstain/providersFailed/results 三断言（exit-0 契约替换 exit-1）
- T3 embedding→optionalDependencies：守卫式动态 import（embedding-arm.ts
  叶模块）、三 bundler external、doctor SKIP 行、install-smoke 净装腿
  断言无 onnxruntime-node/transformers/embedding；ADR-0033 D2 revised
- T4 teardown.ts 纯叶 + index.ts 显式 close→exitCode→unref；ship-gate
  阻塞矩阵摘 macOS + 非阻塞 macos-spillover-probe job（签名进 summary）
- T5 ship-gate 四静态断言：OFFLINE_EXCLUDED_GROUPS 治理（恰 [semantic]，
  覆盖≥0.75 实测 0.984，ci.yml test-online 存在）
- T6 golden 双层执行器：golden.scopes sidecar（显式 stub|live|both）；
  kernel/test/eval-looks-stub.test.ts 41 断言（夹具取 badcase observed
  非 expected）；store/test/online/eval-looks-live.online.ts 真 bin 硬断言；
  10 条 provider-drift 入 eval-quarantine.json（30d TTL）
- T7 PiAgentRuntimeOptions.span + createSearchTool 透传 + ans-chat
  observeTool (span) 接线；pi-runtime-span.test.ts 8 断言
- T8 tavily 判据5：A/B/C PASS（0/10 泄漏、子域双向）、D INCONCLUSIVE；
  账本 .scratch/grill-round-62/tavily-probe-ledger.*（key:set 不明文）
- T9 ADR-0063 定稿 + README Known Limitations + handoff 模板 + 5 chores
  （pin 0.0.1 硬断言/--help flag/outcome 措辞 E1/hash 时滞/双 schema E2）

## 绿色 run URL（必填）

PENDING — r62 栈未推送。workflow run 不存在；本地证据：
`node scripts/ship-gate.mjs` 9/9 全绿（可复跑）。推送后回填本栏 +
ADR-0063 Closure evidence 表。

## 下一轮候选

1. **推送 + CI 见证**：`but push`（需用户点头）→ ci + ship-gate 双 run
   全绿后回填 ADR-0063 Closure evidence 与本栏 → npm 0.0.1 go/no-go 终审
2. **macOS 探针 TTL**：macos-spillover-probe ≥5 连绿 → 恢复阻塞矩阵腿
   + 评估 onnxruntime≥1.24.1（ADR-0059 D4③）；仍崩 → defer-f16 续期
3. **quarantine 评审**：eval-quarantine.json 10 条 7 日评审时钟——
   provider 稳定或 expected 重采后 promote/retire
4. **gh secret set TAVILY_API_KEY**：CI test-online 腿要 key——外部副作用
   需用户当场点头（D-008 明文禁令）

## Known risks / deferred

- live 层 mustHitUrl 断言天然脆（provider 版本路径漂移）——10/14 隔离
  中，strict 断言保留，TTL 评审
- macOS 崩溃根因可能在 better-sqlite3/libuv 内部序——探针观测中，
  阻塞矩阵不含 macOS
- absorb/amend 已重写 nmo/lsk/mmx/wpn/zzk 的 SHA——r61 报告中的
  c595792 等 SHA 引用已时滞，一律以 but-id 为准

## Suggested skills

- `$implement`（若推下一轮票）· `$handoff`（交接时）· `atomcode-research`
  （调研优先）· `codegraph`（代码探索）
