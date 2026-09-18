# R71 Q3 AtomCode 调研存档 — embedding 默认路径票内范围

日期 2026-09-19 · atomcode resume id: 29f809ac-61a1-44cb-b7aa-01536685a467

## 执行摘要

Option A（reachability closure）Confidence 高。理由：(a) shipped capability 诚实标准=verified-reachable 非 documented（esbuild#1621 当年因依赖包管理器边角行为未验证踩坑后重写整个安装策略——行业出处）；(b) sibling 解析与 EBADDEVENGINES 都有已证实现实故障证据非理论风险；(c) B（重新捆绑）无必要——lazy-download 恰是 Playwright/Prisma/Ollama 主流模式。

## 分点结论

1. verified-reachable 是诚实交付标准（esbuild#1621）。
2. npm i -g + optional peer sibling 解析不可靠且版本相关：npm/cli#8416（npm 11.4.2 optional peer ERESOLVE bug 至今 open）；npm install 官方文档对 global peer 放置无保证性表述；pnpm 全局隔离结构与 npm 行为不同且无权威文档。**spike 必须 npm+pnpm 双臂**；若断，修法=显式双包并列安装文档或 CLI 内 fallback 解析逻辑——只能按 spike 证据定。
3. lazy first-use 下载=行业主流（Playwright npx install/Prisma engine/Ollama pull 同构）；本仓 lazy-load transformers+backfill-vectors 模式同构。B 无行业证据。可借鉴：首次下载失败报错须可操作（代理/离线）——并入 doctor 文案。
4. EBADDEVENGINES=确定的发布缺陷必须本轮修：npm v10+ 消费端读 devEngines.packageManager 遇 npm 直接硬错误（JetBrains LLM-29508：连 npm pkg delete devEngines 都被字段阻断需 node -e 逃逸）；devEngines 语义=开发者侧声明，发布包携带属误用。修法：publish 前剥离（prepublishOnly/pack 过滤），pnpm 锁定保留在 pnpm-workspace.yaml+packageManager 字段（corepack 语义消费者不读）。成本极低收益确定。
5. doctor 可操作文案=行业标准（Stella Ops spec：copy/paste commands）。
6. 应捆绑 release——本轮产出恰是一个 patch/minor 粒度；EBADDEVENGINES 剥离不被 spike 卡死（commit 粒度拆分）。

## spike 设计（最终建议）

npm+pnpm 双臂 clean install，四项断言：doctor 报 arm 激活、backfill-vectors 对存量生效、卸载 embedding 后 Jaccard 降级无回归、首次下载失败报错质量（代理/离线）。路径坏→修；太大→limitation 进 ADR 不 block 发布。

## 信息缺口

clean-machine 实测缺席（spike 本体）；pnpm 全局 peer 行为无权威文档；transformers 首下载失败模式未调研并入 spike 观察清单。

## 来源

npm/cli#8416（open bug 原文）/ esbuild PR#1621 / pearpages devEngines 文 / JetBrains YouTrack LLM-29508 / npm install 官方算法文档 / Playwright browsers 官方文档 / Prisma docs / Microsoft Aspire RID 设计文档 / Stella Ops doctor spec / medium 依赖解析文
