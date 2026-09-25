# R84 候选主题池（从 R83 收口承继）

## 立项候选

- **候选 A — prefer-capable 加权调参（defer-r83-prefer-capable-weighting）**：verticalDomainSupported 声明者在融合中的权重倾斜评估；前置=eval 数据证明垂域臂召回质量差异（eval 轮职责，非契约轮）。
- **候选 B — dsh ≥0.1.7 宿主侧 live 验收**：TE1 行为面（agent/created+source 值域）在真宿主进程内复跑留痕——需用户侧升级宿主或垫 0.1.7 沙箱；当前=unverified-at-host 挂账。
- **候选 C — 征集**：下轮主题开放。

## 常驻哨戒承继

- dsh 上游观测：rc.2 出闸点 ≈2026-09-26T14:02Z——下一轮开局复检 npm view 时戳+tarball 特征锚（agent/created 面是否续稳定）；rc.3+ 版本线继续 watch。
- #1764：OPEN 趋僵 22d+（updatedAt 2026-09-03）——用户侧评论外发仍挂，续记不代发。
- llm-init.test.ts SSE flake watch 续班。
- test-online-anysearch CI 腿观测续班。

## 显式范围外（R83 决议沿用）

ANYSEARCH_ENDPOINT 用户配置域不录不代改；#1764 外发用户侧；跨 provider 词表映射/运行时 get_sub_domains/静态枚举副本/vertical.post/params 值入审计/深合并——均 R83 否决项不回潮。

## R83 审计登记建议（A-02~A-08，audit-rework 候选池）

源自 .scratch/grill-round-83/reports/2026-09-26-audit.md；逐项判定见该件。登记（不修档）：

- A-02 校验三入口不匀：CLI/MCP/TOML 三注入面的形状校验措辞不完全对齐（建议统一校验器或明示差异）。
- A-03 flagValueSet 吞词：CLI flag 解析的已知保守面——值疑似旗标时吞词行为留档待改。
- A-04 `sub_domain_params:{}` 空对象语义：wire 上空对象是否下发未立法。
- A-05 第 7 键 `anysearch.domain` 同时在审计 attrs——ADR-0084 已披露，复核即可。
- A-06 三处垂域组装重复：engine/tool handler/CLI 各自的 vertical 对象构造可抽公共 builder。
- A-07 evidence 文档内命令须带 ./ 前缀（本机实录习惯）。
- A-08 pre-existing dead `maxResults`：存量死参（非本轮引入），归清障轮。

P-2 过程项：headless profile 留有昨日彩排残留（用户环境状态，非仓面）。
