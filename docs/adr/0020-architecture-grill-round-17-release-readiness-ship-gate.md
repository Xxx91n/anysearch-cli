# ADR-0020: Architecture Grill Round 17 — Release Readiness & Ship-Gate Pipeline

## Status

Accepted. Amends nothing; strictly additive. Layered on top of ADR-0008/0012/0015/0017/0019 invariants (walking-skeleton, fail-open, per-tool barrel, TypeBox bridge). No `Amends:` back-reference required on prior ADRs.

## Context

Grill round 17 shifted the product lens from "how to build" to "can we ship?". The grill hard-5 gate scan on HEAD 2c50c23 showed:

- NimbleBrain ① 可复现构建:FAIL(4 个 package 均 `version: 0.0.0`,无 tag/changelog/OIDC)
- NimbleBrain ② 权限最小化:PASS
- NimbleBrain ③ stdout 纯净：代码 PASS(`rg` 无 console.* / process.stdout.write),CI 无强校验
- NimbleBrain ④ 认证安全：n/a（本地 single user)
- NimbleBrain ⑤ 错误处理：DEFERRED(依赖 SDK 默认 `-32602`，未显式 emit)

同时 atomcode 调研(round17,在 `atomcode-r17-ship-gate-choice` source)证实：

- **官方参考服务器 / upstash/context7 / microsoft/playwright-mcp / supabase/mcp / biome 全都没有把官方 conformance Action 用作发布闸门**;pnpm turborepo biome 的黄金标准是"自研 ship-gate 脚本 + 平台矩阵 tgz 安装 smoke",协议一致性靠 SDK/手动核验而非单独 Action。
- **better-sqlite3 issue #1384 / Netlify GLIBC 报错 / darwin-arm64 缺预编译**实证：换 Node / OS / libc 就可能 `npm install` 失败即使测试全绿；唯一捕获方法是"真机安装 + 立刻 spawn 发 initialize"。
- **conformance Action 官方 README 要求 `--url http://...`**:stdio 服务器需额外 HTTP 桥；对我们是 **非零成本且非必要**(SDK v2 + fromJsonSchema 已把 schema 收敛到 2020-12)。
- **MCP spec 2026-07-28 RC 在动**(stateless lifecycle / SEP-2567 / SEP-2484),conformance 场景集本身在漂移，现在强制阻断 ship 会被外部变化绑架。
- **Feathers seam / Humble & Farley / Cockburn 三方收敛**:ship-gate.mjs 是一个 seam;smoke test 是多闸门流水线中"最优先最不可替代"的一道；产品级 walking skeleton 必须贯穿到 tgz install + spawn 存活，不是只在 CI 容器过 unit/integration。

Ponytail full 要求：最小 diff、复用现成 CI 模板、不引入第三方 release orchestrator（如 goreleaser/semantic-release)，也不提前把 conformance 标 Blocking(ADR-0018 D7 已是"待矩阵绿后再切")。

## Decision

(D1 — **Ship-Gate Script 主闸门**)
落地 `scripts/ship-gate.mjs`(Node stdlib only,无新 dependency）作为发布前阻断闸门。课程化 5 步：
1. **静态断言**:`rg` 扫 `apps/mcp/src` 与 `packages/kernel/src` 禁 `console.log|info|warn|error`、`process.stdout.write`、`process.stdout.dir`;`rg` 包级 `version` 非 `0.0.0`;`packages/kernel/src/tool-schemas.ts` 必须含 `additionalProperties: false` 五次（5 个工具）。
2. **构建**:`pnpm -w run check && pnpm -w run test && pnpm -w run build`。
3. **打包**:`pnpm -r pack --pack-destination <tmp>` 产出 4 个 tgz，断言体积非零。
4. **安装(矩阵 CI)**：在干净 dir 中 `npm install -g <tgz>` × {ubuntu-latest, windows-latest, macos-latest},**捕获** better-sqlite3 类平台失败；本地运行可 `--skip-matrix` 跳过矩阵仅做 win32。
5. **进程存活**:spawn `apps/mcp/dist/cli.js` stdio mode → 发 `initialize` → 断言合法 JSON-RPC 应答 + **stdout 前缀不含非 JSON 字节**；同时 spawn 一次"无 env / 后端不可达"形态，断言快速 fail-open(stderr 警告 + exit 0 或受控 code，不挂死不崩溃)。

(D2 — **Conformance Action 副闸门，非阻断**)
新增 `.github/workflows/conformance.yml`:workflow_dispatch + 周一定时；调用 `modelcontextprotocol/conformance@v0.1.11` 对真机跑通的本地 anysearch MCP server 做 `--spec-version 2025-11-25`（先锚稳定版）扫描，配 `conformance-expected-failures.yml` baseline(qaskills 规则：未登记失败非零退出，stale 通过也非零退出）。**结果打成 step summary，不阻断 main/release**。升级到 Blocking 的触发条件冻结在 D6。

(D3 — **Version + Tag 纪律**)
拔高 NimbleBrain ①：所有 package.json 从 `0.0.0` 升到 `0.1.0-rc.0`;`git tag v0.1.0-rc.0` 必须等于 HEAD commit;`CHANGELOG.md` 首条目创建（指向 ADR-0020);`scripts/ship-gate.mjs` 静态断言 version 非 `0.0.0` 且与 tag 一致。OIDC 可信发布、CalVer、`fail-fast:false` 矩阵留给 1.0 之后，YAGNI。

(D4 — **Ship-Gate Position**)
"Ship" = 同时具备以下 5 个 ship 票：`ship-gate.mjs` 本地绿 + 矩阵 install smoke 绿 + ADR-0019 drift invariant 绿 + ADR-0017 audit-fix pack 完整性无回归 + ADR-0016 temporal-decoupling 单测全部绿。任一不过 press "do not ship" 标签。**这就是 grill "engine 级别对项目防回归"的最终判据**;`turbo test 6/6` 只是必要条件，不是充分条件。

(D5 — **Ponytail 边界**)
ship-gate.mjs 必须是 **一个文件、Node stdlib、零依赖**；不引 execa/which/chalk；日志走 `console.log`/`console.error`（脚本自身，与产品无 `stdout 纯净` 冲突——product MCP server 才受限）。conformance Action 是整个 PR 唯一允许引入的新外部动作，且 pin 到具体 commit SHA 而非 `@main`。

(D6 — **拒绝项（反模仿清单）**)
- 拒绝把 conformance 立即设为 Blocking(spec 在动 + stdio 桥成本)
- 拒绝引入 `semantic-release` / `changesets` / `goreleaser`（复杂度超出当前团队预一)
- 拒绝在 ship-gate.mjs 里造 mock LLM/e2e LLM 调用（真实流量明示推迟到 R18+)
- 拒绝把 `version` bump 自动化（先手动，避免与 pnpm version 命令与 tag 约定辊合)
- 拒绝新增 `MTF 信任分` / 容器发布 / SLSA L3（超出 NimbleBrain 硬 5 范围，后应按照 AGENTS.md 平台注记走 better-sqlite3 受支持路径）

