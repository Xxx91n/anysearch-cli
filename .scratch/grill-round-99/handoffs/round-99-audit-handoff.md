# Handoff — Grill Round 99 审计窗 → R100（审计结论 + 下一轮 grill 方向指示）

Stack: r99-vocab-expansion (GitButler change-ids; 8 commits, unpushed / unlanded @ 2026-10-06)
<!-- state: unpushed r99-vocab-expansion @ 2026-10-06 -->

## 1. 审计结论

**LOOP0 结论：REJECT / 打回返工**
初次审计命中 2 处硬违规 + 1 处硬验收阻断：
1. **A1 (ADR-0100 D4 违背)**：`probeVocabGuards` 枚举面遍历 `Object.keys(GOVERNED_MODULES)` 硬编码键表，脱离生产扫面枚举面，违背同源契约与禁止代表模块抽样注入的规定；
2. **A2 (Fail-Closed 违背)**：`enumerateScriptFiles` 吞没 `fs.readdirSync` 异常返回空数组，导致不可读目录假绿；
3. **A3 (硬验收阻断)**：`node scripts/ship-gate.mjs` 在 Windows 并发环境因跨包测试争用触发 SQLite 锁与进程创建冲突退出（Exit 1）。

**LOOP1 结论：PASS（审计通过）**
原修复窗口提交 `51b34da4` (`vxz`) 完成整改，审计窗口亲自重跑全套硬验收及实物抽查，全部确认闭环：
1. **A1 探针枚举同源**：`probeVocabGuards` 改为动态消费 `scanVocabGuards({ root }).scanned` 中 `codes > 0` 的词表承载模块，生产扫到什么，证伪注入就点名什么；`handoff-lint-e2e.test.mjs` 增补同源断言。
2. **A2 扫面 Fail-Closed 补正**：`enumerateScriptFiles` 改为抛出异常，`scanVocabGuards` 捕获并生成致命 finding（`scan-surface-unreadable`）且 `ok: false`；`handoff-lint-e2e.test.mjs` 增补异常目录红灯断言。
3. **A3 并发竞争工程化稳定**：`scripts/ship-gate.mjs` step 3 与根 `package.json` 引入 `--concurrency=2`，成功消除 Windows 下跨进程 SQLite 锁冲突与 Worker 崩溃。
4. **Smells 清理**：`loadScriptModule` / `errText` 单一路径收敛；`unregisteredCodeExports` 参数注释澄清。

## 2. 硬验收亲自重跑实测数据（全绿）

- **编译（Compilation）**：`pnpm turbo run check --force` → 8 successful / 8 total, 0 cached, 耗时 23.9s，全包 TypeScript 强制无缓存编译全绿。
- **打包（Packaging）**：`pnpm pack` 产出所有子包 tarball，文件大小与 manifest 完整。
- **启动测活（Startup & Liveness）**：
  - MCP stdio `initialize` 握手成功：`server=anysearch v0.1.0`, protocolVersion `2025-06-18`。
  - Scrubbed env 环境下 `ANYSEARCH_FAIL_OPEN` 启动测活成功：fail-open boot 握手全绿。
- **完整船闸（Ship-Gate Suite）**：
  - `node scripts/ship-gate.mjs` → **EXIT=0**，输出 `[pass] ship gate green — ready to tag the next release`（覆盖 step 0~9 全流程，enforcement-anchors 5/5 pass，handoff-lint 验证通过）。
- **锚验证（Enforcement Anchors）**：`runEnforcementAnchors` → 5/5 anchors consumer-verified；`anchor:vocab-guards` 成功验证动态扫描面；`anchor:ratchet-recount` 保持全量 kill 判定。
- **断言数（Monotonic Ratchet）**：
  - 真值表 (`handoff-lint-verdict.test.mjs`)：463 passed, 0 failed（只升不降）。
  - E2E 门禁 (`handoff-lint-e2e.test.mjs`)：由 389 升至 **394 passed, 0 failed**（新增 5 条断言锁定 fail-closed 致命 finding 与探针同源注入）。

## 3. 必须单独呈报 Owner 事项（审计不代为追认）

- **四钉演练发现的 open seat loophole**：
  在 `packages/store/test/handoff-lint-e2e.test.mjs` 的四钉对抗演练中确认：`forged-seat-holds-decorative-open=true`。即当坐席条目处于 open 状态时，可以把一个未被杀死的装饰性锚降级为非阻断 skip；关闭坐席后立即复红（`seat-closed-re-reddens=true`）。
  此项虽符合 ADR-0099 D4 既有设计意图（观察不缺席、坐席即降级可见），但属于治理机制层面的逃逸隐患。审计窗口不代为追认，呈报由 Owner 裁定是否允许将该治理点延后至 R100。

## 4. 下一轮 Grill 方向指示（R100 候选方向）

1. **候选方向 1：收敛装饰锚 open seat loophole**
   对 open 状态坐席增加生存期限制、严格校验或警示收紧，防止装饰锚长期借坐席逃逸阻断。
2. **候选方向 2：`scripts/tau/` 子目录递归入域**
   将开放面扫面从顶层 glob 进一步扩展至递归子目录扫描，完成更彻底的无死角覆盖。
3. **候选方向 3：受治模块顶层零副作用独立机检**
   建立静态 AST 扫描规则，对 scripts 目录下的库模块进行顶层副作用自动化校验，防止未来新增脚本在导入时产生非预期副作用。

## 5. Suggested skills

- `gitbutler`：全套版本控制；未获得 Owner 显式授权前，保持分支 unpushed / unlanded。
- `tdd` / `code-review`：下轮（R100）特性开发与双轴审查。
- `handoff`：会话收口与下轮交接。
