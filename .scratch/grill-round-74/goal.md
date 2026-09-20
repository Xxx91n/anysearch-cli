# Round 74 Goal — README 打磨：surgical 内容升级 + 纯 SVG 视觉层（定稿）

**Status**: finalized @ 2026-09-20 — grill 收口，等 T0 开工令。
**Ledger**: `.scratch/grill-round-74/decision-ledger.md`（D-001~D-006 全 current，唯一数据源）。

## 一句话目标

按 `git/readme` 四 skill 把 README（EN canonical + zh-CN 派生对）从零视觉资产态升级为「域门母题 hero + 真实输出证明块 + 可扫读 verified-hosts 证据脊」的 landing page——surgical 范围，不动已验证的诚实文案脊柱。

## 范围内（账本裁决）

| 面 | 内容 | 票 |
|---|---|---|
| 诊断+计划 | crafter Phase1-4 落实物：事实清单+11 项质检诊断+section plan+资产职责清单；plan.md 供用户过目 | T0（D-001/D-005） |
| 视觉资产 | logo.svg（概念提案→用户选定→手写，视觉解剖纪律）+hero.svg（域门母题）+渲染核验（900px/360px/深浅底/16px） | T1（D-002/D-003/D-005） |
| 内容 surgical | EN 先改（proof 块/Mermaid 图/表瘦身/节精修）→zh 锁步同步；docs/antigravity-integration.md 新建为瘦身前置 | T2（D-004/D-005） |
| 验证+收口 | audit_readme.py/等价+hard-compare matrix+ship-gate 全绿+ADR-0075+词表+CHANGELOG+handoff+but commit | T3（D-006） |

## 显式范围外（不动名）

- repo-logo 位图管线（Phase5 生图/Phase7 母本/Phase9 派生矩阵）——imagegen 本机不存在
- GIF 动效——用户未 opt-in，静态 SVG only
- README 重写式改版（信息架构保留）
- section banners/装饰 badge（Developer Utility temperament 密度上限）
- R73/R72/R71 续债原名（0.1.6 哨戒/发布道/原生注册/web 矩阵/1g/macos/transformers/provider）
- `origin/r71-grill` 删除——收口列报候选待用户确认，不自行删

## 验证与收口

四段判据见账本 D-006：计划段（plan.md+过目确认）/ 资产段（SVG 实物+渲染核验+选定记录）/ 内容段（双语 diff+parity 绿+agy 专文+hard-compare+零声明漂移）/ 文书段（ADR-0075+词表+三元组+pathlint 自证+净工作区）。

## 路径纪律自证（ADR-0072）

本目录文档：库内引用一律 repo-relative；绝对路径仅可出现于 Stack 定位器行或带治理标记的库外引用。
