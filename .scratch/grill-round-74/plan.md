# Round-74 T0 — README 改版计划（crafter Phase 1–4 落实物）

Stack：`r74-grill`（GitButler，自 main `e184c691` 起栈；定稿整理 commit `zwu`）。
数据源唯一：`.scratch/grill-round-74/decision-ledger.md`（D-001~D-006）。
模式：**Surgical Improvement**——保留信息架构与证据脊柱，只替换弱/缺席的呈现层。

## 1. SCAN 事实清单（Phase 1 补全）

### 包元数据与分发态
- `package.json`：`anysearch-cli` **0.0.7**，`packageManager: pnpm@11.24.0` 钉版，Node >= 22；scripts 全走 turbo（build/dev/lint/test/check）。
- 分发态 = **Published Package**（实证：npm badge + R73 审计 8/8 含 `anysearch-cli-cli-0.0.7.tgz` pack 实物 + npm OIDC/sigstore 自 0.0.4）。
- 类型 = CLI Tool + Monorepo Hub（`apps/cli` · `apps/mcp` · `apps/plugin` + `packages/{kernel,store,retriever}`）。

### 配置面与资产盘点
- **无 `.env.example`、无 env 模板** —— README 是唯一配置真相面（`EXA_API_KEY`/`TAVILY_API_KEY`/`ANYSEARCH_API_KEY`/`ANS_DOMAIN`/`ANS_DOMAINS_DIR`/`ANYSEARCH_MODEL_CACHE`）。Config-Parity 无对漂对象，但也意味着 README 配置声明无第二校验源（事实记录，非 issue）。
- **零视觉资产**：无 `assets/` 目录、无图片、无 logo——唯一视觉元素 = 3 枚 shields badge（npm version / ci / license）。
- **无 `examples/`、无 `CONTRIBUTING.md`、无 `llms.txt`**；`CONTEXT.md`/`CHANGELOG.md`/`LICENSE`/`docs/` 俱在。
- 双件现状：`README.md` 179 行（canonical EN）/ `README.zh-CN.md` 174 行（派生）；heading skeleton 当前 1:1（H1×1 + H2×10），ship-gate 1h 四腿现绿。
- 文档面：`docs/{codebuddy,claude,codex,deepseek-harness}-integration.md` 四篇宿主专文 + `docs/per-platform-verification.md` + `docs/limitations.md` + `docs/adr/` + `docs/agents/`；**`docs/antigravity-integration.md` 不存在**（T2 新建，agy 证据现仅居表内+`.scratch/grill-round-68/evidence/`）。
- 域名策略实物：`domains/{default,docs,research}.toml`；本机 `ANS_DOMAIN=docs` 活跃，allowlist = modelcontextprotocol.io / typescriptlang.org / pnpm.io 等。

### 可捕获的真实证据（亲跑 2026-09-20）
- `node apps/cli/dist/index.js --version` → `0.0.7`（dist 已建，进程测活 ✓）。
- `node apps/cli/dist/index.js doctor` → **25 passed / 0 skipped / 0 failed**；三 provider key 全 set，docs 域解析链绿。
- `node apps/cli/dist/index.js search "model context protocol" --domain docs` → 真实返回（tavily+exa 命中 allowlist 域，URL 全在门内）——**proof 块的实物摘录源已落实**，非假想样例。

### 工具链就位
- python3 = 3.11.9（`audit_readme.py` T3 可跑真实审计，无需手动等价）。
- `.codegraph/` 索引存在（codegraph 探索可用）。
- `but` 0.22.3；`r74-grill` 栈已在，工作区净。

## 2. 十一项质检逐条诊断（Phase 2 — 现役 README）

