# ADR-0021: Architecture Grill Round 18 — MemoryPipeline Deepen + Threshold Injection + Ship-Gate Evidence Persistence

### Status
Accepted. Amends ADR-0016（D2 pure-function `consolidateState` 签名扩展）与 ADR-0020(D1 ship-gate.mjs 增加 step 1.5 + JSON evidence 落盘；主体不变）。

### Context

ADR-0020 落地 ship-gate.mjs 5 步主闸门后，`packages/kernel/src/memory-pipeline.ts` 仍存在两类与 ADR-0020 心智不一致的痕迹：

1. **voodoo constant**:`LOW_WATERMARK_TOKENS=128000`(:119)与 `consecutiveReuses>=3` (:130,ADR-0013 D8)硬编码在 consolidateState 纯函数内。前者对 1M 上下文窗口过激（12.8%)触发，对 128k 窗口几乎每轮触发，LangWatch 2026-08 实证明确两头都错（低于 110k 失效线附近、高于 60-75% 推荐区间）。后者行业内无任何公开先例可作对照。
2. **LLM/anchor I/O 直连**:`generateSummaryWithUsage` 仍在 :268 从 `@earendil-works/pi-agent-core` 直接 import 并调用；anchor 读写通过 `store.getAnchors` 散在类壳内。是 ADR-0016 已启动"纯函数化"的尾巴。
3. **ship-gate.mjs 仅打 stdout，不落盘 JSON**：无法事后审计、CI artifact 层缺位，违反 Humble/Farley/SRE/Turborepo 的三层证据结构共识。
4. **domain TOML schema 无运行前校验**：用户写错 `lowWatermark` 的 TOML 时只能在 consolidate 触发时炸出，commit 前无 fail-fast 卡点。

Grill Round 18 在 four questions、三次 atomcode 串行调研、四个用户 approve（全选 A）后落地本 ADR。

### Decision

**D1（阈值注入先行 DomainConfigPort.compaction）**
`DomainSchema.CompactionConfig` 在两个文件扩两个可选字段：
```ts
interface CompactionConfig {
  model?: string;
  lowWatermark?: number | { fraction: number };  // 0.7 ≙ frac，绝对数覆盖业界约定
  reuseCap?: number;                              // 连续 REUSE 上限，默认 3
}
```
`DomainConfigPort.compaction` 镜像同一类型（单点类型一处定义，两处引用，避免 port/schema 漂移）。`RawDomain` 同步。`resolve()` 现有 deep-merge 对新增字段零改动（`[compaction]` 段继续遵循 replace 语义）。

- 默认值 `{lowWatermark: 128000, reuseCap: 3}` 保留现值即默认 → **零行为变化**；现有 15 个 D9 相关断言零破坏。
- "占比为默认、绝对可覆盖"对齐 OpenAI DynamicCompactionPolicy(0.9)/StaticCompactionPolicy 双形态、LangChain PR #33825 (`trigger=("tokens"|"messages"|"fraction")`)、Claude Code (`75% 占用 + CLAUDE_CODE_AUTO_COMPACT_WINDOW`)。
- 区间守护：fraction 要求 (0,1),lowWatermark 绝对数要求 >= 50000（对齐 Anthropic 50K 硬下限）；超出范围 → failfast(Ousterhout fail-fast 原则），不静默回退。

**D2（`consolidateState` 函数签名扩展、类内不留 voodoo)**:
```
consolidateState(state, messages, totalTokens, hasRetrievalEvidence,
                 opts?: { lowWatermark?: number; reuseCap?: number })
```
`- LOW_WATERMARK_TOKENS=128000`、`- consecutiveReuses>=3` 从 `memory-pipeline.ts` 正文删 —— 改 `opts?.lowWatermark ?? 128000` / `opts?.reuseCap ?? 3`；管道壳在调用处从 `domainConfig.compaction` 解析后注入。

