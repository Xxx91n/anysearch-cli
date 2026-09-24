# 03 — fix-r82-anysearch-rest-contract（T2 宣称修正具名票）

Status: pending
Covers: D-005 §3（文书段宣称修正）

## 票体

C-1/C-2/C-13 具名修正落实（承 T1b RESHAPE）：

- C-1（anysearch.ts 端点注释+"Anonymous has lower rate limit"）：REST 契约注释改 MCP 契约陈述；匿名限流半句不可验→删或注「未验」。
- C-2（anysearch.ts REST 响应形宣称）：改 MCP tools/call 契约形陈述（content[].text markdown/structuredContent 缺席实测）。
- C-13（test/anysearch.test.ts mock REST fixture）：随 T1 换 MCP 形（mock initialize/tools-call）。
- max_results 名义 20 宣称核对→clamp 10 记 CHANGELOG Changed/Removed。

## 验收

每宣称修正有落点+closeout-claims 注册（新可机验声明）；迁移后实测形与宣称一致。
