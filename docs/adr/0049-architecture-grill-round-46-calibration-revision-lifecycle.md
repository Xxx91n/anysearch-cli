# ADR-0049: Architecture Grill Round 46 — Calibration Revision Lifecycle

Status: Accepted.

ADR-0048 定义了 calibration label 的 system of record、manifest 和 promote 契约，但 promote 后没有可变更 revision 通道，也缺少 case retire、score bridge、冷启动阈值切换和最终验收闭环。本轮在不触碰 frozen golden gate 的前提下补齐该生命周期。

## Decisions

- **D1 Scope**：本轮只做 promote 后 calibration revision 生命周期，采用 `Golden-Registry` 主干、`计量再认证` 节奏、`批准文化` 人审纪律的组合。不引入新 fusion、memory 或其他检索算法。
- **D2 Revision 数据载体**：`revisions/vN/labels.jsonl` + `registry.json`/`state.json` + `current` head pointer。JSONL 继续作为每 revision 载荷；版本不可变，head/labels 指针可变。
- **D3 状态机**：三层模型。revision 落盘即不可变，状态由引用可达性派生；head/labels 是唯一可变指针；case 层三轴独立。禁止全局 `draft → staging → production → archived` 线性状态机。
- **D4 CLI 契约**：新增 `rev open|fork|commit|promote|rollback|switch|list|archive|prune|verify`，并保留旧 `add|set|remove|list|status|validate|promote` 作为兼容别名。退出码为 `0` 成功、`1` 一般运行失败、`2` 用法/前置失败、`12` 仅 seed/manifest 指纹漂移。
- **D5 原子提交协议**：append-only journal + 单一 `state.json`（`{head, labels, seedRef, schemaVersion}`）。写顺序为 payload `fsync` → journal `fsync` → 同目录 temp `state.json` `fsync` → atomic `rename`。Windows 依赖同卷 `fs.renameSync` 和 journal 重放恢复；FAT/exFAT 明确标为 degraded mode。mutation 持排他锁，read-only 命令免锁。
- **D6 Promote 验收**：三层。L0 确定性不变量门；L1 score bridge 分解 `unchanged|added|removed|revised-case` 并做 exact McNemar 漂移告警；L2 盲标人 gold 交集上做 per-group 报告，κ 参照方必须是盲标人。
- **D7 Case 生命周期**：retire 写 `{type:"case_retire", caseId, retiredAt, reason, supersededBy?}` tombstone，不改历史记录。seed 变更必须生成 `seeds/calibration-set-vN.*` 新快照并声明 flip；未声明 seed 漂移继续 exit 12。
- **D8 Retention/Prune/Rollback**：head、labels、journal 事件、现存 seed 全部作为 roots/pins。软归档只摘引用，物理 prune 只删除“不可达、超过 30 天宽限、tombstone 超过 14 天”的对象。rollback/switch 只原子改 `state.json.head`，不改载荷。
- **D9 迁移**：expand-contract 四阶段。P0 纯函数核心；P1 影子只读重放与等价验证；P2 一次性 `migrate` + 原子切换；P3 旧文件退场、旧动词保留别名。生产写路径保持单写者，不做生产双写。
- **D10 L2 统计口径**：pooled `Gwet AC1 + raw agreement po` 主判；Cohen κ 仅作边际差异诊断；Fleiss 不适用 2-rater；Krippendorff α 仅在 ≥3 标注者或缺评时引入。CI 全宽 `>0.4` 报 `insufficient`，组级 `po < 0.75` 或分歧簇只做红旗。
- **D11 端到端验收**：CI 使用版本化录播夹具 judge 跑确定性 `labels → po/AC1/CI/decision/report` 金 diff；真实 LLM judge 只进 nightly/manual canary。五层测试：单元、集成、差分、CI 前置、ship-gate 不变式，并做迁移/rollback/prune/crash recovery 钻演和双平台打包/CLI/MCP smoke。
- **D12 ID 与 schema**：revision 身份用序数 `vN`，完整性用 `digest=sha256:...`。label record 行内 schema 版本，state/seed/report 独立版本；指纹只 hash 语义载荷，并使用 RFC 8785 JCS 确定性序列化。
- **D13 冷启动阈值**：零标注期继续使用 ADR-0029 的 `κ CI 下界 ≥ 0.6` 作为 interim 判据，judge 标记 `provisional/uncalibrated`。正式 L2 判据现在预注册为 `AC1 CI 下界 ≥ 0.7 ∧ po ≥ 0.8 ∧ CI 宽度 ≤ 0.4`；首批 30-50 条 promote 冻结后机械计算三系数并切换。目标为累计 3 轮、n 约 100-200，写入 `.ship-gate/` 的只读预注册文档并以 git 时间戳固定。

## Rejected

- SQLite 作为 calibration metadata 主存储：会丢失纯文本 git-diff 审计性，且本场景不存在并发写者收益。
- head/labels 分文件固定顺序更新：两个 rename 之间存在崩溃窗口。
- 生产路径 dual-write：跨系统原子性不可保证。
- 真实 LLM judge 进 PR CI：引入网络、费用和非确定性。
- 纯 content hash 或 UUID 作为 revision 身份：前者不可预引用且 CLI 可读性差，后者破坏旧 `promotedVersion` 兼容。

## Consequences

- promote 后可以 fork 新的可变 revision，历史 promote 快照只增不改。
- case retire 与 seed 变更均可审计，不会破坏 `caseFingerprint` 或 CI exit 12 契约。
- L2 从 prevalence-sensitive 的单一 κ 门禁迁移到 AC1+po+CI 三条件门控，阈值切换必须预注册。
- 实现新增纯核心、registry/state/journal 读写层、revision CLI 和少量 smoke/drill 脚本；不新增运行时依赖。

## Acceptance

- `pnpm -w turbo check/build/test` 全绿，含 store 全量测试。
- migration/rollback/prune/crash recovery 在拷贝库上完成最小钻演，dry-run 与 apply 位级一致。
- 录播夹具 judge 的 report 金 diff 通过，未知 schema 版本显式失败。
- 双平台 tgz 安装、CLI exit code、MCP JSON-RPC、native integrity 均通过。
- `validate` 的旧 `0/2/12` 语义、旧七动词和 status/list stdout 不回归。
