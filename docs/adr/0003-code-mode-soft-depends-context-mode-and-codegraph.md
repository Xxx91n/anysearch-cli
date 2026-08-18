# ADR-0003: Code Mode MVP 软依赖已装 context-mode / codegraph

日期: 2026-08-18
状态: Accepted

## 背景 (Context)

该 CLI Active Domain == `code` 模式要求"详细查看本地仓库代码来做联网实时信息获取后的检索分析"（用户原话，与前期 atomcode 的 code mode 实验对齐）。需求：本地仓库索引 + 联网检索后用本地索引做检索分析。

可选实现路径有四条，用户已选第一条作为 MVP：

1. 软依赖已装的 `context-mode` ctx 工具或 `codegraph` MCP 服务，不内置索引（本 ADR 决策）
2. CLI 自带 tree-sitter + SQLite-FTS5（同 codegraph 原理）实现
3. 复刻 ctx 的"沙箱子进程 + FTS 索引"成产品内子模块
4. MVP 不做完整 code mode，只做纯文件读 + grep lite

用户原话："前期作为'能实现'的基础验证，先直接采用 2（实际选 1，措辞被锁定为'软依赖已装'路径），验证可行程度；如果可行，后期做商业化探究。"

## 决策 (Decision)

MVP 阶段 Active Domain == `code` 的本地仓库索引能力**软依赖外部已安装工具**：
- 排序优先级：`context-mode` ctx（本机已验证的成熟运行时，PostToolUse 自动 FTS5 索引）→ `codegraph` MCP 服务（SQLite 知识图谱，需用户先 `codegraph init`）→ 不可用。
- 探活命令：`ans doctor --code-mode` 报告二者是否可见、给安装提示。
- 不可用时代码模式降级为"仅联网检索 + 提示用户安装"，不内置 fallback 实现。

后期商业化路径预留（不在 MVP 实施）：独立二进制部署时内置 SQLite + tree-sitter（已 budget 验证的成熟轻量轮子，AGENTS.md 的 crlf/lf policy 与 file_integrity_protocol 已覆盖），或 CLI 内子模块复刻 ctx 的"沙箱子进程 + FTS 索引"心智模型（重，留有 license 评估空间）。

## 备选方案 (Alternatives 考虑)

- 路径 2（内置 tree-sitter + SQLite）：ponytail 全文倾向 would 更贴合裸发产品，但用户明确"先验证可行"路线，且 MVP 阶段的目标是验证内核检索专精能力而非本地索引本身。
- 路径 4（MVP 不做完整 code mode）：MVP 先做互联网检索 + 领域；被否决因 code mode 是 anysearch 垂直专精理念的重要组成部分，且前期 atomcode 实验已验证这条路径存在可行。

## 后果 (Consequences)

正面：
- MVP 复用团队已安装工具的能力，不内置索引实现 → # ponytail: 8-12 周可去 MVP；code-mode 内置索引實施成本被 shift to 二期
- 与 context-mode 上游 patch 风险解耦（上游升级不会 break 本 CLI）。

负面：
- 裸发产品包不能独立运行 code mode（外部用户必须先装 context-mode 或 codegraph），与商业化"零安装"目标有 1-3 阶段 gap。ADR-0003 决定 tolerate 该 gap 至 "后期商业化探究" 阶段。
- 软依赖关系需要清楚文档化（README 与 `ans doctor --code-mode` 提示文案），否则外部用户易困惑。
- 两个外部工具有不同 invocation surface（ctx 是 ctx_execute / ctx_batch_execute MCP；codegraph 是 codegraph_explore MCP 调用 projectPath），适配器面需要双写。

关联：依赖 ADR-0001（TS 内核 + ctx 同栈）、ADR-0002（Active Domain 配置驱动）；解除 dependency 留在二期商业化阶段。
*End of ADR-0003*
