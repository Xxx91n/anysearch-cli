# R70 任务书 — 验证层时序语义硬化（next-round）

生成依据：`.scratch/grill-round-70/decision-ledger.md`（唯一数据源，4 条 current：D-001/D-002/D-003/D-004，无断号）。
调研存档：`.scratch/grill-round-70/q2-atomcode.md`。

Stack：分支 `r70-grill`，base `2f6d990a`（main tip，三绿：ci 35333789515 / native-smoke 35333789487 / ship-gate 35333789476）。GitButler 提交；与其他分支并行互不影响。

## 总验收基线（沿用既有，每票相关部分必跑）

- `pnpm build`、`pnpm -C packages/store test`、`pnpm -C apps/plugin test`
- `node scripts/ship-gate.mjs --quick`（57×pass 基线）+committed transcript
- assert-checks-green ESM 夹具全腿（现四腿+T0 新腿）
- 真实 CI/ship-gate workflow run URL 引证（主张-引证教义）

---

## T0 — F-S4 落地（覆盖 D-002 主、D-001 主线、D-003）

标的：`scripts/assert-checks-green.mjs`

必改：
1. **Phase 1 discovery 严格谓词**：全部 5 family（check-build/install-smoke/test:online/ship-gate/memory-eval）在 `--discovery-sec`（默认 120）内各注册 >=1 check-run；到期未齐 → exit 2，错误行点名 missing families 与 present families（phase=discovery 标注）。
2. **Phase 2 completion**：全 family 到齐后，latest check 全 terminal+allowed → GREEN exit 0；`--timeout-min` 仍从进程启动起算（绝对 deadline 全程锚，不改语义）。
3. **RED 两段内即时短路**（TERMINAL_BAD → exit 1 fail-fast，发现段同样生效）。
4. **错误行按 phase 拆分**：discovery 失败=missing/present 分列；completion 超时=pending checks 点名；exit code 沿用（2=fail-closed 两相可同码，消息必须分相）。
5. **头注更新**：现行「discovery window only applies while ZERO checks match」段改两段式语义+F-S4 溯源；release.yml 调用点 flag 不变（--timeout-min 10 --discovery-sec 120 --interval-sec 20）。
6. **ESM 夹具新腿**（先红后绿证据对）：partial→all 到齐转 completion；family 永不出现→exit 2 点名 missing/present；stale conclusion 落 completion 段（不误判为 discovery 失败）；保留原四腿（all-ok/stale/empty/真 SHA）。夹具位置随既有 harness（R68/R69 审计跑过的同一套）。
7. **真 SHA `--once` 干跑 transcript**：对当前 main tip 实跑一次存档 `.scratch/grill-round-70/evidence/`。

红线：禁 re-anchor timeout-min；禁加 --completion-min；禁 --once/exit 10 行为改动；禁动 release.yml flag 值（语义不变）。

Suggested skills：tdd（夹具先红后绿）、implement、diagnosing-bugs（如谓词边界意外）。

---

## T1 — jitter 处置（覆盖 D-001 次级、D-003）

标的：`packages/store/test/*.integration.test.mjs`（4 件 spawnSync 型）。

Spike-Gated 两段：
- **Spike**：负载下复现——定位哪 2 个测试败+失败签名（timeout? spawnSync 资源? 端口争用?），transcript 存 `.scratch/grill-round-70/evidence/`。
- **处置三裁一**（按签名定）：(a) 挂 Flaky Case Quarantine 既有机器（ADR-0027/0065：隔离+SLA+ratchet）；(b) test 级 retry/timeout 调整（现 --test-timeout=30000）；(c) `docs/limitations.md` 记档。
- **复现不了**：诚实记档 limitations+本票 spike transcript 引用，不虚标 fixed。

红线：禁为消抖放宽断言；禁把 quarantine 用在非 golden 件上而不评机制适配性（golden 机器是否适配 integration 测试是票内裁决点）。

Suggested skills：diagnosing-bugs（复现+签名定位）、tdd（如落 retry）。

---

## T2 — 文书（覆盖 D-002 ADR 三件、D-001、D-004(iv) 部）

1. **ADR-0071**（`docs/adr/0071-architecture-grill-round-70-*.md`）三件必录：
   - Stub-Registration Invariant（每个 required family 必有壳保证注册，禁改原生 paths: 过滤——community #44490 拓扑痛点）；
   - C 升格触发器（discovery 常态>30s 或 completion 吃紧事故→Temporal 式双预算）；
   - 近 30 次发布 check 耗时分位数证据（gh api 实查近期 run，佐证「注册秒级」内部事实——若 p99 接近 8min 须呈报重新评估 A″ 尾部侵蚀）。
   - Closure evidence 段预留（T3 回填）。
2. **CONTEXT.md** R70 词块已写入（6 条，ADR-0071 标题下）——实施中新增规范词再补。
3. **CHANGELOG.md** 相应条目。
4. **found/fixed/deferred 三元组**逐条闭环（含 spike 发现）。
5. 全部交付物路径=绝对路径（交付物路径纪律）。

Suggested skills：domain-modeling（ADR/词块）、handoff。

---

## T3 — 收口（覆盖 D-004、D-003）

四段收口证据（D-004）：
- (i) F-S4 段：T0 diff+头注+夹具先红后绿证据对+真 SHA --once transcript+land commit 上 ci+ship-gate 真实绿 run URL；
- (ii) jitter 段：spike transcript 全量+处置落地或 limitations 记档引用；
- (iii) 值守段：ship-gate --quick 亲测 transcript 绿（57×pass 基线）+release.yml flag 语义未漂/同步 diff；
- (iv) 文书+收口段：ADR-0071 Closure evidence 回填+CONTEXT/CHANGELOG/账本对账+goal.md 定稿+round-70-closeout handoff（Stack+绿 run 引证，绝对路径）+but commit 后工作区干净。

Suggested skills：handoff（closeout）、code-review（收口前复审）、neat-freak。

---

## 显式范围外（D-001 移交）

真 release 摘 partial 帽（烧 OF look）/ agy ans-MCP P7 真链（需起 ans server）/ PR-mode required-checks 治理 / deferred 大项池（cursor/F-01a/npm provider/projectIndex/TUI/embedding/cross-OS/plugin/watch）——不 silently 拉入。