| # | 检查项 | 判定 | 证据 / 缺口 |
|---|--------|------|-------------|
| 1 | 3-Second | **半过** | one-liner 准确但内部术语密度高（FTS5/RRF/MCP 并置），陌生评估者需二次解码；首屏无任何视觉锚。→ T1 hero 承担「人话版」首屏，README 正文不动。 |
| 2 | Copy-Paste | 过 | `npm i -g @anysearch-cli/cli` 实证（R73 审计 install verify 腿绿）；源码路径 `node apps/cli/dist/index.js` 与仓库一致。 |
| 3 | Solo | 过 | Requirements → Quickstart → `ans doctor` 自检闭环完整；keys/域/DB 路径无隐藏知识。 |
| 4 | Scan | **半过** | heading 流合理；但 `Verified agent hosts` 表格单元格为段落级长文（单行 >400 字符），扫读断点明确——D-004 瘦身对象。 |
| 5 | Accuracy | 过 | R73 审计硬验收 8/8 亲跑复现；声明皆有 ADR 证据链。 |
| 6 | Public-Surface | 过 | 主面=CLI 非库，无 import 面可错；`ans`/`node apps/cli/dist/index.js` 双入口如实。 |
| 7 | Config-Parity | 过（附事实） | 无 `.env.example` 可对漂；README 即唯一配置面。记录事实，不产 issue。 |
| 8 | Distribution-Posture | 过 | Published 实证（npm 页+provenance）；源码路径降级为 contributors 段，姿态正确。 |
| 9 | Freshness | 过 | 0.0.7 当前版；宿主表版本/日期新至 2026-09-19。 |
| 10 | Link-Asset | **短板** | md 链接面健康；但**零本地视觉资产**=最显眼短板（D-001 裁决：不补即放弃首屏）。 |
| 11 | Evidence-Integrity | 过 | live-verified 声明均有 transcript/ADR 锚；无编造社交证明。 |

**补充发现（Completeness-by-type / CLI 类应然）**：CLI 类 README 应有「命令+真实输出」展示；现役仅有 abstain 单行文本块（在 Domains 节深处），**无 search 成功路径的输出摘录**——show-don't-tell 缺口，D-003 proof 块补上移。语气一致性过（Developer Utility 全程稳定）。

## 3. Section plan（Phase 4 — 逐节判定）

现骨架（EN canonical，H1×1 + H2×10）逐节判定：**保留 9 / 精修 1 / 新增 1 / 删除 0 / 移动 0**（另：无标题 proof 块新增一处）。

| 现节 | 判定 | 说明 |
|------|------|------|
| preamble（H1/语言切换/canonical 注/badge×3/one-liner/status 段） | **精修** | 顶置 `<img src="assets/readme/hero.svg" width="100%">`；logo mark 由 hero 内含（不另起 `<img>`）；**proof 输出块插于 status 段后、Requirements 前**（无新 H2 → heading skeleton 不变，parity 腿 i 天然保绿；块为 fenced ```text，双语逐字同 → 腿 ii 满足）。 |
| Requirements | 保留 | — |
| Quickstart | 保留 | — |
| Post-install: vector arm | 保留 | — |
| Domains & abstain (ADR-0062) | 保留 | 核心差异化叙事+abstain 块原位不动（证据脊柱红线）。 |
| Provider domain-filter matrix | 保留 | 小表已精干。 |
| MCP server | 保留 | — |
| — | **新增 `## How it works`** | 置于 `## Verified agent hosts` 之前：Mermaid flowchart 一张（CLI/MCP → providers exa/tavily/anysearch → kernel 域门 pre/post + RRF + attribution → store FTS5/observation）。新增 H2 → zh 同步新增同位节；mermaid 块双语逐字同。 |
| Verified agent hosts | **精修（瘦身，D-004）** | 列改 `Host / Version / Verified scope / Status`：Version 列吸收 Date（日期随证据迁专文）；scope 压为短语级信号；Status = verdict 短语 + 专文指针。长文证据（探针矩阵/契约怪癖/fail-open 边界）迁各宿主专文；**agy 双行证据迁新建的 `docs/antigravity-integration.md`（迁移前置——瘦身提交不得携带证据净丢失）**。表下 "Verified means..." 段保留并更新指针列表（+antigravity）。 |
| Known limitations | 保留 | — |
| Design rationale | 保留 | — |
| For contributors | 保留 | — |

