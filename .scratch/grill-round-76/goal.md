# Grill Round 76 — Goal（定稿态）

Date: 2026-09-22. Ledger: `decision-ledger.md`（D-001~D-005 全 current）。定稿已获用户确认。

## 本轮主题（D-001）

**「治理面静默漂移」清算轮**——两件同构失效模（治理机器自己的 silent-drift）同轮清算：

1. `defer-r71-shipgate-1g-coverage`：ship-gate step 1g closeout standing-leg 的 fallback 挑「最新含 closeout 的 round dir」即 break——最新 round 无 closeout 时静默回退旧 round 报绿（R70 F1 原形，registry 明示不得再静默飘过，已四轮）。
2. `docs/deferred-registry.json` 格式锁：外部进程/编辑工具两次整文件重排（1→8、1→4 空格），每轮人工恢复最小 diff——立 fail-closed canonical 断言。

## 裁决摘要（账本为准）

- **D-002**：1g 修复=A+——完成信号=`docs/adr/index.md` 登记 `Grill Round N`；fail-closed 三断言（已登记 N≥floor 无 closeout→红 / index↔目录双向漂移→红 / 推导集合空→红）；floor=76 写入 ADR-0077；在飞豁免打印结构化结论；known-bad fixture+覆盖计数。
- **D-003**：格式锁=A+——step1 内 `stepGovernedJsonCanonical()`，字节全等断言，硬编码 `CANONICAL_JSON_FILES`（n=1），不自修附 normalize 指令，registry `note` 字段写锁定声明。
- **D-004**：T0 锁先行（T2 还要再编 registry，锁先立有因果收益）→T1 1g 主体→T2 文书收口。
- **D-005**：三段收口（锁段双向行使实证 / 1g 段三断言全行使 / 文书段）。

## 显式范围外（落选债原名续 deferred，T2 记显式续债条）

`defer-r71-transformers-undeclared-dep`（上游 #1764 仍 OPEN 阻塞中，观察哨续挂）· `defer-r73-dsh-event-rename`（0.1.6-rc.1 未发）· `defer-r74-logo-bitmap-matrix`（imagegen 缺席）· `defer-r75-registerhooks-esm-arm`（三触发器均未响）· `defer-f16-macos-native-crash` / `defer-f17-quarantine-ids` · `defer-r71-provider-serverside` · `defer-r72-dsh-*` 三件套 · `defer-anysearch-domain-ownership`。外发闸（drafts/pr-1764-comment.md+issue-1087-comment.md）=用户动作项非本轮题。prettier 引入/JSON5/contiguity-only/全量重 lint/hook 路线均显式否。

## 路径纪律自证

本目录全部文档 repo-relative；无机器绝对路径落档（fixture/临时脚本均机器临时目录不提交）。

## 遗留呈报项（T2 收口时列入 handoff）

- `#1764` merge 观察哨续挂（2026-09-22 实查 OPEN，updatedAt 2026-09-03）。
- 外发闸：两份评论文稿仍「待用户发」状态，发后回录链接到 drafts 头部 Status 行。
- `origin/r71-grill` 已消失事实已于 R75 核销，无新增远端 housekeeping 项。
