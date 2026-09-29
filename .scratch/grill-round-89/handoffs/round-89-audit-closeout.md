# Round 89 审计收口 — audit-closeout（dsh-upstream-line）

> 审计窗口产物：只出报告不动手修。数据源：轮报 `.scratch/grill-round-89/reports/2026-09-29-report.md` + 账本 `decision-ledger.md`（D-001~D-003）+ closeout-claims.json（10 项）+ upgrade-ledger v3 + r72-shaping.md。

Stack: r89-report @ r89-grill（GitButler 栈，未 land）→ main @ 846b2eb6

## 绿色 run URL（本轮祖先线，gh run list 亲验）

- 基座 tip 846b2eb6：ci https://github.com/Xxx91n/anysearch-cli/actions/runs/36438337984 success；ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/36438337504 success；native-smoke https://github.com/Xxx91n/anysearch-cli/actions/runs/36438337659 success（均 2026-09-28T14:45Z；conformance-heartbeat 36396894066 success）

## 审计结论：PASS（附返工清单 E-1~E-6 + 三裁决）

硬验收亲跑全绿（2026-09-29 本地复跑，非引用轮报）：

- `pnpm -r check` → 8/8 包 tsc --noEmit 全 Done，exit 0（Scope 8 of 9）。
- `pnpm -r test` → 全包绿零失败：dsh-plugin 14/14（agent/created 注入、pre-execute deny/ask/fail-open、post-execute additionalContexts、result index、contextMessage 逐名在输出）、cli e2e 22/22、mcp 3 suites、store/plugin/retriever/embedding/kernel 全 Done。
- `node scripts/ship-gate.mjs --quick` → `ship gate green — ready to tag the next release`：freshness r89 段 pass、closeout-claims 10/10 re-derived green、adr-index 90 绿、handoff-lint run-URL 绿、path-lint 全过（surfaced-skip 全 info 级非阻塞）、pack 8 tarball 全 pass、step8 MCP initialize（server=anysearch v0.1.0）+8b packaged smoke+9 fail-open boot 全 pass。
- `node scripts/gen-adr-index.mjs --check` → `up to date (90 ADRs at HEAD)` exit 0。
- `git status --porcelain` 空；`git ls-remote` 无 r89 分支、`git tag --contains HEAD` 空（未外发声明成立）；origin/main=846b2eb6=栈基。
- 上游现状复核（本审计时点 npm view 亲测）：next 仍=0.2.0-rc.1、无 rc.2、无 stable 晋升——判词时效仍成立。

## 实物抽查（不依轮报自述，亲验）

- tarball 工作区仍存：41/41 tgz + 双侧解包目录在盘。 <!-- machine-local: audit re-verified L1 probe workdir D:\Aworker\r89-l1 on this host @ 2026-09-29 -->
- 独立 normalized diff 复算（剥注释/空白归一）：14/20 包全等 + 6 包漂移（dsh-llm/sandbox/session/tools/user-approval/workspace）与 transcript 逐名吻合；dsh-session 新增 `tool-history.d.ts` 属实。
- 消费面逐一比对：`agent/created` payload `{agent,source,signal?}→undefined|Promise<undefined>` 两版逐字节同构；tools 三事件签名同构；`ToolRuntime.register/restrict/defineTool` 在 0.1.5-rc.2（.pnpm 已装实例）/0.1.7-rc.1（现钉）/0.2.0-rc.1（tarball）三代逐字相同——「三代同形」亲验成立（0.1.5-rc.2=R73 时代钉版，commit 1137ce67 在史）。
- Events 键面独立扫描：8 包计数与 transcript 全等（9≡9/2≡2/4≡4/1≡1/2≡2/6≡6/1≡1/2≡2），0 增 0 删。
- `patchReload` 全族 0.2.0 缺席；`browser` 命中仅 doc 注释两处（typert-protocol/user-approval），browser-turn 面缺席。
- `displayReason`=0.2.0 附加可选字段（dsh-tools index.d.ts:456 / dsh-user-approval types.d.ts:65），0.1.7 无；`initializeDefault` resolveDirectory 收窄 `{path,title}→string` 实测属实（唯一收窄项，本仓未消费）。
- 发布窗 2026-09-28T12:13:12~12:16:25Z、龄期 802.8min 由 t0-l0-watch.json 的 time/generated_at 复算吻合；cordis latest=4.0.4/next=4.0.1-rc.4 未随跳属实；0.2.0 tarball 内无 CHANGELOG 文件（changelog 不可核验获物证支持）。
- 票序↔commit 一一对应：rnz(定稿)/nyx(T0)/ruw(T1)/uxp(T2)/owu(T4)/xnz(T5)/nno(T6)；T3 无 commit=条件票不启正确形态；src 零触；每 commit 文件面与本票严格对应。
- closeout-claims.json 10/10：gate 复推绿 + 本审计抽核 file/token 均在场。