### 新读序（hero→proof→quickstart→…）
hero（视觉首屏：字标+人话价值句+域门示意）→ lang/canonical/badges → one-liner → status → **proof 块（真输出摘录）** → Requirements → Quickstart → vector arm → Domains & abstain → Provider matrix → MCP server → **How it works（Mermaid）** → Verified hosts（瘦身证据脊） → Known limitations → Design rationale → For contributors。

### 瘦身样例（呈报预览，非终稿）
```text
before | Claude Code | 2.1.251 | 2026-09-17 | mcp.json 注册(...)·settings.json hooks(...)·plugin skeleton(...) | live-verified (settings path): MCP connect + 5 tools + ...(段落级)
after  | Claude Code | 2.1.251 | mcp.json + settings.json hooks + plugin skeleton | live-verified · docs/claude-integration.md
```

## 4. 资产职责清单（beautify：每资产须有 job）

| 资产 | 落点 | 承担的沟通任务 | 证据源 |
|------|------|----------------|--------|
| `assets/readme/logo.svg` | hero 内嵌 mark（复用面） | **识别**：16px 可辨的项目 mark；图元映射真实系统模块（视觉解剖纪律，T1 概念闸产出对照表） | T1 概念选定记录 + repo-logo Phase 3 纪律 |
| `assets/readme/hero.svg` | README 顶置 `width="100%"` | **3 秒解释**：左=字标+一句话人话价值+logo mark；右=域门示意（搜索扇出 → urlAllowlist 内核闸门 → 门内干净结果落格 + 门外 abstain 卡）——「移除项目名即不可复用」为失败判据 | D-003 构图裁决 + README 已验证声明的通俗复述（无新声明） |
| Mermaid 架构图 | 新增 `## How it works` 节内嵌 | **机制定向**：一张图讲清 fanout→gate→fuse→store；为 verified-hosts 证据脊提供结构上下文 | `packages/*` 真实模块边界（kernel/store/retriever + apps/*） |
| proof 输出块 | status 段后无标题 ```text 块 | **show-don't-tell**：`ans search` 真输出摘录 + abstain 行——证据先于承诺 | 本机亲跑捕获（docs 域 keyed，见 §1 可捕获证据） |

## 5. 执行序与确认闸（D-005 四票串行）

- **本 plan 呈报用户过目 → 确认记录落档后 T1 才开工**（crafter plan-acknowledgment 纪律）。
- T1：logo 2–3 文字概念提案（各含视觉解剖 ASCII+图元-模块对照表+16px 论证）→ **用户选定（确认闸 2）** → 手写 `logo.svg`；再写 `hero.svg`；核验=900px GitHub 宽渲染+360px 窄屏+深/浅底+16px 缩略+禁 foreignObject/脚本/远程字体。
- T2：**`docs/antigravity-integration.md` 新建+agy 证据迁入先于表格瘦身提交**（硬约束）→ EN 改 → zh 锁步同 commit（parity 四腿全绿）。
- T3：`audit_readme.py`（python3.11 已就位）+ repo-integrity hard-compare matrix + 渲染预览 + `ship-gate.mjs --quick` 全绿 + ADR-0075 + CONTEXT 新词补录 + CHANGELOG + found/fixed/deferred + handoff（**列报 `origin/r71-grill` 删除候选**）+ pathlint 登记 round-74 + `but commit` 净。

## 6. 红线自查（落 plan 即承诺）

不动 verified-hosts 6 行事实/fail-open 契约/abstain 语义；不产位图、不加 GIF、不挂外链图；zh 永不滞后 EN；不发 dsh-plugin、不动续债名、不删 `origin/r71-grill`；README 内路径一律库内相对（scratch 证据走专文指针不直引）。
