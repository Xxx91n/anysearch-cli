# Grill Round 80 — Goal（定稿态）

## 主题

「发布就绪（release readiness）」轮：凝聚轴=0.0.8 发布事件同一 pass/fail 验收面（D-001）。四腿：
1. **产品备货**——`@anysearch-cli/dsh-plugin` 发布就绪全链路（private 翻转+publishConfig+release.yml pack 清单接入+pack 复验）+0.0.8 全仓 sync-bump+publishing.md 首发节；
2. **E6 闸内执法**——pnpm 11.24.0 lockfile 回放实测矩阵（frozen/fetch/verifyDepsBeforeRun/trustLockfile 覆盖度）+三选一决策记档（自建护栏→R81/引用上游/显式记档接受），γ 条件阻塞语义；
3. **派生件新鲜度腿**——ship-gate step 1 家族扩面（CHANGELOG 轮次条目断言+no-changelog-entry 豁免字段+可机验声明注册面+fail/warn 分档）；
4. **T0 ride-along**——dsh rc.3/alpha.1 出闸态复核+#1764 哨+零发现格式化结论行（观测窗口截至戳）。
扳机纪律：npm publish/git tag=用户动作；代理备货到闸前。

## 显式范围外（负向需求固化）

- 自建 lockfile 护栏工程——E6 裁「自建」则归 R81 独轮（hardening-sprint 反模式防内容漂移）；
- rc 线宿主兼容追踪义务专项——记档未立项；
- 其余 10 条 open 债续记（registry carried_log r80）；
- #1764 外发 draft+外发闸两件=用户动作；
- 幂等跳过/占位包首发/tag 含未首发包——D-003 已否；
- release-gate 挂点/非闸化自律脚本——D-004 已否；
- 「冻结」措辞——D-005 已否，一律棘轮表述（基线只减不增+新豁免走 ADR 修订路径）。

## 路径纪律自证（ADR-0072+R79 豁免域）

本文件内仓内目标引用全部 repo-relative；无 fence 内路径；无未标记仓外绝对路径。

## 遗留呈报项

- gh 不可达时 #1764 实况如实记「未验」非静默跳过；
- E6 实测若证 trustLockfile 天然覆盖→例外记档降级为「CI 断言依赖声明」；
- dogfooding 过新闸发现的 issue 处置须记档（产证据非仅通过）。
