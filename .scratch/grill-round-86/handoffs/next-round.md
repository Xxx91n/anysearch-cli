# R86 Green-Gate Ship — Handoff（任务书）

Stack: r86-green-gate-ship（新建）——基座=origin/main tip（含 R85 栈 527c8172 之后的任何新 land）
Branch protection: 不推 main；审计分支 r86-audit 后建；票序 T0→T6 按序落 commit。

## 状态快照（接手时实物核验而非凭本档）
- main tip：527c8172（R85 审计栈顶）；工作区净；86 ADR 在位；R85 全绿臂 delta 件在 .scratch/vertical-eval/（机器本地不入库）。
- **当前门红**：closeout-claims.json r85-t2-degraded-archived claim（kind:path）指向 gitignore 通道——main tip 双平台红，T1 修复为第一优先级。
- 账本：.scratch/grill-round-86/decision-ledger.md 5 条全 current（D-001 局部修订注记→D-004）。
- 敏感域：ANYSEARCH_ENDPOINT/ANYSEARCH_API_KEY 值不入档不代改——探针只记存在性/错误类别。

## 票序任务表（每票覆盖的 D-xxx + suggested skills）

### T0 哨戒续班（覆盖 D-005 T0）
- 对象：dsh 0.1.7-rc.x 版本线 watch；test-online-anysearch CI 腿观测；llm-init SSE flake watch；#1764 挂账（用户侧不代发）。
- 工件：.scratch/grill-round-86/reports/t0-watch-YYYY-MM-DD.md 序列；**锐评第八轮核账归档**（本 grill 核账表+辩证结论→reports/ 入档）。
- skills：neat-freak（台账不落杂）／context-mode（检索旧报告比对）。

### T1 红门修复（覆盖 D-002 全套；andon 前置——不绿不推进 T2）
- 对象：closeout-claims.json + ship-gate 配套。
- 动作：新建 .scratch/grill-round-85/evidence-manifest.json（每件机器本地证据=path+sha256+size+来源 commit+判读器配置 hash+环境指纹；**不记裸 generatedAt**；清单内引用原件路径的行复用 <!-- machine-local: reason @ YYYY-MM-DD --> governed marker）；r85-t2-degraded-archived claim 改指该清单（kind:path 不变，四 kind 零扩展）；清单同时覆盖 delta-2026-09-26.json 阴性证据（原子集④首件——若清单扩展至 delta.json 属 D-005 T4 列，T1 至少覆盖 degraded 件）；docs/agents/audit-checklist.md 加硬项【签字 commit 上 ship-gate --quick exit 0】。
- 验收：ship-gate 双平台绿（本机 node scripts/ship-gate.mjs 全量绿+CI 绿）；清单 sha256 与本地原件实测一致。
- skills：domain-modeling（Evidence Manifest 术语一致性）／grilling（合约面零扩展自检）。

### T2 defer-r85 判别实验（覆盖 D-003）
- 第一批（捆绑）：P0 provider 直调取证脚本（new AnySearchProvider().search() catch e.name+message 截断落档——**升长期 fixture**，delta 证据件从此记错误类别非仅旗标）+ P3 dist 新鲜度断言（dist hash/git describe vs HEAD，不匹配→FAIL）。
- 第二批（按需）：P1 env 三分离（原 env/endpoint 置空/key 置空）；P2 raw MCP 探针（initialize+tools/call 裸发，对照 R82 golden 归一化 hash diff，additive/risky/breaking 三车道判读）。
- 错误分类层：5xx/429→transient；401/403→permanent-auth；malformed→permanent 协议漂移；404+session→半永久。
- 工件：.scratch/grill-round-86/reports/probe-matrix.md（每探针结果+错误类别+归因结论）；敏感值不入档。
- skills：grilling（判别逻辑）／domain-modeling（错误分类层术语）。