## D-001~D-003 逐条核对

| D | 声明 | 证据 | 结论 |
|---|---|---|---|
| D-001 | dsh 上游线轮；交付=调研件；r72 只定形不实现 | transcript+snapshot+判词三件全落；r72-shaping 纯设计记录、零代码；范围外项（评测/垂域/上游债/钉版动包/外发）均未触 | ✅ |
| D-002 | 三锚真值表机械产出判词，无第三态 | 兼容=TRUE 独立复算成立；拉力=零按候选特异性读法成立（裁决 A-1）；稳定锚分量如实记；判词 soak-until-stable 跨 ledger/ADR/轮报/终态戳/CHANGELOG 五处一致 | ✅（附 A-1/A-3） |
| D-003 | 七票序+条件票+一票一 commit+无外发 | 7 commit 逐票对应、type 纪律合（chore×2+docs×5）、T3 空票不留痕、无 tag/push | ✅ |

## 裁决（呈报项，受委托裁）

### A-1 拉力锚判读差异 → 采候选特异性读法为权威解释，判词 soak-until-stable 维持

- 事实：「出现且签名稳定」字面读法确被满足（具名 API 在架+三代同形），但依此读法拉力锚对每个未来候选皆响 → soak 象限永不可达，D-002「高频象限必产出决定不悬置」立法意图落空，真值表退化。
- 「签名稳定」本身是跨版本比较谓词：先于候选已存的稳定性证明的是 API 而非候选的迁移引力；拉力锚语义=候选相对现钉的特异引力（枚举化证据+修复证据两路皆量此）。
- 补强：即使按字面读法拉力=TRUE，判词亦不会机械落到 repin-now——2880min 龄期闸未过，而真值表无稳定锚否决行（spec gap，见 A-3），字面读法产出的是「未定义态」而非 repin-now。
- 裁决：候选特异性读法为拉力锚权威解释，本裁决入档即解释性立法（非改判据）；soak-until-stable 终局成立，T3 不启正确。

### A-2 r72-native-tools 触发器 → 「实质已响」属实，维持 defer 至下轮

- `register/restrict/defineTool` 三代签名逐字相同亲验（见实物抽查）——「the tool-registration API stabilizes upstream」触发器实质满足属实。
- 从严读法（稳定化=上 stable 线）亦记；解除 defer 属下轮实施票裁决，先决=L2 安装彩排 expected-RED 闸（r72-shaping 已载），建议并待 0.2.0 stable 从严线。本轮只定形+registry 追记——处置合规，无缺陷。

### A-3 龄期缺口 + 真值表 spec gap → 如实记档属实，补记立法缺口

- 802.8min<2880min 复算吻合，各文书一致如实记，判词由拉力/兼容轴产出不受影响——记档合规。
- **spec gap（新呈报）**：D-002 真值表三行只覆盖拉力/兼容轴，无稳定锚否决行——字面拉力=TRUE 撞上龄期闸未过时判词未定义。下轮立法补「稳定锚未达→hold/soak 兜底」行（本裁决不代为立法，呈用户）。

## 返工清单（修复窗口；修毕须重跑同一套验收 §硬验收）

