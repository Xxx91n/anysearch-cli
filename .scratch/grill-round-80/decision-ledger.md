# Grill Round 80 — Decision Ledger

> 数据源纪律：本账本是整理环节唯一数据源。格式：ID / 原问题 / 原回答原文 / 规范化需求 / 显式约束·负向需求 / 状态。

## D-001 — R80 主题定界（发布就绪轮）

- **原问题**：R80 主题定界（锐评 vs 交接账本张力裁决）——A 换气轮（产品备货+E6 仅实验腿）/ B 交接原案（E6 lockfile 执法整轮）/ C 原始双轨（产品+执法全做含自建护栏）/ A+ = C 收窄版（发布就绪单验收面）/ D 纯治理收尾 / E 另指。
- **原回答原文**：「采纳」（对 A+ = C 收窄版的呈报）。
- **规范化需求**：R80 定界为**「发布就绪（release readiness）轮」**，唯一凝聚轴=0.0.8 发布事件的同一 pass/fail 验收面。四条腿：
  1. **腿 1 产品备货**：@anysearch-cli/dsh-plugin npm 发布就绪全链路（private 翻转+publishConfig+pack 复验+release 工作流接入验证）+0.0.8 列车备货（版本 bump 决策+CHANGELOG 轮次条目+发布说明）；npm publish/tag 扳机留用户（外发闸同构）。
  2. **腿 2 闸内执法**：E6 trustLockfile 钉版 pnpm 11.24.0 实测收口（frozen/fetch/verifyDepsBeforeRun 变体矩阵）+三选一决策记档（自建护栏→R81 独轮 / 引用上游→记档核销 / 显式接受→registry 转记档态）。
  3. **腿 3 随车机验**：派生件新鲜度腿（adr-index regen check + CHANGELOG 轮次条目在场断言 + 声明计数重推导）——发布验收前置，杀「记录的记录」四连打回类。
  4. **T0 ride-along**：dsh rc.3/alpha.1 出闸复检（≈09-24 窗口到期义务）+#1764 哨（gh 可达时）。
- **显式约束/负向需求**：
  - 凝聚轴判据（atomcode 交叉）：两轨须共享同一 pass/fail 事件；自建护栏工程不决定本轮发布 → 显式拆出递延 R81 独轮（hardening-sprint 内容漂移反模式防线）。
  - 禁止静默改向：实验结果若与账本冲突，标 revised+新 D-xxx 呈报用户。
  - 代理不执行 npm publish/git tag push 等外部生产动作——备货到扳机前。
  - 显式范围外：自建护栏工程、rc 线宿主兼容追踪义务专项立项、其余 10 条 open 债续记不动、外发闸两份 draft 用户亲发、#1764 观察不动。
- **状态**：current

## D-002 — 票序结构 + E6 裁决阻塞语义（γ 条件阻塞）

- **原问题**：Q2a 票序（T0→T1 E6→T2 产品→T3 新鲜度→T4 文书 vs 产品先行/合票）+ Q2b 阻塞语义（α 不阻塞/β 无条件阻塞/γ 条件阻塞+到期）。
- **原回答原文**：「采纳」（对 A+=调研修正版的呈报）。
- **规范化需求**：
  - **票序**：T0 取证 ride-along → T1 E6 闸内执法（钉版实测变体矩阵+三选一决策记档，**实测优先验证 trustLockfile 是否已天然覆盖**——若成立放行依据升级为「上游机器腿闭合」）→ T2 产品备货一票 → T3 新鲜度腿工程 commit → T4 文书收口。微调：T2 中不依赖 E6 结论的机械部分（release.yml 编辑、版本 bump、checklist 核对）可与 T0 并行提前。
  - **阻塞语义=γ 条件阻塞**：仅当可核验触发条件命中才阻塞 0.0.8——(a) lockfile 在册已含闸内未成熟版本；(b) 回放可投毒构建产物；(c) trustLockfile 验证腿实测不覆盖且补偿控制失效。否则按 time-bound exception 放行。
  - **例外记档五要件**：①精确 policy 引用 ②justification（「未排期」不算）③已验证运转的补偿控制（lockfile review 纪律）④具名 acceptor（本仓=ADR 记档+用户裁决位）⑤固定到期日 ≤90 天（R81+1 轮内强制复验）+复验触发事件（pnpm 上游修复落地/lockfile 变更/新 GHSA）+续期须新 grill 轮立项（不自动滚记档）。
- **显式约束/负向需求**：自建护栏工程无条件归 R81 独轮（无论裁决结果）；产品先行（先货后闸）与合票均被否（publish 不可逆+异轨杂物筐）；α 纯记档不放行（无到期=undeclared policy change）；β 无条件阻塞被否（违反 NIST 补偿控制门槛）。
- **状态**：current

## D-003 — dsh-plugin 首发路径（预首发）

