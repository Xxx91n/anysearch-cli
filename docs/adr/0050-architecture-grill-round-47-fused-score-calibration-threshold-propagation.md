# ADR-0050: Architecture Grill Round 47 — Fused Score Calibration and Threshold Propagation

Status: Accepted.

ADR-0049 补齐了 calibration revision 生命周期，但 fused attribution score 仍是硬编码 `0.6` 三态路由，且没有可复用的 judge-vs-human 之外的 ground-truth 通道。本轮在 local calibration loop 内引入独立 `attribution-gold` 二元 claim 标签线与 beta 校准，并把校准后概率接进 supported/uncertain/unsupported 的阈值决策；不触碰 frozen golden gate、fusion、memory 或检索算法。

## Decisions

- **D1 范围**：只做 fused attribution score 的统计校准与阈值传播，采用「纯本地、零后端、复用 ADR-0048/0049 revision 生命周期」的组合。`entity.ts` 的实体合并阈值迁移复用同一模式，但留到实体链接轮，不并入本轮。
- **D2 校准契约**：对 `classifyClaim` 的 fused score 拟合 beta calibration（小样本），二值 sens/spec + prevalence 作为交叉校验与负例分层依据；isotonic、L2D、conformal、在线自适应明确推迟。
- **D3 标签契约**：新增 `attribution-gold` 二元 claim 级 ground-truth 标签线，AIS 语义三态采集（supported/uncertain/unsupported）后二元拟合；uncertain 不进拟合集，只进覆盖率分母。与 judge-vs-human 的 relevance 线四层物理分离。
- **D4 数据生命周期**：样本流与盲标批次共享，标签、rubric、fingerprint、manifest、head 指针独立；冷启动启用门为 `N_min + 目标精度`，不复用 κ/AC1（后者是 judge 启用门）。
- **D5 决策契约**：`deriveThresholds` 默认按目标精度在 held-out 校准集上反查双阈值；未校准时回退 legacy 静态阈值并打 `degraded` 告警（fail-open with a floor）。阈值与 beta 参数分离，阈值进独立预注册文档。
- **D6 生命周期扩展**：把「线」作为一等命名空间，共享 `rev` 动词加 `--line` 参数，缺省 `calibration`；beta 参数随 revision 不可变存储，双阈值进 `.ship-gate/attribution-gold-preregistration.json`，回滚按线独立只动指针。
- **D7 交换性与漂移**：时间切分为主、随机切分仅诊断；三段 fit/eval 分离；漂移用 PSI/KS → ECE/Brier + beta-vs-identity → 双阈值 precision 回测 → 事件触发四层金字塔，动作顺序为 re-threshold → refit → revision。
- **D8 迁移**：三层 expand-contract（schema 只增不改 → 静态值作可覆盖默认 + 影子重放 → 预注册达标后 head 原子切换，回退改指针，最后 contract 删静态路径）。
- **D9 验收**：L1 确定性不变量、L2 金 diff + score bridge、L3 统计门禁含功效守卫、L4 迁移/回滚/崩溃钻演、L5 双平台打包 + CLI + MCP + native smoke；阈值 held-out 预注册，样本不足降 WARN。
- **D10 模块归属**：纯函数核心放 `packages/kernel/src`，数据/revision 放 `packages/store`，内部 CLI 放 `scripts/*.mjs`，预注册放 `.ship-gate/`，TypeBox 单源。

## Consequences

- fused attribution score 从启发式分数升级为可审计的后验概率，supported/unsupported 决策获得有限样本统计语义。
- 新线通过 provenance 指针与共享盲标批次建立最小跨线耦合，标签与指纹零引用。
- 冷启动阶段行为保持现状的 static `0.6` fail-open，数据达标后按预注册门禁保守激活。
