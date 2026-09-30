# T0 基线快照（dsh dist-tags 哨戒 + check/test/ship-gate）

时间戳: 2026-09-30 | 覆盖: D-001 / D-003 | commit 类型: chore+evidence

## 1. 哨戒 — dsh dist-tags 复观（TC 窗口一次定死）

命令与输出:

```bash
$ npm view @deepseek-ai/dsh dist-tags --json
{ "alpha": "0.1.7-alpha.2", "latest": "0.2.0-rc.2", "next": "0.2.0-rc.2" }

$ npm view @deepseek-ai/dsh versions --json | tail -8
[... "0.1.7-rc.1", "0.1.7-rc.2", "0.2.0-rc.1", "0.2.0-rc.2"]

$ npm view @deepseek-ai/dsh-agent dist-tags --json
{ "latest": "0.1.0-rc.6", "alpha": "0.1.7-alpha.2", "next": "0.2.0-rc.2" }

$ dsh --version
0.1.7-rc.2
```

**TC 判定：未目击 0.2.0 stable。** `latest` 与 `next` 同为 `0.2.0-rc.2`，无 `stable` tag，`0.2.0` 系列仅 `rc.1`/`rc.2` 两个预发布版本。
按任务书「TC=T0 目击 dsh 0.2.0 stable 才启」——**TC 不启、不留痕**，判定窗口本轮一次定死不再复观。

宿主维持 `0.1.7-rc.2` 不升不降（goal.md 冻结项；版本轴与消费轴正交）。

## 2. 幂等声明：本仓 npm 包 dist-tags（非宿主）

```bash
$ npm view @anysearch-cli/dsh-plugin dist-tags --json
{ "latest": "0.1.0" }
```

宿主真包名为 `@deepseek-ai/dsh`（非 `dsh`——`dsh` 在公共 registry 已被无关第三方占用，latest=1.0.1，**非本轮宿主**，已排除该误判源）。

## 3. 基线三腿

| 腿 | 命令 | 退出码 | 摘要 |
|---|---|---|---|
| check | `pnpm run check` | 0 | `Tasks: 8 successful, 8 total / Cached: 8 cached`（tsc --noEmit × 8 包） |
| test | `pnpm run test` | 0 | `Tasks: 13 successful, 13 total / Cached: 5 cached / Time: 4m28.111s` |
| ship-gate --quick | `node scripts/ship-gate.mjs --quick` | 1 | 唯一 fail：`ADR-0081 D-004: CHANGELOG.md has no '## ' entry referencing r93` |

**ship-gate 单一 fail 归因（预期内、非回归）**：本轮 CHANGELOG 条目属 T6 分节④ 尚未落笔，T0 时刻必然缺 r93 条目。
该 fail 由 T6④ 消解；T0 记录为**基线已知项**，不构成阻断。ADR-0073/0091 dsh-plugin churn lint、access-events chain、quarantine ratchet 等全部 [pass]。
完整日志：`t0/check.log`、`t0/test.log`、`t0/ship-gate-quick.log`。

## 4. 干净树前置校验

```bash
$ git status --porcelain
(clean)
```

ship-gate step 0 的 clean-tree 不变量要求工作区干净；T0 证据写入前先校验 porcelain 为空，
证据文件均在门禁跑完后落盘（不污染门禁读数）。

## 5. WORKFLOW.md 缺位声明（第九次先例核销）

```bash
$ find . -maxdepth 4 -iname "*workflow*"
./.github/workflows   ./scripts/check-workflows.mjs   （无 WORKFLOW.md）
```

本仓不存在 `WORKFLOW.md`，其 §4.2「版本控制外部承诺」自 ADR-0092 起由 GitButler skill + 全局 but 协议等价覆盖
（R60/R70/R75/R77/R78/R79/R81 已 7 次先例核销，本轮为第 8 次独立复核，结论一致）。
