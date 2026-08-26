# ADR-0026: Architecture Grill Round 23 — pnpm 版本根治：v11 双写钉死 + pmOnFail error

## Status

Accepted — 2026-08-26 (grill r23, Q1–Q7 全部记定)

## Context

仓内 `packageManager: "pnpm@9.12.0"` 与 codex 捆绑/全局 pnpm 版本混用，历史上发生三类事故：

1. `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`（捆绑 v11 读到 v9 时代字段位置差异）。
2. 无 TTY 环境下 purge 提示挂死（corepack#550 同族问题）。
3. v11 静默改写 `pnpm-lock.yaml`，删除 zod override 记录——根因是 pnpm#11536：v11 起不再读取 `package.json#pnpm` 字段，配置只在 `pnpm-workspace.yaml`。

且现状 `devEngines.packageManager` 以字符串形式书写（"pnpm@9.12.0"），违反 npm 规范（应为 `{name, version}` 对象），连 `npm view` 在本目录都会报 `Invalid non-object value for "packageManager"`。

每次 ship-gate 需 PATH 前置全局 pnpm 9.12.0 才能跑，是人机双端的持续负担。Round57 atomcode 分层防御调研（L1–L7）+ Round58 遗留将此项列为重点根治对象。

## Decision

- **D1 范围（Q1: C+A）**：本轮 = pnpm 版本根治 + ponytail 小债清理打包；冲突台账升级（独立 conflicts 表）不进本轮。
- **D2 版本路线（Q2: A）**：一次性直升 pnpm v11 最新稳定版（落盘当日 `11.24.0`，工业界已上 v11 的 nuxt 同款），不做 v10 两段式（两段式要重生成两次 lockfile，且 v10 方案管不住绕过 corepack 直调二进制的场景）。
- **D3 声明形态（Q3: C 收敛形态）**：`packageManager: "pnpm@11.24.0"`（顶层精确版，corepack 读）与 `devEngines.packageManager: { name: "pnpm", version: "11.24.0" }`（对象形式，pnpm 自身强制）**同版本双写**，两处永远同步；不写 sha512 hash（工业界 6/6 家均无 hash，lockfile `packageManagerDependencies` 已提供等价 checksum；`pnpm self-update` 不维护 hash，纯增维护负担）。顺带修正现状 devEngines 字符串畸形写法。
- **D4 lockfile 路径与回滚（Q4: A）**：删 `node_modules` → `pnpm install --no-frozen-lockfile` 原地重生成 → `git diff pnpm-lock.yaml` 人工核 overrides 记录在位 → ship-gate 七项全绿才 commit。回滚 = 单 commit `git revert`（旧 lockfile 在 git 历史）。
- **D5 pmOnFail 档位（Q5: A）**：`pnpm-workspace.yaml` 设 `pmOnFail: error`——agent-first / 供应链敏感仓库的业界主流（HoloScript 同款，注释"在全局 pnpm 改写安装状态前失败"）；这是 Node 25+ 无 corepack 后唯一对人+Agent 双端免疫的自持层（pnpm#11676 实证）。文档注明：本地开发者可用 `pnpm_config_pm_on_fail=download` 环境变量覆盖放行（优先级 CLI > env > workspace yaml，官方设计意图）。显式书写、不依赖默认值（#11676 默认值 bug，11.1.3 才修）。
- **D6 提交节奏（Q6: A）**：package.json 双字段 + workspace yaml + 重生成 lockfile + CI 换 `pnpm/setup` + AGENTS.md 约定，单 commit 原子落地（避免"声明 v11 / lockfile v9 格式"的矛盾中间态进入历史）。
- **D7 小债范围（Q7: A）**：修复 `memory-pipeline.inject` 不检 `role === "user"`（P2，正确性缺口）并加测试断言；kernel `tool-schemas` TS2339 历史噪声仅留档不动代码。

## Consequences

### 正面
- Codex 捆绑 pnpm、全局 pnpm、corepack shim、CI 四条入口全部收敛到同一精确版本；版本错位从"静默改写 lockfile"变为"立刻报错停产"。
- 消灭 ship-gate 前 PATH 前置的繁琐操作；新人/新 Agent clone 即合规。
- 根治 #11536 类配置静默失效风险（配置位置与 v11 唯一读取位置一致）。

### 代价与边界
- error 档下 `pnpm --version` 在版本不匹配时也报错（#11487 类报道），AGENTS.md 必须给出升级/覆盖指引。
- download 档被否的原因记录在案：私有 registry 不被尊重（#10280）、Microsoft 镜像代理事故（>200 monorepo / 4000+ 工程师 fail-closed）、离线 Docker 解析失败（#11808）。
- 锁升职级：pnpm 后续每月版本升级需手动改三处数字（package.json 两处 + 无需改 workspace yaml 除非大版本），属可接受低频操作。

## Implementation Plan

1. `package.json`：`packageManager` 升 `"pnpm@11.24.0"`；`devEngines.packageManager` 改对象形式 `{ name: "pnpm", version: "11.24.0" }`。
2. `pnpm-workspace.yaml`：加 `pmOnFail: error`；确认 `allowBuilds`/`overrides` 位置不动（已合规）。
3. 升级本机全局 pnpm 至 11.24.0；删 `node_modules`；`pnpm install`（首次，--no-frozen-lockfile）重生成 lockfile。
4. `git diff pnpm-lock.yaml` 人工核 zod override 记录在位。
5. 修 `memory-pipeline.inject` role 检查 + 测试断言。
6. CI `native-smoke.yml` 等：action 换 `pnpm/setup`（v11+ 官方继任者，version 省略自动读字段）。
7. AGENTS.md 补 pnpm 约定（版本钉死、pmOnFail error 语义、本地 env 覆盖方法、ship-gate 不再需要 PATH 前置）。
8. ship-gate 七项全绿后单 commit。

## Acceptance

- [ ] check / build / test 三绿
- [ ] ship-gate FULL GREEN（pack 六包 + MCP initialize + T0 探针 + fail-open）
- [ ] 用**非 11.24.0** 的 pnpm 在本仓执行任意命令 → 立即 `ERR_PNPM_BAD_PM_VERSION` 报错（error 档实证）
- [ ] `npm view pnpm version` 在本目录不再报 devEngines 错误（对象形式修复实证）
- [ ] lockfile 重生后 zod override 记录在位（git diff 人工核）
- [ ] CLI 测活：--help / doctor / pref review 空态 exit 0
- [ ] lockfile 全程不被任何非 11.24.0 pnpm 改写

## Research Sources

- atomcode round57 分层防御调研（L1–L7，标签 atomcode-pnpm-pinning-research）
- atomcode r23 Q3 调研：pnpm/vercel/turborepo/typescript-eslint/vite/nuxt 六仓 package.json 实测（0/6 hash；pnpm 自身双写同版本）
- atomcode r23 Q5 调研：HoloScript `pmOnFail: error` 实证；Microsoft 镜像事故；#10280 / #11808 / #11536 / #11676 / #11487 / #12228 issue 原文
- pnpm.io official: settings/cli (pmOnFail 四档), migration guide, 11.0 release blog, configuring（配置优先级）
- corepack README + corepack#550（无 TTY prompt 挂死）
- claude-code#81960（harness 内嵌 pnpm 被 pmOnFail 前身拦下实证）