## Consequences

- Walking-skeleton 闭环被"发布侧"补全：过去走完代码骨架，`ship-gate.mjs` 现在走完整"代码到用户手"骨架。
- Ponytail 的"强文档边界"精确：ship-gate 脚本本身不是产品代码，可以在 ADR 之外自由演化，不惊动其他 12 份 ADR。
- Fail-open 被船票包进去："无 env 启动必须快速失败"作为 D1 step5 断言，打通 ADR-0009 D6。
- B 轨（conformance）结果是 ship 的 advisory 信号，为 ADR-0017 dual-era 兼容挣到持续 heartbeat。
- CI 轨道分层清晰：`.github/workflows/ci.yml` 面向 PR（快速、阻断）,`.github/workflows/conformance.yml` 面向规格呼吸（慢速、非阻断）,`.github/workflows/release.yml` 面向出票（调用 ship-gate.mjs,Blocking)。

## Research Sources (atomcode, this round)

Source label: `atomcode-r17-ship-gate-choice`(15 URLs 全文核验 + 8 快照级，三引擎 Exa/Tavily/AnySearch、五角度 Official/Community/Criticism/Comparative/Currency 全覆盖）

**核心论据映射**:
- 官方参考服务器 `RELEASING.md`:OIDC + CalVer + 每包独立 job。我们 D3 取"版本/tag/changelog 纪律"，推迟 OIDC + CalVer 至 1.0 后（YAGNI)。
- pnpm `release.yml` 的 `verify-ts-release`：发布前 pack 9 平台 tgz 校验 manifest payload → D1 step3/4 附带。
- biome `release.yml` 平台二进制矩阵 + changesets → D1 step4 的 3 OS 矩阵参考。
- turborepo `RELEASE.md` 7 阶段（含独立 smoke test 阶段）→ D4 的"5 ship 票"原始模板。
- better-sqlite3 issue #1384 + #1027 + Netlify GLIBC 论坛快照 → D1 step4 平台矩阵硬 necessity。
- conformance README(--url 强制、expected-failures baseline、tier-check、work-in-progress 警告）→ D2 非阻断 + baseline 治理规则。
- Cockburn (Crystal Clear) / Hunt & Thomas (tracer bullets) / Feathers (LegacySeam) / Humble & Farley (deployment pipeline+"smoke test 最不可替代") → D1 的"一次真装"在学术上的定位。

**调查缺口（明示）**:922 个 MCP server 健康快研"18.7% npm install 失败"原始文章 URL 未捕获（搜索快照级）;supabase/mcp 的 `release.yml` 未逐字核验（清单级）;O'Reilly《Continuous Delivery》第 5 章 403(Farley 2007 PDF 快照为替代）。

## Implementation Plan（下一论 grill/内容域走 minimal patch)

1. `scripts/ship-gate.mjs`(~250 行，Node stdlib)。测试闭场：自己 dogfood 在 2c50c23 上应全绿。
2. `.github/workflows/conformance.yml` + `conformance-expected-failures.yml`。
3. 拔 package.json version 至 `0.1.0-rc.0`;`git tag v0.1.0-rc.0`;`CHANGELOG.md` 首条目。
4. `docs/RELEASE.md` 一页：本地 ship 列 5 票 + 升级 conformance 到 Blocking 的 D6 触发。
5. AGENTS.md 平台注记下加一行指向 `scripts/ship-gate.mjs`。

## Acceptance(蕃茄闭场)

- `node scripts/ship-gate.mjs --help` 输出用法并 exit 0
- `node scripts/ship-gate.mjs` 在 2c50c23 绿（静态 5 项 + build/test/pack/spawn alive)
- `node scripts/ship-gate.mjs --skip-matrix` 本地可控跳过
- 人为改坏一东西（例：在 `apps/mcp/src/server.ts` 插一句 `console.log("x")`)ship-gate 必须 exit≠0
- workflow_dispatch 手动跑 `.github/workflows/conformance.yml` 产 step summary，不红 main