**D3(ship-gate.mjs step 1.5 Schema-Validate in Acceptance Stage)**:
新建 `scripts/validate-domains.mjs`（同一 Node stdlib-only 原则）:
- 扫 `domains/*.toml` → 对每文件调用 `resolve()`(via `packages/store/src/domain-schema.ts` 的 build 输出或 esm child)，再用 zod 校验 `CompactionConfig` 类型契约
- 错误（配置文件语法、循环继承、`lowWatermark` 小于 50000、fraction 不在 (0,1)、reuseCap <1)→ **exit 1** 并输出具体文件+行号
- 在 ship-gate.mjs step 1(rg 静态断言）后、step 2(turbo check/test/build）前执行 → **commit 前被拦**
- 若 domains/*.toml 不存在 → SKIP（不当作 failure)

**D4(ship-gate Evidence JSON Persistence)**:
`scripts/ship-gate.mjs`：
- `report()` 旁维护一个内存 `ReportEntry[]`（每 step 的 status/duration/assertions)
- 结束时 `fs.writeFileSync(".ship-gate/report.json", JSON.stringify(entries, null, 2))`
`.gitignore`:`+ .ship-gate/`(1 行）
`.github/workflows/ship-gate.yml`：尾增 5 行 upload-artifact(`if: always()`,artifact 名 `ship-gate-${{ matrix.os }}`,path `.ship-gate/`)
**三层结构(stdout=Layer 0,report.json=Layer 1,upload-artifact=Layer 2)**:
- 不引入 Layer 3（产品级 CI UI 面板，如 GitLab merge widget / dashboard）——单人种子阶段 YAGNI
- 不把 `.ship-gate/report.json` 提交进 git——GitHub artifact 有保留期 + attestation，进 git 反而污染历史并撞合并冲突
- CircleCI `store_test_results` 禁 hidden folder 是外部生态负担；我们当前只在 GitHub Actions，`upload-artifact` 对 `.ship-gate/` 隐点目录无痕 → 接受
- `actions/upload-artifact` 的 Permission Loss(755/644 归一化）对我们场景无影响（report.json 无需 exec 位）

**D5(ADR-0016 port 深化留为下一轮独立 ADR)**:
候选 1(LLM+anchor I/O 下沉 port）**不落地本 ADR**，留给 ADR-0022。理由：
- 上游 `@earendil-works/pi-agent-core` HN 2026-08-13 动态（task-region compact begin/end 标记)演进方向未定；现在锁 `LLMPort.summarize(prevSummary, newMessages) → {summary,usage}` 的形状是赌博
- LangChain PR #33825(2025-11-10）落地 `trigger=("fraction", X)` 说明上游还在动；等 pi-agent-core 定型再拆缝给谁"自己拥有的 IR 5 段 schema 对接口语义"不变
- Ponytail:YAGNI——当下没有"新 LLM 提供者"的需求迫使 port 化
- 本 round 只摘注：未来 ADR-0022 应把 `generateSummaryWithUsage` 挂到 port(stop direct import),`RetrievalPort`/`SessionStorePort` 不动

**D6（拒绝项反模式）**
- 拒绝候选 1/候选 4 同轮推进——两个正交 seam 混进一个 ADR 违反 Ousterhout orthogonality
- 拒绝""settings.loose 用任意字段"兜底——Ousterhout voodoo constants 原则要求有原则的默认值，不是把旋钮堆到 `[settings]` 里骗过类型系统
- 拒绝 `consolidateState` 拆成两个类（inject 热读 / consolidate 冷写分开）—— Ousterhout temporal decomposition 反模式，且唯一调用方是 PiAgentRuntime
- 拒绝把 ship-gate json 提交进 git、把 acceptance 留到运行时 fallback、把人工审阅当 acceptance 门禁——SRE 原书 "Releases are truly automatic" + InfoQ 2017 Farley"automated definition of done"+ GitHub environment required reviewers 应作为发布动作而非 acceptance 的替代品

### Consequences

+ thresholds(`lowWatermark` / `reuseCap`）从硬编码 voodoo constant 变成 session 级可配置、`DomainConfigPort` 加注的 controlled policy；后续 LangWatch-traffic 校准有机械通道
+ `consolidateState` 实现保持纯函数（Liskov friendly，注入参数可选、默认值保持现值），测试兼容现有断言
+ ship-gate 从"瞬时 stdout"升级为"可审计结构化证据"(.ship-gate/report.json + CI artifact 层）
+ domain TOML schema 校验提前到 ship-gate 内 —— commit 前 fail-fast，符合 Ousterhout + Humble/Farley tolerances-stage 原则
- 仍欠：`generateSummaryWithUsage`/anchor I/O 在 class 内，须等 ADR-0022 才干净（但 ADR-0021 明确了位置与时序）
- ponytail: CSV/YAML/JSON schema 麻醉输出格式未上（junit.xml 或多面板尚 YAGNI)；`upload-artifact` 的 retention-days 沿用 GitHub 默认 90，不强化

### Research Sources（atomcode，这组议论）

- Ousterhout Stanford CS190《Managing Complexity》讲义 — "Minimize voodoo constants：If you don't know the right value, how will a user or administrator ever figure it out?"
- Anthropic 官方《Manage long context with compaction》 — `trigger:{type:"input_tokens", value:150000}` 阈值 = 请求参数；150K 默认 + 50K 硬下限；"同一模型做摘要"是平台强限制
- OpenAI SDK CompactionPolicy/DynamicCompactionPolicy（0.9 × Window 占比 vs Static 绝对数双策略，官方源码级证据）
- LangChain/LangMem`summarize_messages(max_tokens, max_tokens_before_summary, max_summary_tokens)`+`SummarizationMiddleware` PR #33825(2025-11-10) — `trigger=("tokens"|"messages"|"fraction", X)` 三形态
- Claude Code — 75% 占用触发（`CLAUDE_CODE_AUTO_COMPACT_WINDOW` 绝对覆盖）、BSWEN 实测 v1.0.45 由 60% 调到 80%；Codex CLI 40-50% 时 community issue
- LangWatch Research 2026-08 — 最优阈值 220k-450k 随任务分 3 型；低于 110k 直接被浴盆曲线左墙顶；压缩后纠正率 41.9% vs 基线 17.7%；保留段 0.8% 是杠杆
- Zylos Research 2026-05 — 软阈值 70%/硬阈值 90%、生产压产线在 60-75% 触发、摘要 1-3K tokens
- Mem0 OSS `Memory.from_config` + `config.yaml`;Zep/Graphiti 分节配置 / `GRAPHITI_TELEMETRY_ENABLED`
- Humble/Farley《Continuous Delivery》— configuration changes 一等交付物、自动化 acceptance、artefacts versioned & stored
- Google SRE《Release Engineering》Ch.8 — "Releases are truly automatic"、"Push on Green"、"report archived with other build artifacts"、release 日"re-run unit tests using the release branch and create an audit trail"
- GitHub Docs:workflow artifacts（随 run 删除、attestation)、environment required reviewers（挂发布动作，非验收)
- GitLab `artifacts:reports:junit`——报告必须从磁盘 .xml 文件上传
- CircleCI `store_test_results` ——文件路径、"must not be a hidden folder"
- Turborepo `RELEASE.md` 主分支 ——7 stage 流水线、canary 零人工、独立 smoke test 阶段
- InfoQ 2017 Dave Farley 访谈 — acceptance tests = "automated definition of done";"separate QA team lagging behind development" 反模式
- ThoughtWorks Technology Radar — continuous deployment = Adopt,"requires a high level of maturity"
- Harness 2026-05"From CABs to Continuous Delivery" — "Who approved this? → What did this change prove before we shipped it?"
- HN pi-agent-core 2026-08-13 — task-region compact（begin_task/end_task + 区域摘要），上游演进方向未稳

### Implementation Plan（下一论 grill 实施轮）

1. `packages/store/src/domain-schema.ts`:`CompactionConfig` 加两字段（`lowWatermark?: number | {fraction:number}`；`reuseCap?: number`),`zod` schema 同步
2. `packages/kernel/src/ports.ts`:`DomainConfigPort.compaction` 类型镜像（复用 store 的类型，避免双写漂移）
3. `packages/kernel/src/memory-pipeline.ts`:`consolidateState` 加 opts 参数；删 `LOW_WATERMARK_TOKENS=128000` / `consecutiveReuses>=3` 硬编码；调用处读 `domainConfig.compaction`
4. `scripts/validate-domains.mjs` 新建：node stdlib-only；在 README 写"行、列、约束"三条样板
5. `scripts/ship-gate.mjs`:step 1.5 插入 validate-domains 调用；`report()` 旁加 `reportEntries[]` + 收尾写 `.ship-gate/report.json`
6. `.gitignore` 加 `.ship-gate/`；`.github/workflows/ship-gate.yml` 加 `upload-artifact` step（`if: always()`)
7. `apps/cli/test/e2e.test.ts`（如有 domain 加载断言） + `packages/kernel/test/memory-pipeline.test.ts` 加 2 条注入路径断言（overflow by lowWatermark + 输入 fraction 为 0.7 且低量时=不触发）
8. `pnpm -w run check && pnpm -w run test && pnpm -w run build` 全绿 → `node scripts/ship-gate.mjs --skip-matrix` 全绿 → 5 票 D4 中的"ship-gate.mjs 本地绿"仍然闭合

### Acceptance（番茄闭场）

- ADR-0020 回归 5 票全部仍绿（build/test/pack/spawn/conformance 非阻塞）
- 输入现有 default.toml+research.toml,`node scripts/validate-domains.mjs` exit 0
- 输入恶意 TOML（缺少 `lowWatermark.fraction` 在 definition、或 `<50000` 绝对数）,`scripts/validate-domains.mjs` exit 1 且错误消息含文件:line
- 本地跑 `node scripts/ship-gate.mjs --skip-matrix` → 应在 `.ship-gate/report.json` 看到 `step_1_5_validate_domains: {status:"pass",duration_ms:...}`
- `git push` 走 ship-gate → Actions 看到 `ship-gate-ubuntu-latest` / `-macos-latest` / `-windows-latest` 三个 artifact 各自挂`report.json`
- packages/kernel/src/memory-pipeline.ts 中已不存在 `LOW_WATERMARK_TOKENS` / `consecutiveReuses >= 3` 的字面量；`consolidateState` 测试断言换成 `assert(opts.lowWatermark)`/`assert(opts.reuseCap)` 可注入
- Ponytail full:ship-gate.mjs 仍单文件零依赖；validate-domains.mjs 第二单文件零依赖；总新引入 ~100 行 Node stdlib 代码


---

## Appendix A — post-implementation atomcode audit (commit 56ac644, 2026-08-23)

Audit ran atomcode against github.com/actions/upload-artifact issue #602/#611, smol-toml 1.8.0
package.json, OpenAI DynamicCompactionPolicy, LangChain PR #33825, Claude Code env-vars, and
LangWatch 2026-08. Found 8 anti-patterns; applied 4 fixes in commit 56ac644.

### Applied fixes (this commit)

| # | Sev | Anti-pattern | Fix |
|---|-----|--------------|-----|
| 1 | high | `path: .ship-gate/` + upload-artifact default excluded hidden files since 2024-09-02 (issue #602) → Layer-2 artifact would always be empty + only `if-no-files-found: warn` | Added `include-hidden-files: true` |
| 2 | high | `lowWatermark = {fraction = 0.7}` validated by validate-domains.mjs but silently fell back to 128000 at runtime | `memory-pipeline.ts` throws MemoryPipeline error requiring absolute value; fraction wiring deferred to ADR-0022 |
| 3 | med | `createRequire` from `packages/store/package.json` to reach smol-toml — phantom dep breaks if store changes package manager layout | `smol-toml` declared in root `devDependencies`; script uses direct `import { parse } from "smol-toml"` |
| 5 | med | `(domain as any).compaction` type cast in memory-pipeline.ts | Typed access via `DomainConfigPort.compaction` |

### Deferred (ponytail, low severity, real ceiling named)

| # | Sev | Anti-pattern | Reason deferred |
|---|-----|--------------|-----------------|
| 4 | med | validate-domains re-implements guards instead of calling `store.resolve()` | Calling `resolve()` requires module loading chain; smol-toml standalone is zero-dep. Track for future refactor if guard drift appears |
| 6 | low | `KNOWN_TOP` hardcoded list of schema top-level keys | List is small (10 keys); drift unlikely; runtime check suffices |
| 7 | low | ADR says "retention-days 90 default", workflow sets 30 | 30 is the safer value; ADR text stays immutable (this appendix IS the correction) |
| 8 | low | upload-artifact pinned @v4 while v7 exists | Upgrade path orthogonal; no breaking behavior expected for our usage |

### Acceptance status after audit

- ADR-0020 回归 5 票: **all green** (build/test/pack/spawn/stderr-notice)
- `node scripts/validate-domains.mjs` → exit 0 on default/research
- `node scripts/ship-gate.mjs --skip-matrix` → green, `.ship-gate/report.json` contains `step_1_5_validate_domains`
- ADR spec vs implementation: D1/D2/D5/D6 verified; D3=D4 delivered with Fix #1 note above
