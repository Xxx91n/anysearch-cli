# R71 任务书 — 上架首航（next-round）

生成依据：`D:\Aworker\anysearch-cli\.scratch\grill-round-71\decision-ledger.md`（唯一数据源，4 条 current：D-001/D-002/D-003/D-004）。
调研存档：`D:\Aworker\anysearch-cli\.scratch\grill-round-71\q2-atomcode.md`、`D:\Aworker\anysearch-cli\.scratch\grill-round-71\q3-atomcode.md`。
锐评原文：`D:\Aworker\anysearch-cli\.codex-tmp\锐评.txt`（第六轮）。

Stack：分支 `r71-grill`，base `448b5f91`（main tip，三绿实证）。GitButler 提交；与其他分支并行互不影响。

路径注：本任务书按现役 Deliverable-Path-Discipline 全绝对路径书写；T0 落地新教义+历史清扫后，本件随众机械转 repo-relative。

## 总验收基线（沿用既有，每票相关部分必跑）

- `pnpm build`、`pnpm -C packages/store test`、`pnpm -C apps/plugin test`
- `node scripts/ship-gate.mjs --quick`（57×pass 基线）+committed transcript
- assert-checks-green ESM 夹具全腿
- 真实 CI/ship-gate workflow run URL 引证（主张-引证教义）

---

## T0 — 门禁地基（覆盖 D-002 全部、D-001 地基部）

标的：`D:\Aworker\anysearch-cli\scripts\ship-gate.mjs`、`D:\Aworker\anysearch-cli\.github\workflows\release.yml`、`D:\Aworker\anysearch-cli\AGENTS.md`、`D:\Aworker\anysearch-cli\docs\adr\0071-architecture-grill-round-70-verification-timing-hardening.md`、`D:\Aworker\anysearch-cli\.scratch\grill-round-70\handoffs\round-70-closeout.md`。

