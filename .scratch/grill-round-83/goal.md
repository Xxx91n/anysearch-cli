# Grill Round 83 — Goal

Status: **定稿**（2026-09-25）。本文件=R83 持久目标面；账本=decision-ledger.md（D-001~D-007 全 current，唯一裁决记录源）；任务书=handoffs/next-round.md。

## 主题（D-001）

**垂域贯通轮**。主轴=fix-r83-anysearch-vertical-domain-passthrough（契约+路由+审计三面贯通，D-003~D-006）；TE1=条件辅轴预注册承继（双锚齐→issues/02 即时成立+五护栏），**执行序=闸开先行**（D-002 修编 R82 D-003：论证边界三条件缺一即回默认序）。使命锚：信息专精 Agent CLI 遵循 AnySearch 垂直领域理念。

## 票序（账本规范化）

- **T0 哨戒续班**：dsh rc.1（≈2026-09-25T13:25Z）/rc.2（≈2026-09-26T14:02Z）出闸复检+上游仓 changelog 审面补检+双锚判定行+#1764+flake-watch+test-online-anysearch 首周观测（D-001 §4/D-007 §1）；
- **TE1 fix-r82-dsh-event-created-consumption**：条件辅轴——双锚齐当日先消费至出闸或时间盒耗尽（先到为准），完毕进主轴；guard 写 source!=='startup'；论证边界三条件入档（D-001 §2/D-002）；
- **T1 fix-r83-anysearch-vertical-domain-passthrough**：双层贯通（仓 TOML sources.vertical{domain,sub_domain?}+工具 arg 查询级整体替换）+能力协商 hint 扇出（verticalDomainSupported 位+命中标记）+retrieval.vertical.pre 新事件+形状校验服务端真理+非法组合实测（D-003~D-006）；
- **T4 文书收口**：ADR-0084+registry 核销（defer-r83→closed+prefer-capable 跟进项）+nit 两档规则逐项去向+CONTEXT 新词+next-round-r84.md+映射表+but 干净（D-007）。

## 显式范围外

- 跨 provider 垂域词表映射（D-004 §5）；prefer-capable 加权调参（D-004 §4 跟进项，eval 数据驱动非契约职责）；限定路由/缺能力 abstain/真并行（D-004/D-002 否决）；仅工具 arg/仅仓 TOML/深合并/params 入 TOML/两轴合并表达（D-003 否决）；扩 domain_filter.pre/仅 span attrs/vertical.post/params 值入审计（D-005 否决）；运行时 get_sub_domains/静态枚举副本/复制上游 schema（D-006 否决）；最小收口（D-007 否决）；#1764 外发（用户侧挂账）；ANYSEARCH_ENDPOINT（用户配置域不录不代改）。

## 路径纪律自证

本目录产物白名单已入 .gitignore；机器本地路径不落盘；本机 env 值不记档。

## 遗留呈报项

锐评处方 2（pr-1764 comment 外发）仍挂用户侧；审计残余 nit 4 项去向=T4 两档规则逐项登记（度量行自指/JSON id 两路不对称/clientInfo.version 硬编码/engines 地板缺席）。
