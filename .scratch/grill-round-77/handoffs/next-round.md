# Round-77 任务书 — 双轨「治理残账清算」实施

Date: 2026-09-22. 账本 `.scratch/grill-round-77/decision-ledger.md`（D-001~D-005 全 current，唯一权威数据源）；调研存档 `q2-atomcode.md`。Stack 约定：`r77-grill`（本文档）← 实施栈叠其上。

## 状态快照（接手即知）

- main tip=a797815a（R76 三栈已全落），工作区干净；registry 14 条=3 closed+11 open。
- 上游哨戒实测（2026-09-22）：`@deepseek-ai/dsh-agent` 今日连发 0.1.5-rc.3（05:39）+0.1.7-alpha.1（06:04），**两版均在 minimumReleaseAge:2880（48h）闸内**，出闸≈2026-09-24 06:0x；transformers 仍 4.3.0；#1764 仍 OPEN。
- 现役钉版：15 个 @deepseek-ai/dsh-*=0.1.5-rc.2+cordis=4.0.2（catalog 单点+overrides 逐名枚举，pnpm-workspace.yaml）。
- R73 蓝图实物：`.scratch/grill-round-73/upgrade-ledger.md`（改名映射/payload diff/source-guard 伪码/采纳触发器/预演记录）；改名在 0.1.6-alpha.2 已被 R73 T2 实证（单错 RED@src/index.ts:87）。

## T0 — 轨一探针取证（覆盖 D-002 前半+D-005(i)；纯证据零源码）

1. **L0 watch 快照**：`npm view @deepseek-ai/dsh-agent versions --json`+`time --json` 全族版本+publish timestamp 归档 `evidence/t0-l0-watch.json`（喂龄期闸日历）。
2. **pin 版消费面 API 期望快照**：对现役 0.1.5-rc.2 提取我仓消费面（`keyof Events` 键集+`apps/dsh-plugin/src/index.ts:87` 实际消费的 payload 字段）→落 `evidence/t0-api-snapshot-rc2.json`（Consumer API Snapshot——快照本体必须落盘，下轮对照基）。
3. **L1 静态探针**：`npm pack` 拉 0.1.5-rc.3+0.1.7-alpha.1 tarball 到机器临时目录（**不提交 tarball**），解包 .d.ts 与同法快照 diff——逐版本 transcript 落 `evidence/t0-l1-<ver>.md`：Events 键面/payload diff/家族包数（0.1.7 或超 17）。**逐版本显式 ALARM 判定**（含「无 alarm」结论）。0.1.6-alpha.2 作对照锚（R73 已实证，复核其 .d.ts 面）。
4. 探针产出三问答案：改名是否已上稳定线（rc.3）？payload 是否再变？家族包数是否再扩？——T2 措辞依赖。

验收：每版本 transcript 归档+ALARM 判定显式+无 lockfile/workspace 任何改动（`git status` 零脏）。

## T1 — 轨二 backlog 清算（覆盖 D-003 七项；同票 diff 语义分组）

修复面：`scripts/closeout-coverage.mjs`+`scripts/governed-json.mjs`+`scripts/ship-gate.mjs`（+对应测试文件）。七项：

1. titleRound 误登记面→收紧为确切行形状匹配（非「含 Grill Round N 文字」）；
2. `grill-round-<非数字>` dir 隐形→scanRoundDirs 显式计数/报告（fail-loud 或 surfaced skip，两漂移方向都可见）；
3. coverage `fail()` 先于 leg-(a) lint→调序或合并输出，红态下 lint 诊断不被压（观测序变化补申报）；
4. canonical 锁空清单报 pass→fail-closed（自身立法自食）；
5. F-5⑥ parser 行形状↔gen-adr-index render 措辞→解耦或互注；
6. F-5⑦ `gov-r76-registry-canonical-lock` 条目补 sibling 字段（title/source_adr/opened_at/owner/deadline/review_cadence/monitoring_channel）——**编辑走 canonical normalize 流程=字节锁第二轮自食其锁实证**；
7. F-6 BOM 报错→专门文案教修 BOM（normalize 修不了 BOM 须明说）。

验收：每项红方向实测行使（fixture/探针断言具体报错）；`pnpm run check`+`pnpm run test` 绿+相关腿直跑+`node scripts/ship-gate.mjs --skip-matrix` 绿；leg-b 字段 lint 面不动（已核销契约不改写）。

## T2 — 文书收口（覆盖 D-002 后半+D-005(iii)）

1. **registry 改写**（全走 canonical normalize 流程）：`defer-r73-dsh-event-rename` 触发器→特征+稳定性双锚（删版本号「0.1.6-rc.1」）+monitoring_channel 改漏斗语义；被跳窗版本写墓碑条目（若产生）；落选债逐条 `carried_log` 续记；`updated` bump。
2. **`upgrade-ledger.md` v2**：降层 cadence（每版 L1 证据+留档，L2 只给采纳候选）+L1 证据对 expected-RED 的先验预测+本轮探针结论。
3. **ADR-0078**：分层漏斗+双锚触发器+respect-and-schedule+latest-only/墓碑政策+**ADR-0074 cadence 修订记录（leapfrog 证伪+工具收敛先例）**+不 bump 判定（repo 治理/工具链改动非发布态代码）。
4. CONTEXT 新词已随 grill 定稿落盘（本 commit）；handoff 写 `round-77-closeout` 方向+#1764 哨+外发闸+L2 排程态（dated obligation 或 no-qualifying-candidate 显式结论）。
5. pathlint 登记 round-77（`ship-gate-pathlint.config.json` scratchDocDirs）+ship-gate/turbo 全绿+but commit 干净。

## L2 排程（条件式，D-005）

L1 检出合格候选（ALARM+rc-or-stable）→记 dated scheduled obligation（出闸≈2026-09-24 06:0x+latest-at-exit 规则）入 registry/ledger/handoff，本轮收口不等实跑；无合格候选→显式结论入档。期间新发版致候选跳线→被跳者写墓碑非补演。

## 红线（账本负向需求）

不绕龄期闸不开豁免（scratch-dir 装今日版=违约）；触发器永不含版本号；alpha 线只 L1 不例行 L2；探针证据与 registry 改写不混票；不 bump 版本；外发闸不代发；grill 文档先落盘再动手。

## 落选债承接（9 条原名，carried_log 显式续记）

`defer-r71-transformers-undeclared-dep` / `defer-r71-provider-serverside` / `defer-r72-dsh-plugin-npm-publish` / `defer-r72-dsh-native-tools` / `defer-r72-dsh-web-interactive-matrix` / `defer-r74-logo-bitmap-matrix` / `defer-r75-registerhooks-esm-arm` / `defer-f16-macos-native-crash` / `defer-f17-quarantine-ids` / `defer-anysearch-domain-ownership`（defer-r73-dsh-event-rename 本轮轨一处置中，按 T2 结果改状态）。

## Suggested skills

`$implement`（续作驱动）· `$tdd`（红方向实测纪律）· `$handoff`（收口交接）· `$atomcode-research`（上游战场再变时补研）· `$but`（版本控制）· `$code-review`（复审可选）。

无秘密值落档；证据/文稿全 repo-relative 引用；探针 tarball 留机器临时目录不提交。
