# Handoff — Grill Round 99 → R100 收口

Stack（primary key = GitButler change-ids；SHA 为 capture 时值，time-lagged）：
  r99-vocab-expansion → ruy (`e9b888d4` @ 2026-10-05) → zyk (`16205b9d` @ 2026-10-05) → usr (`9ffdfc47` @ 2026-10-05) → pzr (`759fe259` @ 2026-10-05) → zst (`1d759e81` @ 2026-10-05) → qlx (`e5d40d8d` @ 2026-10-05) —— 即 `r99-vocab-expansion` tip；未 push（无 origin ref）、未 land、未 tag、未 publish

## 已完成

- **T0 定锚 + 残留轨**：`.scratch/grill-round-99/goal.md` 落盘（正题+范围外+风险登记三件+`no-changelog-entry` 声明）；CI 观测注记沿账（HEAD b3ca0d51 三绿：run 37195788023/37195787979/37195787971）；`anchor:ratchet-recount` 坐席关票（零代码改动，单变量验收场先落）。
- **T1 立法包**：ADR-0100（六 Decision + 两块预写：首抓真 RED 解读纪律 / 四级迁移阶梯次序硬约束）+ CONTEXT「Grill Round 99 — Terms」七词条。
- **T2 正题实现（四级迁移阶梯）**：`vocab-registry.mjs` 纯数据叶 → `(ns,registry)` 签名泛化 → CODE_GROUPS 迁出 verdict（零 import 纯核保持）→ `vocab-scan.mjs` 薄壳两相枚举 + `probeVocabGuards` 逐模块证伪 + 扫面外三导出入册 + 锚表 constraint/subject 扩域语义。
- **T2 顺手段落（并入验收段）**：「探针无孤儿」反向断言 + 四钉对抗演练（探针名伪造 / 坐席伪造开 / 坐席关后复红 / 空注册表）逐条验证（结果具名呈报）。
- **T3 簿记**：CHANGELOG r99 节（feat/fix/docs 分行）；deferred 两票关闭（ratchet-recount 坐席 / open-surface-demo）；ADR index 再生成（100 件）；AGENTS.md 顶层零副作用摘要指向 ADR-0100。

## 绿色 run URL（必填）

PENDING: stack-unpushed — 本轮无 push/land（owner 授权窗未开），`r99-vocab-expansion` 无 `origin/` ref，run-URL 无法兑现

## 下一轮候选

- R100：递归入域（`scripts/tau/`）开放面后续票；B 残余（检测器自指第三轮）余量。
- 四钉对抗演练发现的坐席 loophole（开着的坐席可掩盖装饰锚，关闭即复红）——已在轮报具名申报，R100 可议。

## Known risks / deferred

- 递归入域未做（`tau/` 不入域，实测零 `*_CODES` 无差）。
- 顶层零副作用纪律靠受治模块自律（本轮无独立机检；两相枚举把执行面收窄至词表承载模块）。
- 坐席 loophole：open seat 可掩盖装饰锚（关闭即复红）——已知设计边界。
