# ADR-0011: Architecture Grill Round 8 — SessionStart Hook + Progressive Disclosure Implementation

日期: 2026-08-19
状态: Accepted

## 背景 (Context)

Post-Round 7 (ADR-0010), 三层渐进披露架构已规划但未实现。Phase 3 (ADR-0009)
hooks + ProjectIndexStore + Dual DB + Two-Stage Recall 已全部落地（220 tests pass），
但 SessionStart hook 的路由卡注入仅实现了 session-start.ts 骨架代码，
hooks esbuild 多 bundle 构建脚本虽在 package.json 中定义但产物从未生成，
Cursor/Antigravity 的 SessionStart 语义差异未处理。

atomcode 两轮联网调研覆盖：
1. 行业架构深化趋势（Letta/Mem0/Zep/OpenViking/TencentDB 的 L0/L1/L2 最新实践、
   Claude Code 30+ hooks 事件、三平台 hooks 趋同与语义差异）
2. Cursor sessionStart 字段名与注入机制（官方文档 additional_context snake_case
   确认、竞态 bug 确认、context-mode/Hindsight/superpowers 三个成熟项目的双通道
   落地实践验证）

本轮 grill 覆盖 Q1-Q9（9 个决策），聚焦 SessionStart hook + 三层渐进披露的
完整实现路径。

## 决策 (Decision)

### Decision 1: 优先级 — SessionStart Hook + 三层渐进披露 (Q1=C)

四个架构深化候选中优先做 SessionStart Hook + 三层渐进披露（ADR-0010 D2 实现）。
后续轮次保留 L0 LLM 压缩升级（A）、L1 热冷路径混合注入（B）、Per-Platform
集成验证（D）的心智模型。

理由：风险最低、用户感知最强、不侵入 Agent 内部核心（pi-runtime.ts）。
hooks 是确定性层（vs rules/skills 概率性），行业调研确认三平台已趋同。

### Decision 2: 路由卡内容粒度 — 标准化 ~20 行 (Q2=B)

SessionStart hook 注入 ~20 行 / 150-400 token 静态路由卡，4 个 block：
1. 插件声明（anysearch 已激活）
2. 5 个 ans_* 工具一句话描述
3. 触发规则（信息检索需求时优先调用 ans_*）
4. fail-open 降级说明 + SKILL.md 指针

不内联完整 guidance、不教主 Agent 怎么用工具（那是 SKILL.md 的职责）。
对齐 ADR-0010 D2 规划和 context-mode 实证。

### Decision 3: Hooks 构建产物补建 (Q3=B, Q4 修正)

esbuild 多 bundle 构建脚本已在 package.json 中完整定义（build:core / build:distill
/ build:preheat / build:session-start / build:adapters 含 4 平台），但 dist/hooks/
目录为空——build:hooks 从未成功执行。需补跑构建并验证产物。

### Decision 4: Cursor 双通道注入 (Q4=B)

Cursor sessionStart 的 additional_context 注入通道有官方承认的竞态 bug
（2026-04 至 2026-08 多帖确认，Hooks 日志显示 merged 但实际未进模型上下文）。
采用 context-mode（20k stars）和 Hindsight 的一致实践：

- hook 照常 emit additional_context（snake_case 顶层字段）做前向兼容
- 关键路由上下文走 .cursor/rules/anysearch.mdc（alwaysApply: true）兜底
- 官方修复 bug 后 .mdc 兜底可移除但 hook emit 保留

字段名确认为 additional_context（snake_case），不是 additionalContext。
来源：Cursor 官方文档原文 + 官方员工 forum 两人确认 + 4 个第三方实现交叉验证。

### Decision 5: .mdc 规则文件动态生成 (Q5=B)

.cursor/rules/anysearch.mdc 由 SessionStart hook 运行时动态生成，不做安装时
静态预置。路由卡内容在 session-start.ts 的 ROUTING_CARD 常量中一处定义，
hook 执行时检查 .mdc 是否存在且内容一致，不存在或过期则写入。