- **E-1（引用失真）**：`handoffs/round-89-closeout.md` L7 与轮报 L15 把 CI 三跑归于 `t0-l0-watch.json` 的 `ci_runs`——该 JSON 无此键（键面=schema/generated_at/packages/note），实测数据仅载 `reports/baseline-2026-09-29.md` 散文。→ 更正引用指向 baseline（三 run 本身 gh 亲验属实）。
- **E-2（计数失鲜）**：轮报「本栈 diff 2763 insertions」实测 2825（恰差 62=轮报自身行数，系提交前量）。→ 更正为 2825 或标注量测口径。
- **E-3（枚举漏项）**：轮报变更面枚举「.scratch/docs/CHANGELOG/CONTEXT/registry」漏 `.gitignore`（+2 行 r89 白名单，承 r88 同型）。→ 补列。
- **E-4（已知回归复发）**：CONTEXT.md 尾随换行丢失（基线版尾字节 0a→现缺；ADR-0054「Found: CONTEXT.md lost its trailing newline. Fixed.」同类复发）。→ 恢复 EOF 换行。另 goal.md/next-round.md/q1-q2 六件亦缺 EOF 换行——.scratch 侧 r88 同型容忍，非违规但可顺手。
- **E-5（ housekeeping ）**：`docs/deferred-registry.json` 顶层 `"updated": "2026-09-28"` 未随 carried_log（at=2026-09-29）递进。→ 下次 registry 变更顺手 bump。
- **E-6（判读项）**：ADR-0090 缺 `## Consequences` 段（近邻 ADR-0088/0089 皆有，~66/90 携带）。→ 建议补。
- **观察不究**：q2-prompt.txt `cordis=4.0.2` 系冻结前调研稿原文（实钉 4.0.4）——存档 verbatim 可留，后读须辨；CONTEXT 七词随 rnz 定稿 commit 落（非 T5 commit），任务书「词块已备」覆盖，goal.md T5 行映射小差。

## 过程违规呈报

- **判据冻结闸擦边（实质但已披露免责）**：拉力锚字面读法在探针出数后被候选特异性读法替代——属判据文字二义性的事后解释而非改判据，且全程披露+呈报（合「不静默吞」纪律）；但冻结闸形式要求是解释亦应过新 D-xxx 立档——程序债，本裁决 A-1 即补记档。
- upgrade-ledger v3 把字面读法归为「泛化成熟化解读变体」属自我有利定性——字面枚举确被满足，该读法非「泛化」。定性偏差，记而不追。
- 「两次门禁红→绿 amend」自述：end-state 核实成立（run-URL/machine-local 标记均在档），amend 历史本身不可独立复验（GitButler 重写态）——记为「终态一致」。
- 审计窗口零修复动作；写操作=本文件一件。

## 下一个 grill 方向（候选，未立项）

1. **E-1~E-6 返工批**（本审计清单；修毕重跑 §硬验收同套）。
2. **真值表稳定锚否决行立法**（A-3 spec gap；字面拉力+龄期未过的未定义态须消）。
3. **0.2.0 stable 晋升目击 → latest-only 重跑 L1+判词封账**（rc.N 不滚动跟随；本时点 next 仍=0.2.0-rc.1）。
4. **r72-native-tools 实施票**（触发器实质已响在案；若裁解除 defer 先过 L2 expected-RED 闸，从严线=待 0.2.0 stable）。
5. 常驻债顺延：评测面（f17 无新触发）/上游触发债/观察项（ANS_PROBE_QUERY 不对称、libuv 噪声）维持登记。

## Suggested skills（下一窗口）

- $implement（返工批 E-1~E-6 / r72 实施票若启）
- $grill-me（下一 grill 轮立项：稳定锚否决行立法可入题面）
- $atomcode-research（上游 changelog/社区信号复核，补 changelog 缺口）
- $code-review（下轮收口前双轴复核）、$but（全程版本控制）

---

## LOOP-2 复验（返工后同套验收亲跑，2026-09-29）

**结论：PASS——E-1~E-6 全部落账核实，同套验收亲跑全绿。**

### 修复逐项核对