- **原问题**：dsh-plugin npm 首发路径——A 预首发（用户手发 0.0.7→配 TP→0.0.8 随车 OIDC）/ B 随车首发（tag 含新包）/ C 仅手发本轮（pack 接入递延）/ D 另指。
- **原回答原文**：「采纳」（对 A 的呈报）。
- **规范化需求**：
  1. 用户手动 npm publish @anysearch-cli/dsh-plugin@0.0.7（真实版本非占位壳；0.0.3 手动首发先例，无 provenance=ADR-0064 D-006 同类记档后果）。
  2. 用户在 npmjs 配置 trusted publisher（repo owner/name/workflow filename/environment 四字段；2026-05-20 起须显式勾选 allowed actions 含 npm publish；TP 上限认知更新=每包 10 个）。
  3. R80 T2 落仓：private→false+publishConfig.access=public+release.yml pack 清单接入 apps/dsh-plugin+全仓 0.0.8 sync-bump+publishing.md checklist 扩节（新包首发节）。
  4. tag v0.0.8 起五包统一 OIDC+sigstore provenance（dsh-plugin 覆盖起点=0.0.8）。
- **显式约束/负向需求**：v0.0.8 tag 前置条件=手动首发+TP 配置已完成，否则 pack 清单含 dsh-plugin 的 OIDC 腿必 ENEEDAUTH；若用户首发未就绪，tag 顺延而非临时拆包清单；不发占位包（0.0.7 真实可装验）；不自建幂等跳过腿（changesets#2164 实证坑+E409 非幂等）。
- **状态**：current

## D-004 — 派生件新鲜度腿形态（ship-gate 扩面+豁免通道+强度分档）

- **原问题**：新鲜度腿落点——A ship-gate step 1 家族扩展 / B release-gate pre-tag / C 独立 closeout 脚本（非闸化）/ D 另指。
- **原回答原文**：「采纳」（对 A+=调研修正版的呈报）。
- **规范化需求**：ship-gate step 1 家族新增断言（新子步 1j/9 或并入 1g 家族，粒度票内定），fail-closed 与 1b/1g 同构：
  1. **CHANGELOG 当前轮条目在场断言**（fail-closed）+显式豁免字段 no-changelog-entry: <理由>（changesets --empty 同构，防垃圾条目）。
  2. **可机验声明注册面**接入 closeout-coverage 信号面——可机验化域=计数类（有推导命令）/符号·路径存在性（文档提及脚本·闸名须在仓库实物存在）/日期·轮次号在场/结构化字段；声明与推导命令须同一次 diff 变更（golden-file 原则）。
  3. **闸强度分档**：在场性/计数类客观可修=fail；叙述一致性代理信号=先 warn 一轮再升 fail（防 token edits）。
  4. 人验专属域（叙述因果/人审裁定/外部未入库对照）留人验，但要求其引用的可机验基底已被机验。
- **显式约束/负向需求**：修的是覆盖缺口非造新闸（已覆盖面 adr-index/governed-json/handoff 字段不重复造）；B（release-gate 挂点）否——gate the merge rather than the release，病发面是每次收口；C（非闸化自律）否——复刻已四次失败路径；「声明重推导」为推断级先例（fitness function+executable docs 组合），ADR 如实标注。
- **状态**：current

## D-005 — R80 收口判据（三段式+四项调研补丁）

- **原问题**：收口判据——A 三段收口 / B 两腿绿即收口 / C 账本约定即可 / D 另指。
- **原回答原文**：「采纳」（对 A+=调研修订版的呈报）。
- **规范化需求**：三段收口判据，逐条可核验锚点：
  1. **(i) 取证段**：T0 实录（dsh rc.3/alpha.1 出闸态复核+#1764 哨，gh 不可达如实记未验）+E6 实验 transcript 归档+格式化结论行+观测窗口截至戳+三选一裁决落 ADR（例外放行则五要件齐+例外 ADR↔transcript/闸记录双链——Archer Knox Linked_Incidents 等价映射）。
  2. **(ii) 就绪段**：dsh-plugin private 翻转+publishConfig+release.yml pack 清单接入+pnpm pack 拆验+dsh plugin add 对 pack tarball 复验+全仓 0.0.8 sync-bump+publishing.md 首发节（TP 四字段+npm publish allowed-action 勾选警示+provenance 边界声明）+新鲜度腿落地（绿树绿/陈旧 fixture 红向实测）+dogfooding 本轮收口过新闸（发现 issue 处置记档）+**no-go 分支显式条目**（pack 拆验失败或 install 脏→顺延不拆清单）+turbo check/test+ship-gate 全绿+pnpm install 无脏。
  3. **(iii) 文书段**：ADR-0081（发布就绪轮主题/四腿/γ 阻塞语义/首发路径/新鲜度腿设计/rejected alternatives+provenance 保证边界注记——origin 非 integrity）+registry 更新（dsh-plugin-npm-publish 更态+lockfile-agegate 记裁决/例外到期+10 债续记）+CONTEXT 新词+handoff（R81 候选）+判据↔证据映射表+度量单行+.gitignore round-80 白名单+**pathlint 棘轮表述宣告**（豁免域基线只减不增+新豁免走 ADR 修订路径+回归击穿=stop-everything——非冻结措辞）+**审计红 commit 工序例外注记引 ADR-0074 rewrite-map 为处置预案**+用户动作清单（手发 0.0.7→TP 配置→tag→外发 drafts）+but 干净。
- **显式约束/负向需求**：no-go 分支须为判据文本可核验条目非隐含语义；冻结措辞禁（例外只增不减=审计判规则后门），一律棘轮表述；dogfooding 须产证据非仅通过；provenance 过度声明禁。
- **状态**：current