对齐 Hindsight 的"每次 sessionStart 重新生成"实践。首次安装后第一次会话
即生成，不需要安装阶段提前写。

### Decision 6: 不修改宿主 AGENTS.md (Q6=B)

插件不碰宿主项目的 AGENTS.md 文件。路由卡通过 SessionStart hook
（Claude/Codex）或 .mdc 规则文件（Cursor/Antigravity）注入。

规避 context-mode 篡改全局 AGENTS.md/CLAUDE.md 的幂等性问题。三层渐进披露
在实操中变为两层：hook/.mdc 做常驻注入，SKILL.md 做按需加载。AGENTS.md
常驻事实层降级为"用户想手动配置时提供模板但不自动写入"。

### Decision 7: 三层 test 闭环 (Q7=A+B+C)

1. 扩展现有 plugin.test.ts：新增 SessionStart 路由卡内容断言（4 个 block
   存在、token 数 150-400 范围）、Cursor snake_case 字段名断言、.mdc
   生成逻辑断言
2. 新建 hooks.test.ts：hooks 层集成测试，覆盖 core/distill/preheat/session-start
   的跨组件交互
3. 端到端测试：构造真实 stdin JSON，pipe 进 session-start.cjs，断言 stdout
   JSON 的 additionalContext/additional_context 字段

### Decision 8: Antigravity 规则文件兜底 (Q8=A)

Antigravity（前 Gemini CLI）5 事件新命名（PreToolUse/PostToolUse/PreInvocation/
PostInvocation/Stop）中无 SessionStart 等价事件。和 Cursor 一样用规则文件
兜底。antigravity hooks.json 保留 SessionStart 配置做前向兼容，但当前版本
靠规则文件注入路由卡。

### Decision 9: 实现顺序 — 串行一口气统一验收 (Q9=A+C)

串行顺序：构建修复 → adapter 修改 → test 闭环 → 文档/ADR。
一口气做完后统一验收：编译（tsc --noEmit）、打包（build:hooks + build:server
产物存在）、测活（session-start.cjs 输出合法 JSON、server /health 200）。

## 备选方案 (Alternatives Considered)

- Q1 先做 L0 LLM 压缩升级：侵入 pi-runtime.ts 核心路径，风险高，推迟
- Q4 仅 emit additional_context 不加兜底：Cursor 当前版本路由卡大概率不进
  模型上下文，SessionStart 功能空壳
- Q5 安装时静态预置 .mdc：多一个安装阶段维护点，Ponytail 认为 hook 运行时
  动态生成更简
- Q6 安装时追加 AGENTS.md：幂等性问题（context-mode 前车之鉴）
- Q8 用 PreInvocation 代替 SessionStart：语义不对，每次模型调用都触发会
  重复注入路由卡

## 后果 (Consequences)

正面:
- SessionStart hook 完整实现 = 用户在 Claude/Cursor/Codex/Antigravity 中
  实际感知到 ans_* 工具存在，三层渐进披露不再是空壳
- Cursor 双通道 = 对齐 context-mode/Hindsight 成熟实践，前向兼容官方修复
- .mdc 动态生成 = 路由卡一处定义两处输出，零同步成本
- 不碰 AGENTS.md = 规避幂等性问题，插件安装无副作用
- 三层 test 闭环 = 构建产物、路由卡内容、端到端流全覆盖

负面:
- .mdc 文件写入用户工作区 .cursor/rules/ 目录，属于插件副作用（mitigated:
  Hindsight 实践证明 .gitignore + 每次重写是社区可接受的做法）
- Antigravity SessionStart 配置保留但不生效（mitigated: 前向兼容，adapter
  层不报错）
- 三层 test 闭环增加测试编写量（mitigated: hooks 层是最需要确定性保障的
  层，投入合理）

关联: ADR-0009 (Phase 3 Plugin Design D7 esbuild), ADR-0010 (D2 Progressive
Disclosure Three-Layer).