### T3 修复+臂复活（覆盖 D-003 判据）
- 判据：错误类别归因落档 + iso 探针连续 5/5 providersFailed 空。
- 分支：transient 上游已恢复→零代码修，registry 核销注记+ADR 升级条款（复发→P2 wire-schema 长期快照测试入 CI 前置）；缺陷→修复后同判据复验；**不可复活→B1′ 预案**（D-005：装船条件降级为根因落档+修复正确性实证，README/装船判词显著位披露降级态）。
- skills：grilling／domain-modeling。

### T4 判读器语义修正+记分簿诚实化（覆盖 D-004①②；必须先于 T5）
- 对象：readout-delta.mjs（或其后继判读器）+ .scratch/grill-round-85/decision-record.md + docs/adr/0086-*.md + registry + .scratch/grill-round-75/drafts/pr-1764-comment.md。
- 动作：providersFailed 非空→unknown/instrument-flag（收紧向，注明 R85 旧件不复算）；decision-record 判词降级 indeterminate—instrument down（不溯改正文，加勘误脚注段）；ADR-0086 相应段加勘误脚注；registry prefer-capable 注记改为「R85 判读因装置失效不定判，具名重开条件见 D-004④」；NO-GO texture 补齐；pr-1764 Status 翻面为已外发；manifest 扩展覆盖 delta.json（D-005 T4 列）。
- skills：domain-modeling（Instrument-Down Indeterminate/Qualification-Decision Split/Scoreboard Honesty Correction）／neat-freak。

### T5 全绿臂复跑（覆盖 D-004③）
- 前置：T3 判据达标（或 B1′ 分支时跳过改走正确性实证路径）。
- 口径：原协议原指纹 7ac0a48e55cd7954、57 条全量；判据=iso 腿 providersFailed=∅ + 臂非空覆盖≥70%；新 delta 数据如实报告不回写裁决；若现方向信号（|ΔarmHostHit|≳0.4 或 better/worse 显著偏斜）→registry 注记具名重开条件（fresh prereg 下轮）。
- 工件：.scratch/grill-round-86/reports/rerun-*.md + 机器本地 delta 件+manifest 指纹更新。
- skills：grilling（判读纪律）／domain-modeling。

### T6 收口装船（覆盖 D-001/D-004④/D-005 收口）
- registry 三联：defer-r85 核销或降级注记+prefer-capable 具名跟进条件+R86 closeout-claims 新条。
- CONTEXT 词表校对（R86 九词已在位——ADR-0087 编号待立）。
- **ADR-0087** 立档：绿门装船轮全程（原子集五项+判别结论+判词降级+装船边界+版本裁决）。
- closeout-claims.json 本轮条目（manifest 自洽/dual-gate 绿/probe 归因/decision-record 脚注/registry 迁移等机器可验项）。
- **v0.1.0 全包钉版**：cli+store+kernel+retriever+embedding+dsh-plugin（承 0.0.8 惯例）；切版双条件=（全绿臂复跑 ∨ B1′ 根因落档路径）+双平台门绿；release notes 用 known-issue 模板显著披露 anysearch 降级态（若 B1′）。
- skills：handoff（任务书更新）／neat-freak（收口台账）／domain-modeling。

## 显式范围外（账本负向需求汇总）
旧 defer 清障全单（empty-endpoint/a03/a06/a08/engine coalesce/canonicalizeVertical/MCP 缩进/control 口径/Standards 9 smell/finding-8）——独立 refactor commit 或顺延；prefer-capable 加权实施；ip 第五域；pathlint 冻结维持；缩容冒烟冒充全程；新数据改判；追溯复算 R85 旧件；kind:machine-local 立法；跑批产物原件入库；ANS_PROVIDERS 名义匹配深挖（已基本排除）；敏感值入档。

## 汇报纪律
单任务隔离报；敏感值遮蔽；跑批 SKIP 分类披露；无分类编号不猜；『全绿』『核销』等措辞须实证方可落档；装船判词如实记证据降级。
