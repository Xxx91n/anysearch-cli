# T0 证据档 — 哨戒续班+基线快照

时间戳: 2026-09-30T08:45+08:00

## T0a — dist-tags 复观（一次定死 TC 启停窗口）

命令: `npm view @deepseek-ai/dsh dist-tags`
输出:
```
{ alpha: '0.1.7-alpha.2', latest: '0.2.0-rc.2', next: '0.2.0-rc.2' }
```

其他包复观:
- @deepseek-ai/dsh-tools: { latest: '0.0.1-rc.1', alpha: '0.1.7-alpha.2', next: '0.2.0-rc.2' }
- @deepseek-ai/dsh-agent: { latest: '0.1.0-rc.6', alpha: '0.1.7-alpha.2', next: '0.2.0-rc.2' }
- @deepseek-ai/dsh-session: { latest: '0.0.1-rc.1', alpha: '0.1.7-alpha.2', next: '0.2.0-rc.2' }

**TC 窗口判定**: 0.2.0 stable 未目击（latest 与 next 均为 rc 版本 '0.2.0-rc.2'，无 stable 晋升） -> **TC 不启，不留痕**（D-001/D-003 §TC 条件票，一次定死）。

## T0b — 本机 dsh 版本确认

版本命令: `dsh --version`
当前版本: `0.1.7-rc.2`（不升不降，保持与 R91 同环境连续性及钉版契约）。

## T0c — 基线快照

### pnpm -r check
命令: `pnpm -r check` (Scope: 8 of 9 workspace projects)
结果: 全 8 包 tsc --noEmit Done ✓

### pnpm -r test
命令: `pnpm -r test` (逐包全部执行通过)
- packages/kernel: PASS in 9.2s
- packages/store: PASS in 126.4s
- packages/embedding: PASS in 1.1s
- packages/retriever: PASS in 2.5s
- apps/plugin: PASS in 7.9s
- apps/dsh-plugin: PASS in 2.3s
- apps/mcp: PASS in 5.2s
- apps/cli: PASS in 16.6s
结果: 全部包测试通过，无失败用例。

### node scripts/ship-gate.mjs --quick
命令: `node scripts/ship-gate.mjs --quick`
结果: EXIT 1（预期基线态）
唯一 fail:
  [fail] ADR-0081 D-004: CHANGELOG.md has no '## ' entry referencing r92 — current round is .scratch/grill-round-92; add the round entry or declare 'no-changelog-entry: <reason>' in goal.md
所有其他腿 pass（含 ADR-0073/ADR-0091 dsh-plugin churn lint、pathlint 等）。
