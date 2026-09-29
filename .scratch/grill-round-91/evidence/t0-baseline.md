# T0 证据档 — 哨戒续班+宿主备版

时间戳: 2026-09-29T18:37+08:00

## T0a — dist-tags 复观（一次定死 TC 启停窗口）

命令: `npm view @deepseek-ai/dsh dist-tags`
输出:
```
{ alpha: '0.1.7-alpha.2', latest: '0.1.7-rc.2', next: '0.2.0-rc.2' }
```

其他包复观:
- @deepseek-ai/dsh-tools: { latest: '0.0.1-rc.1', alpha: '0.1.7-alpha.2', next: '0.2.0-rc.2' }
- @deepseek-ai/dsh-agent: { latest: '0.1.0-rc.6', alpha: '0.1.7-alpha.2', next: '0.2.0-rc.2' }
- @deepseek-ai/dsh-session: { latest: '0.0.1-rc.1', alpha: '0.1.7-alpha.2', next: '0.2.0-rc.2' }

**TC 窗口判定**: 0.2.0 stable 未目击 -> **TC 不启，不留痕**（D-003 §TC 条件票）

## T0b — 本机 dsh 版本升级

升级前版本: 0.1.5-rc.3
命令: `npm install -g --prefix C:/Users/Administrator/AppData/Roaming/npm @deepseek-ai/dsh@0.1.7-rc.2` <!-- machine-local: global npm prefix path @ 2026-09-29 -->
升级后验证: `dsh --version` -> 0.1.7-rc.2 ✓

安装产出警告（无阻断）:
- node-domexception@1.0.0 deprecated (use platform native DOMException)
- 3 packages with install scripts not covered by allowScripts:
  @deepseek-ai/dsh-subprocess-local (postinstall: ensure-spawn-helper.mjs)
  @google/genai (preinstall: no-op)
  protobufjs (postinstall)
  -> postinstall 未执行; spawn-helper 可能影响 headless 执行; 录入挂账候选

## T0c — 基线快照

### pnpm -r check
命令: `pnpm -r check` (Scope: 8 of 9)
结果: 全 8 包 tsc --noEmit Done ✓

### pnpm -r test
命令: `pnpm -r test` (Scope: 8 of 9)
结果: EXIT null（全部通过）
代表性 PASS:
- eval-abstain: 13 passed, 0 failed
- eval-gate.test.ts: 23 passed, 0 failed
- eval-docs-golden.test.ts: 113 passed, 0 failed
- eval-holdout-gate.test.ts: 31 passed, 0 failed
- eval-judge.test.mjs: 5 passed, 0 failed

### node scripts/ship-gate.mjs --quick
命令: `node scripts/ship-gate.mjs --quick`
结果: EXIT 1（预期）
唯一 fail:
  [fail] ADR-0081 D-004: CHANGELOG.md has no '## ' entry referencing r91 — T5 收口时补
所有其他腿 pass（含 ADR-0073/ADR-0091 dsh-plugin churn lint）