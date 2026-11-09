# MCP SDK v2 现状调研（只看上游原文）

- **来源 issue**: #94（MCP SDK v2 现状调研，给 #39/#46 做决定用）
- **调研日期**: 2026-11-03
- **调研人**: Xxx91n
- **归档日期**: 2026-11-05（放到 `main` 的 `docs/research/` 目录）
- **归档依据**: 和 `upstream-unblock-registry.md` 的做法一致（#171）——已经有结论的东西放在 `main` 上，不靠一个没合并的分支活着。

## 这份文件从哪来

本文件的内容来自 issue #94 的结案评论（2026-11-03）。原来的调研分支
`research/mcp-sdk-v2` 曾在 `docs/research/mcp-sdk-v2-status.md` 放过一份
**带完整引用的版本**（每一条都附文献出处），但这个分支在归档时（2026-11-05）
已经从 `origin` 删掉，本地也找不回来了。所以这里以结案评论里的结论为准。
要补完整引用版，请从 issue #94 的评论或作者本地副本回填；这份归档不自己编引用。

> 调研结论只回到票里，不开 PR、不合并（#94 原约定）。这份归档是同一个结论在
> `main` 上的可读副本，不改变「调研分支不合并」的规矩。

## 背景

MCP TypeScript SDK 这块有三项桥接工作（TypeBox 桥、能力探测、Standard Schema 触发），
怎么选取决于 v2 SDK 的下面这些事实：

- `registerTool` 收不收 TypeBox / JSON Schema；
- `zod` 4.2+ 和 4.0–4.1 的差别还在不在；
- 新 SDK 怎么处理新旧两代协议并存。

这些事实给这几张票用：#39（v1 SDK 不收 TypeBox）、#46（zod 版本降级）、
#47（review-by 检查点的 EOL 标准）。

## 查到的事实

1. **SDK 已经拆成 v2 多包仓库**：`@modelcontextprotocol/{server,client,core,server-legacy,codemod}`
   现在版本是 **2.4.0（2026-10-23）**；`@modelcontextprotocol/sdk` 停在 **v1.x 维护线
   （1.32.2）**。两套同时存在。

2. **`registerTool` 不再只收 zod**：v2 收 `StandardSchemaWithJSON`；裸 JSON Schema
   还是不能直接传，TypeBox 现在走新增的 `fromJsonSchema()` 适配器（server CHANGELOG
   **PR #1689**）——本仓 TypeBox 桥的官方对应物已经出来了。

3. **`zod ≥4.2` 完全支持**（server 自带 `zod ^4.2.0`）；**4.0–4.1** 走
   `z.toJSONSchema()` 兜底加一次性警告（v2.4.0 变更记录确认）；**`zod 3` 不支持**。
   `#94` 结案评论还说这个兜底会丢掉 `.describe()`——v2.4.0 变更记录没有单独
   证实这一点，所以列进「还没确认」里。

4. **新旧两代协议是内建能力**：`createMcpHandler` / `serveStdio` 一个工厂同时服务
   `2024-10-07…2025-11-25` 的旧客户端和 `2026-07-28` 的新规范；
   `versionNegotiation:'auto'` 自动探测，旧客户端自动回落。

5. **v1.x 维护线**：npm 没标 deprecated，官方承诺 v2 发布后**至少六个月**继续修
   bug 和安全问题 → 下限大约 **2027-01-27**（不是 2027-01-01 整点）；迁移路径：
   `npx @modelcontextprotocol/codemod@latest v1-to-v2 .` +
   `docs/migration/upgrade-to-v2.md`。

## 还没确认的（逐条点名）

- 裸 TypeBox `TSchema` 本身满不满足 `~standard.jsonSchema`；
- v1.x 过了六个月下限后到底怎么处理；
- `z.toJSONSchema()` 兜底会不会丢掉 `.describe()`（`#94` 结案评论这么说，等
  v2.4.0 源码或测试独立证实）。

## 对相关票的影响

- **#39「v1 SDK 不收 TypeBox」** 和 **#46「zod 4.0–4.1 降级」** 的解除条件 =
  迁到 v2 多包仓库（`fromJsonSchema` 路径 + `zod≥4.2`）。
- **#47 的 review-by 检查点（EOL 标准）应改成 ~2027-01-27**，不是 2027-01-01 整点。

## 参考资料

- Issue #94（结案评论，2026-11-03）——这份归档的权威来源。
- MCP TypeScript SDK v2 多包仓库 `2.4.0`（2026-10-23）；v1.x 维护线 `1.32.2`。
- server CHANGELOG PR #1689（`fromJsonSchema()` 适配器）。
- 相关票：#39、#46、#47。
