# Q2 atomcode 调研 — 8 条路径漂移案例裁决策略（2026-09-16, grill-round-64）

## 执行摘要

**推荐 A，两处修正**：①≥2 条字节级 exact 腿的落点从「构造上不可变 URL 类」扩展为「自控 sentinel 页」优先（primitive-bench sentinel-planted 层直接移植），RFC/冻结 spec 页次选；②mustHitPaths 必须带显式负例保护（写死不得命中的无关页面族）。置信度高——三层证据收敛：contract testing「只断言被依赖承诺」、eval 金集三级 ground truth 分层先例、快照测试维护成本批评文献。

核心定性：10 条失败模式 = **断言粒度超出 provider 能稳定兑现的承诺**（host 稳、page 族稳、字节路径不稳）；A 把断言重新锚定到各层真正稳定的承诺上。

## 分点结论

**2.1 出隔离条件 = 转绿且原因已定性，不是降格到永不红**（Chromium/Datadog/Trunk 共同模式）。B 全撤 host 级 = 断言永久静音后宣布转绿——账本无法区分「排序精度恢复」与「不再检查页族」。

**2.2 contract testing 教义**：验证消费者依赖的接口承诺而非 provider 一切行为。产品承诺 = 「返回 pnpm.io 上的 settings 页族」，不是「字节级 /settings」——后者是 provider URL 形态实现细节。Pact matcher（like()：结构稳定、值无关）与 path 片段匹配同思想。D 的 urlHit 归一化相反——假装承诺仍是字节全等、比较前偷改双方；归一化规则成隐性 fixture，改规则即改语义而不留台账痕迹。

**2.3 primitive-bench 三级 ground truth（deepwiki 原文）**：verified-external（第三方页只断言内容存在性/哈希）/ authoritative-registry（token 必现）/ sentinel-planted（自控页做精确断言）——按上游可控度分粒度。sentinel truth_token 还能区分「没命中」vs「没收录」。

**2.4 反快照文献四连批评**：外部依赖 false-negative 侵蚀信任→机械 re-record 狼来了盲区→断言与意图脱节→维护税。exact 断言应安置在可控位置（kentcdodds 反方平衡）。

**2.5 miss 分解先例**：primitive-bench classify_miss（技能缺陷/bot 拦截/not_indexed）→ 建议 fixture 每条断言配 failure_class 注记，复跑失败归因写入隔离台账——补强 quarantine-by-ledger 而非新增机制。

## 对比矩阵

| 项 | 排序回归可见性 | 漂移鲁棒性 | 断言语义诚实度 | 维护成本 | 治理冲突 |
|---|---|---|---|---|---|
| A mustHitPaths 分层+补 exact | 页族级可见 | 高 | 每层与承诺一致 | 中 | 棘轮需一条显式豁免理由 |
| B 纯降格 host 级 | 页族回归不可见 | 最高 | 诚实但过度放弃精度 | 低 | 违「出隔离需转绿且定性」 |
| C 重钉当前路径 | 同旧粒度 | 零（复发原样） | 把偶然冻为契约 | 高 | 直接违反 no-grandfathering |
| D urlHit 内归一化 | 表面同旧 | 高 | 不诚实（LYING-class） | 中 | 违 LYING 红线+棘轮可审计性 |

## 推荐执行细节

1. 8 条迁移 mustHitPaths；schema 每个 pattern 显式声明容忍段（locale/version/dated）；负例写死（防子串过宽命中无关页面族）。
2. ≥2 条字节级 exact 腿优先自建 sentinel 页（次选 RFC/冻结 spec）；fixture 标注 stability_class: controlled | frozen-spec | external——三级分层移植+棘轮审计可按 class 分账。
3. 每条迁移在隔离台账留 tombstone：原 mustHitUrls→mustHitPaths 迁移理由+provider 漂移证据+failure_class 字段（case tombstone 留痕模型）。
4. ADR 显式记录棘轮豁免理由（新增断言层≠静默放宽）。

## 冲突声明（对本轮治理模型）

- 无冲突：quarantine-by-ledger（复跑转绿才出隔离兼容）、棘轮只减不增（8 条降级属「减」）、no-grandfathering（A 不豁免）。
- 棘轮语义注意项：「续期即红」管的是隔离台账条目，mustHitPaths 新断言层不在其射程——但须 ADR 写明边界防未来误读卡死。
- C=no-grandfathering 典型违反，排除。D 若走必须把归一化规则 schema 显式声明（即退化为 A 变体）。

## 信息缺口

1. Chromium LUCI auto-quarantine 具体阈值未公开——promote 复跑 N 次取值建议复用 FlakyGuard 知识（≥5 次、翻转率>0.2）。
2. pnpm.io/typescriptlang.org 路径漂移是否有官方 rationale（i18n 重构公告）未查——promote 注记时可顺手核查作证。
3. mustHitPaths 匹配算子（子串/前缀/段序列）业界无直接先例——实现时须用负例集自行约束，为 A 最大工程风险点（高置信方向、中置信细节）。

## 辩证附注（呈报人评估，非 atomcode 原文）

- 「棘轮冲突项1」实为误读：ratchet 只管隔离账本条目，断言词汇表不在其管辖——但 ADR 写明边界的建议仍采纳（防下轮误读）。
- sentinel-planted 的前提是「自控且被 provider 收录的公开页」——本仓库 GitHub URL（github.com/...，自控+字节稳定+provider 必收录）是天然候选；实现期须 live 实测确认收录，不行退 RFC/冻结 spec 类。