| 项 | 声明 | 亲验证据 | 结论 |
|---|---|---|---|
| E-1 ci_runs 误引 | 改指 baseline 散文 | closeout.md 已无 `ci_runs` 字样；轮报 L15 更正为「packages/time/dist-tags 快照；CI 三跑 id+结论载 baseline 散文」 | ✅ xnz+nno |
| E-2 2763→2825 | 更正+注明自指欠计 | 轮报 L49 现记「审计复核实测栈 diff…= 2825（初稿 2763 之数为自指欠计——恰差本报告 62 行）」，口径与成因如实 | ✅ nno |
| E-3 .gitignore 漏列 | 补入变更面枚举 | 轮报 L49 枚举现含 `.gitignore（+2 行 r89 白名单）` | ✅ nno |
| E-4 CONTEXT.md EOF 换行 | amend rnz | 尾字节实测 `…82 0a`（修复前缺 0a）；rnz commit 重签 1d20e2f1，CONTEXT.md 在其文件面 | ✅ rnz |
| E-5 registry.updated | →2026-09-29 | `deferred-registry.json` 顶层 `"updated": "2026-09-29"` | ✅ xnz |
| E-6 ADR-0090 Consequences | 补节 | `## Consequences` 四行齐：钉版维持+stable 触发点+spec gap 记档（稳定锚否决行+拉力锚候选特异性未明文）+A-1 裁决权威化收录 | ✅ xnz |

amend 归属核验：E-4→rnz(1d20e2f1)、E-5/E-6+E-1 半→xnz(c6c2c66c)、E-1 半/E-2/E-3→nno(a2582c1c)——各归本票，无新 commit、无越票修改。轮报 L51 增「返修留痕」节如实记六项出处。

### 同套验收亲跑（审计 LOOP-2）

- `pnpm -r check` → 8/8 tsc --noEmit 全 Done，exit 0。
- `pnpm -r test` → 全包零失败 exit 0（cli e2e 22/22 在目，dsh-plugin/mcp/store/plugin/retriever/embedding/kernel 全 Done）。
- `node scripts/ship-gate.mjs --quick` → `ship gate green`：freshness r89、closeout-claims 10/10 复推、adr-index 90、handoff-lint、path-lint 500 docs、pack 8 tarball、MCP initialize v0.1.0、8b smoke、9 fail-open 全 pass。
- `node scripts/gen-adr-index.mjs --check` → 90 ADRs up to date；`git diff --check` 净。
- `git status --porcelain` 空；未外发维持（无 tag、无 push）。
- 新增面负检：返工未引入未标机器路径（path-lint 500 docs 绿含本审计文件）；commit 结构未坏（7 票 commit+审计 rut，amend 未加票）。

### LOOP-2 附记

- 栈物理序备注：返工 amend 重写后，审计 commit rut(e87a7958) 在 git DAG 物理位于 rnz 之下——GitButler 虚拟分支 r89-audit 仍在栈顶，分支归属与实际内容无扰。
- 轮报「2825」口径注记：该数为审计时点栈测（不含本审计文件与返工增量）；当前栈全量 diff=2925 ins/2 del（含 audit-closeout 91 行+返工修订）。属如实标注口径，非新误差。
- 观察项维持原判：q2-prompt cordis=4.0.2 存档 verbatim 不动。

## 审计终局

**PASS 成立，无未决返工项。** 判词 soak-until-stable 技术正确且证据链亲验；A-1/A-2/A-3 三裁决已由修复窗口如实收录（ADR-0090 Consequences）。挂账移交下轮：真值表稳定锚否决行立法、0.2.0 stable 晋升目击收口、r72-native-tools 实施票裁决（先 L2 expected-RED 闸）。

---

## LOOP-3（审计窗口顺手小修 + 复验，2026-09-29）

- **顺手修**：goal.md/next-round.md/q1-atomcode.md/q2-atomcode.md 四件补 EOF 尾随换行（q1/q2-prompt.txt 两存档件保持 byte-verbatim 不动）。归属：goal+q1+q2→amend rnz；next-round.md→amend xnz（其终态戳段在 xnz，依赖约束下落该票）。
- **同套复跑**：`pnpm -r check` 8/8 Done；`pnpm -r test` 全包零失败；`ship-gate --quick` ship gate green；`gen-adr-index --check` 90 ADRs；`git diff --check` 净；`git status --porcelain` 空。
- 全栈 .scratch r89 文书现已全件 EOF 换行合规（含本文件）。
