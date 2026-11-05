# MCP SDK v2 现状调研（primary-source）

- **来源 issue**: #94（TR MCP SDK v2 现状调研，供 #39/#46 决策）
- **调研日期**: 2026-11-03
- **调研人**: Xxx91n
- **归档日期**: 2026-11-05（落 `main`，本仓 `docs/research/`）
- **归档依据**: 与 `upstream-unblock-registry.md` 落档先例一致（#171）——已合并决议的证据住 `main`，不依赖未合并分支存活。

## Provenance（归档来源说明）

本文件内容恢复自 issue #94 的 resolution 评论（2026-11-03）。原调研分支
`research/mcp-sdk-v2` 曾在 `docs/research/mcp-sdk-v2-status.md` 持有**完整引用版**
报告（含逐项文献引用），但该分支在归档时（2026-11-05）已从 `origin` 删除且本地
不可恢复，故此处以 resolution 评论中的结论为现存权威记录。如需补全完整引用版，
请由 issue #94 的评论或作者本地副本回填，本归档不臆造引用。

> 研究结论只回票据、不开 PR、不合并（#94 原约定）。本归档是该结论在 `main` 上的
> 可读副本，不改变「research 分支不合并」的既定口径。

## Background（背景）

MCP TypeScript SDK 桥接三件套（TypeBox Bridge / Capability Detection /
Standard Schema Trigger）的选型，取决于 v2 SDK 的以下事实：

- `registerTool` 对 TypeBox / JSON Schema 的接受度；
- `zod` 4.2+ 与 4.0–4.1 的差异是否仍存在；
- Dual Era Compatibility 在新 SDK 上的姿态。

这些事实供决策票使用：#39（v1 SDK 不收 TypeBox）、#46（zod fallback 降级）、
#47（review-by 锚的 EOL 口径）。

## Findings（结论）

1. **SDK 已分家为 v2 monorepo**：`@modelcontextprotocol/{server,client,core,server-legacy,codemod}`
   现版本 **2.4.0（2026-10-23）**；`@modelcontextprotocol/sdk` 停留在 **v1.x 维护线
   （1.32.2）**。两套并行存在。

2. **`registerTool` 不再是 zod-only**：v2 收 `StandardSchemaWithJSON`；裸 JSON Schema
   仍不可直接赋值，TypeBox 路径是新增的 `fromJsonSchema()` 适配器（server CHANGELOG
   **PR #1689**）——本仓 TypeBox Bridge 的官方对应物已出现。

3. **`zod ≥4.2` 全支持**（server 自带 `zod ^4.2.0`）；**4.0–4.1** 走
   `z.toJSONSchema()` fallback + 一次性告警并丢 `.describe()`——与本仓现有降级一致；
   **`zod 3` 不支持**。

4. **Dual-era 是内建能力**：`createMcpHandler` / `serveStdio` 单工厂同时服务
   `2024-10-07…2025-11-25` 旧客户端与 `2026-07-28` 新规范；
   `versionNegotiation:'auto'` 探测 + legacy 回落。

5. **v1.x 维护线**：npm 未标 deprecated，官方承诺 v2 发布后**至少六个月** bug/安全
   修复 → 下限约 **2027-01-27**（非 2027-01-01 整点）；迁移路径：
   `npx @modelcontextprotocol/codemod@latest v1-to-v2 .` +
   `docs/migration/upgrade-to-v2.md`。

## 未证实（具名待核）

- 裸 TypeBox `TSchema` 是否原生满足 `~standard.jsonSchema`；
- v1.x 过六个月下限后的确切处置。

## 对决策票的含义

- **#39「v1 SDK 不收 TypeBox」** 与 **#46「zod 4.0–4.1 降级」** 的解除条件 =
  迁往 v2 monorepo（`fromJsonSchema` 路径 + `zod≥4.2`）。
- **#47 的 review-by 锚（EOL 口径）应校正为 ~2027-01-27**，而非 2027-01-01 整点。

## References

- Issue #94（resolution 评论，2026-11-03）——本归档的权威来源。
- MCP TypeScript SDK v2 monorepo `2.4.0`（2026-10-23）；v1.x 维护线 `1.32.2`。
- server CHANGELOG PR #1689（`fromJsonSchema()` 适配器）。
- 决策票：#39、#46、#47。
