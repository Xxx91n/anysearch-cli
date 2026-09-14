# Round-61 → Fixer 轮常驻任务书（docs 域外 abstain 收口 + README 治理）

唯一事实源：`docs/adr/0062-architecture-grill-round-61-out-of-domain-abstain-closure-readme.md` + `.scratch/grill-round-61/decision-ledger.md`（D-001..D-005）。本任务书不允许偏离账本；任何新发现呈报，不静默改向。

## 总目标

docs 域对域外提问 abstain（bc0001 收口）；README 重写为用户向快速上手版。npm 发布不在本轮（D-001）。

## 串行票序（D-005，每票独立可回滚、独立验收）

| 票 | 内容 | 覆盖 D-xxx | 验收锚点 |
|---|---|---|---|
| T1 | retriever contract 加 `includeDomains?: string[]` + capability 位；tavily 适配器下发 `include_domains`、exa 下发 `includeDomains`；brave/anysearch 声明不支持 | D-002 | 单测：适配器 payload 含域参数；Tavily 泄漏实测探针（判据 5，见下）写报告 |
| T2 | kernel post-filter 权威闸（复用 `resolveUrlPolicy`/`canonicalizeHosts`/`shouldBridgeToAbstain`，policy 请求时解析不缓存快照）→ abstain；observation 加 `retrieval.domain_filter.pre/post` 双事件 + `outcome:abstain` 维度 | D-002, D-003 | 单测：域外 URL 被闸；双事件字段齐全；域内正常穿透 |
| T3 | CLI 结构化一行拒答消息（域/pre/post片数/触发闸）+ exit 0 + `--fail-on-abstain`；MCP/plugin `structuredContent.abstain` 契约（isError:false） | D-003 | CLI 实测 exit code；MCP 契约测试 |
| T4 | golden 判据 1-4 落 eval-looks：域外 must-abstain / 域内 must-hit（成对）/降级 stub provider golden/冷门域 0 结果；ship-gate 接线 | D-003 | 离线 golden 全绿；断言锚 verdict 字段非 regex |
| T5 | README 重写（readme-crafter + beautify-github-readme）：诚实 0.0.1、安装/构建/首跑/API key/doctor、Known Limitations（域外 abstain 修复历史、macOS 未实测、tavily AbortSignal SDK 限制）；示例命令仅采用 T1-T4 实跑证据；ADR 索引保留 | D-004 | 新装环境照 README 能走通首跑；limitations 与 ADR 表述一致 |

判据 5 补充：Tavily changelog 2026-08 实锤 `include_domains_mode` boost=软模式会泄漏、Research 端点软偏好、子域匹配方向性——探针要测：默认 mode 是否等效 boost、子域覆盖方向、端点差异；结果入 INJECT 式账本，驱动 capability 表。

## 硬约束

- 数据源纪律：仅 ADR-0062 + 账本；新结论先呈报。
- 用户痛点：禁"感觉自己行"——每项声称必须附可独立复跑的验收证据（命令+日志）。
- 测试真实性（ADR-0057）：golden 离线可跑，stub provider 复用既有机制；禁只引入不闭环。
- 版本控制走 `$but`：每票一提交或一栈；不 land 未经 PR/CI 验证的分支（Round-59 教训）。
- 阿猫阿狗尾巴：tavily provider 不转发 AbortSignal（SDK 限制，如实记载不包装）。

## 范围外（ADR-0062 显式）

golden executor F4 / adversarial 入圈 / macOS lane / 裸域微瑕 / npm 发布。

## suggested skills

- 实现期：`tdd`（T2 abstain 桥先写败北测试）、`codegraph` 探仓库、atomcode 深调研（新问题丢 `.codex-tmp/` prompt 再跑）。
- 文档期：`readme-crafter-skill` + `beautify-github-readme`（D-004 指定）。
- 收口期：`code-review`（双轴）+ 审计重跑；交接 `$handoff`；版本 `$but`。

## 恢复上下文顺序

1. 本文件 → 2. ADR-0062 → 3. `decision-ledger.md` → 4. q2/q3 atomcode 报告 → 5. Round-60 `round-60-audit-to-r61.md`（bc0001 原始证据与验收命令序列）。
