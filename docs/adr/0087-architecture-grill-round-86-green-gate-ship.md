# ADR-0087: Grill Round 86 — 绿门装船轮（红门根因修复 + provider-failure 判别实验 + matrix@2 + v0.1.0）

## Status

Accepted (grill round r86; 主轴票 fix-r86-green-gate-ship). Records T0–T6 per task book `.scratch/grill-round-86/handoffs/next-round.md`. Ledger: `.scratch/grill-round-86/decision-ledger.md` (D-001~D-005). Evidence root: `.scratch/grill-round-86/` + `.scratch/grill-round-85/` 修订面；探针矩阵 `.scratch/grill-round-86/reports/probe-matrix.md`；复跑判读 `.scratch/grill-round-86/readout-output.json` + `decision-record.md`。

## Context

R85 收口把 main 留在红门上（ship-gate closeout-claim 指向 gitignore 的机器本地证据件，CI 双平台必红），且 R85 delta 判读暴露「provider-failure 空列被判成测得值」的记分簿失真——anysearch 臂 57/57 格全灭读成了 NO-GO 零增益。本轮回合两事：修门 + 判别归因 + 诚实化重读 + 装船。

## Decision

### D1 红门修复形态（D-002）

kind:path claim 指向机器本地通道是结构性错位——不落库的证据件不能作 path 断言对象。修法=**指纹清单模式**：`evidence-manifest.json`（anysearch/evidence-manifest@1）记 path+sha256+size+来源 commit+判读器 hash+环境指纹（无裸 generatedAt），claim 改指清单，断言对象=清单在库自洽。audit-checklist 补硬项「签字 commit 上 ship-gate --quick exit 0」防类发。

### D2 判别实验判据（D-003）

微分探针两批：P0 provider 直调取证（`scripts/probe-anysearch-provider.ts`）+ P3 dist 新鲜度断言（构建戳 vs HEAD + src mtime 护栏，stale→FAIL 非 SKIP）先行；P1 env 三分离 + P2 raw MCP 按需。错误类别通道贯通 contract`ProviderErrorClass`/classifyProviderError→engine metadata.providerErrorClasses→cli --json→delta 行四列——记类别不记原文（零泄漏面）。

### D3 归因与修复（D-003）

实证三层归因：①R85 全灭=env 层双重缺陷（ANYSEARCH_ENDPOINT 指向 loopback 无 /mcp 路由之服务 + ANYSEARCH_API_KEY invalid_api_key），公网默认端点匿名实测存活；②声明式环境下大跑残余失败=匿名配额边界——上游以 auto-provisioning 凭证签发文本应答（200+isError:null），provider 检出后抛 quota/auth nudge 具名错误归 permanent-auth；③配额武装后残余 5 腿=确定性上游契约拒收（4 设计内 bogus 对照 + vert-f1105 缺 cn_code 必填参数）。env 修复归用户侧（agent 不代办）；defer-r84 空串 POSIX 语义（||undefined）同期核销。

### D4 判读器语义修正+记分簿诚实化（D-004①②）

readout-delta.mjs 升 **matrix@2** 执行体（§10 先于 T5 终读登记）：provider-failed iso 腿→格 unmeasured/unknown，subject 层 instrumentDown>30%→INCONCLUSIVE/instrument-flag（新闸 G1b，装置健康族）；runner 捕获层失败腿不再落成空列表。decision-record/ADR-0086 勘误：判词语义判 indeterminate—instrument down，程序性 NO-GO 锁定不溯改。registry prefer-capable 条目附具名重开条件。

### D5 全绿臂复跑终读（D-004③）

原协议原指纹（7ac0a48e55cd7954）57 格复跑于声明式测量环境：paired 40/41（97.6%≥70%✓）、装置性失败∅（残余=确定性契约拒收如实记账）；matrix@2 单次终读 → **NO-GO / direction-negative**（P=0.0378、净胜率 −0.125、EL=0.297、rankDiff 中位 0）——臂在 armHostHit 轴实测负效应。defer-r83 核销获第一次真实数据背书；defer-r85、defer-r84-env 核销；新挂 defer-r86-corpus-param-contract（语料冻结期 vert-f1105 欠 cn_code 不可修）+ defer-r86-anon-quota-nudge。

### D6 v0.1.0 全包钉版（D-005）

9 package.json + plugin.json 0.0.8→0.1.0 同版本钉 + ship-gate release pin 同步（R66 F-01 同 commit 纪律）+ CHANGELOG 0.1.0 段。语义升位理由：provider 契约面新增 ProviderErrorClass/metadata.providerErrorClasses（additive）、dist 新鲜度断言、判读器矩阵@2——装船点=修后绿门，非时间窗。

## Rejected alternatives

- **逐字复判 R85 artifact**：单次终读纪律——R85 锁定读数不溯改，修正走勘误+新执行体
- **把配额 nudge 归类 transient**：nudge 非自限（无 key 不自愈），permanent-auth 是诚实桶
- **为 ∅ 判据改语料**：指纹钉死语料=冻结域，改格即 G0 漂移；判据按「装置性失败∅」语义记账
- **静默吞 isError**：契约拒收必须落 providersFailed+errorClass，不作空列表伪装
- **agent 代改用户 env**：endpoint/key 属用户配置域，agent 只测不修（声明式测量环境隔离）

## Consequences

- `defer-r85-anysearch-arm-providersfailed`、`defer-r84-anysearch-empty-endpoint-env` closed；新挂 `defer-r86-anysearch-corpus-param-contract`、`defer-r86-anysearch-anon-quota-nudge`
- prefer-capable 加权问维持 closed——第一次真实数据支持（负效应实测，非缺测零）
- provider 错误契约面：ProviderErrorClass 五类 + provisioning-nudge 检出 + POSIX 空串语义——后续 provider 接入按此模板
- 发布通道：v0.1.0 钉版后 pre-tag dispatch→tag 流程照旧（release.yml）
- 失误披露：R85 delta.json 原件被 R86 冒烟覆盖（manifest 记指纹留存+disposition，不伪装一致）；冒烟跑必须设 ANS_VERTICAL_DELTA_OUT 隔离