必改：
1. **timeout-min 10→15**：`release.yml` assert-checks-green 调用点（武装触发器兑现——ADR-0071 分位数自证 740s>600s，一行）。
2. **教义精化**（AGENTS.md Deliverable path discipline 节）：定位器/Stack=绝对路径不变；库内目标引用=repo-relative；库外目标=绝对路径+声明标记 `<!-- machine-local: <reason> @ <date> -->`（裸声明=违规）。
3. **ship-gate fail-closed 新腿**（step-1 家族，与 SHA/URL/parity leg 并列）：可配置扫面清单（docs/**/*.md+.scratch 全 markdown 目录清单，新文档类型显式登记）；机器本地路径正则（^[A-Za-z]:[\\/]、/Users/、/home/、AppData、/tmp/，防 https: 误伤）；带完整治理字段的声明标记豁免。
4. **历史机械扫**：`D:\Aworker\anysearch-cli\` → repo-relative 无损变换（.scratch 入库文档全量+docs/adr 命中处）。
5. **Temp transcript 入库**：`C:\Users\Administrator\AppData\Local\Temp\r70-audit\` 审计 transcript 复制入 `D:\Aworker\anysearch-cli\.scratch\grill-round-70\evidence\`（默认提交；仅确认无保留价值才改走哈希+销毁声明）。
6. **ADR-0071 四处+R70 closeout** 路径随票修。
7. **先红后绿证据对**：lint 腿先抓现存违例（红 transcript）→清扫+声明后转绿（绿 transcript），双件存档 `D:\Aworker\anysearch-cli\.scratch\grill-round-71\evidence\`。

红线：禁一刀切禁绝对路径；禁 .scratch 豁免；禁 grandfather；禁未启 gate 先宣称修完。

Suggested skills：implement、tdd（lint 腿先红后绿）、code-review。

---

## T1 — embedding 默认路径（覆盖 D-003 全部、D-001 产品部）

标的：`D:\Aworker\anysearch-cli\apps\cli\src\commands\doctor.ts`、`D:\Aworker\anysearch-cli\scripts\install-smoke.mjs`、`D:\Aworker\anysearch-cli\README.md`（+zh-CN parity）、各发布包 `package.json`（devEngines 剥离面）。

顺序（三件套按序，commit 粒度可拆）：
1. **Spike 双臂**（先取证后动手）：npm 全局+pnpm 全局各一臂 clean install `@anysearch-cli/cli@0.0.5`+`@anysearch-cli/embedding@0.0.5`——四断言：(a) `ans doctor` 报 vector arm present；(b) `ans memory backfill-vectors` 对存量 memory 生效；(c) 卸载 embedding 后 Jaccard 降级无回归；(d) 首用下载失败报错质量（代理/离线可操作）。transcript 全量存档 `D:\Aworker\anysearch-cli\.scratch\grill-round-71\evidence\`。
2. **EBADDEVENGINES 剥离（无条件即修，不被 spike 卡死）**：publish 前剥 `devEngines`（prepublishOnly/pack 过滤机制——查现行 pack 管线落点）；pnpm 锁定保留 `pnpm-workspace.yaml`+`packageManager`；验证=剥离后 `npm i` 无 EBADDEVENGINES。
3. **可达性落地**（按 spike 证据择一）：路径通→doctor SKIP 文案改可执行指引（install+backfill 两步 copy/paste）+README post-install 段（双语 parity 同步）+install-smoke embedding 激活腿；路径断→修断点本体（显式双包并列文档或 CLI fallback 解析）；断点超票→limitation 入 ADR-0072+docs/limitations.md，不阻塞 T2。

红线：禁 bundled default 重裁；禁文档面 only 不实测；禁 spike 复现不了虚标 fixed；双臂缺一臂不算完。

Suggested skills：diagnosing-bugs（spike+断点定位）、implement、tdd（install-smoke 腿）。

---

## T2 — 0.0.6 真发布（覆盖 D-001 发布部、D-004(iii)）

前置：T0 timeout-min 已 land（门带着修正后的锚迎首个真客）。

执行：
1. 版本 bump：四发布包 @anysearch-cli/{cli,mcp,plugin,embedding} 0.0.5→0.0.6；root package.json 0.0.3 顺手对齐（锐评小刀，未发布纯一致性）；未发布包（store/kernel/retriever）版本策略票内裁（跟随或留）。
2. CHANGELOG 0.0.6 条目（发布内容=R68-R71 全 delta+本轮地基/产品件）。
3. 走真发布流：pre-tag（workflow_dispatch runPurpose=pre-tag→ledger commit+层一 wait）→tag v0.0.6→push 触发 post-tag（层二 assert+publish）。
4. **烧 look 4**：eval-looks.json 入账一行（正业非演练）。
5. 发布后验证：`npm view @anysearch-cli/{cli,mcp,plugin,embedding} version`=0.0.6；registry tarball LICENSE=canonical；`npm i -g` 无 EBADDEVENGINES；三绿 run URL 实证（pre-tag wait+post-tag assert+publish 各引）。

红线：发布不得绕过双层门任何一层（那恰是本票要验的）；失败按 alert-and-block 既有流程走不手工强拆。

Suggested skills：implement、code-review（发布 diff 复审）。

---

## T3 — 文书+收口（覆盖 D-004 全部、D-001/D-002/D-003 文书部）

1. **ADR-0072**（`D:\Aworker\anysearch-cli\docs\adr\0072-architecture-grill-round-71-*.md`）：主题+D-001~D-004 决策条目+Closure evidence 四段回填。
2. **CONTEXT.md** R71 词块已在账（6 条）；实施中新增规范词再补。
3. **CHANGELOG.md** 与 found/fixed/deferred 三元组逐条闭环（含 spike 发现/锐评三刀处置逐条）。
4. **收口文档 dogfood**：round-71-closeout+本报告自身按新路径教义书写（lint 绿自证）。
5. **四段收口证据**（D-004）：地基段/产品段/发布段/文书段逐段齐。
6. goal.md 定稿+but commit 后工作区干净。

Suggested skills：domain-modeling（ADR/词块）、handoff（closeout）、code-review、neat-freak。

---

## 显式范围外（D-001 移交）

1g 覆盖缺口（isCloseout 关键词+回退掩盖——R70 F1 自首在案）/ macos-spillover-probe 三连红（EXPERIMENT 门外追查）/ provider 服务端排查（涉外部服务端）/ deferred 大项池（cursor/F-01a/npm provider/projectIndex/TUI/cross-OS/plugin/watch）——不 silently 拉入。
