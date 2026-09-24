# Grill Round 82 — Goal

Status: **定稿**（2026-09-24）。本文件=R82 持久目标面；账本=decision-ledger.md（D-001~D-005 全 current，唯一裁决记录源）；任务书=handoffs/next-round.md。

## 主题（D-001）

**迁移落地轮+垂域评估腿**。主轴=fix-r82-anysearch-mcp-migration（AnySearchProvider REST→MCP-over-HTTP，ADR-0082 分支 b 裁决钉死方向）；T1 票内垂域贯通评估腿（domain/sub_domain/sub_domain_params 透传+domainFilterSupported 翻转半径实测——小则同票，大则 R83 具名票）。发布执行仍属插曲协议非轮腿；dsh E1 消费=条件辅轴（D-003）。

## 票序（账本规范化）

- **T0 哨戒续班**：dsh rc.1 出闸复检（~09-25T13:25Z+changelog 审）+#1764+flake-watch+dsh-native-tools 触发器+**双锚判定行**（D-003 触发面）；
- **T1 fix-r82-anysearch-mcp-migration**：手写薄 JSON-RPC（四坑纪律+混合容错映射+env 剥尾+clamp 10+modes 不下发+live 两层探针）+垂域评估腿+R2/R3 谓词验收锚（D-002+D-004）；
- **TE1 fix-r82-dsh-event-created-consumption**：条件辅轴——双锚齐即时写成+执行序钉死 T1 后+五护栏（D-003）；
- **T2 fix-r82-anysearch-rest-contract**：C-1/C-2/C-13 具名宣称修正（D-005 文书段）；
- **T3 残余分诊执行**：R1/R5 即销五字段卡+R4 closed-by-scope+R2/R3 锚核验（D-004）；
- **T4 文书收口**：ADR-0083+registry 核销/即销登记+CONTEXT 新词+next-round-r83.md+映射表+but 干净（D-005）。

## 显式范围外

- SDK transport/双实现（D-002 否决）；垂域贯通无条件同捆（D-001 C 否决）；单轴不破（D-003 B 否决）；无条件插入（D-003 C 否决）；残余第五格挂着不管（D-004 C 否决）；最小收口（D-005 B 否决）；本机 env 代改与记档（D-004 R4 closed-by-scope）；#1764 comment 外发（用户侧挂账）。

## 路径纪律自证

本目录产物白名单已入 .gitignore；机器本地路径不落盘（用户 env 值不记档）。

## 遗留呈报项

锐评处方 2（pr-1764 comment 外发）仍挂用户侧；审计窗落红小刀 R81 未专门核销。