# T4 readme-token-pin 机器腿首跑取证（真实非 shadow 断言）

时间戳: 2026-09-30 | 覆盖: D-001 / D-003 | 性质: **真实机器腿（非 shadow），R92 挂账项核销**
原始门禁输出: `t4/ship-gate-machine-leg.log`

## 1. 谓词求值（ADR-0094 D2 三条件票互斥表）

```
t_b_predicate: (verdict == "F-bug")                       -> 实际 established-via-fallback  => FALSE，T-B 不启
t3_predicate: (verdict in {established, established-via-fallback}) AND (T-B 未启)  => TRUE，T3 已启
t4_predicate: (T3 已改 README)                            => TRUE，T4 跑真实机器腿（非 shadow-run）
```

README 已被 T3 真改动 → T4 取「真跑取证」态，非 shadow 态。

## 2. 前置依赖发现（工程约束，非绕过）

首次跑门禁时 `closeout-claims` 腿**不可达**：

```
[fail] ADR-0081 D-004: CHANGELOG.md has no '## ' entry referencing r93 …
（该 fail 位于 scripts/ship-gate.mjs:776，fail() 即退，claims 腿在 780 行之后，永不执行）
```

**这不是绕过，是真实的门禁顺序依赖**：claims 腿的可达性以当轮 CHANGELOG 条目落笔为前提，
而 CHANGELOG 条目属 T6 分节④。故 **T6④ 前置于 T4 机器腿**，票序在执行期据实调整并如实记账。

## 3. 断言登记（`.scratch/grill-round-93/closeout-claims.json`）

两条 `readme-token-pin` 声明，**均无 `shadow` 字段** → 走 `else` 分支的硬比对（`declaredVer !== expectedVer` 即 fail）：

```json
{ "id": "r93-t4-machine-leg",    "kind": "readme-token-pin", "file": "README.md",
  "host": "DeepSeek Harness", "expect": "0.1.7-rc.2", "command": "dsh --version" }
{ "id": "r93-t4-machine-leg-zh", "kind": "readme-token-pin", "file": "README.zh-CN.md",
  "host": "DeepSeek Harness", "expect": "0.1.7-rc.2", "command": "dsh --version" }
```

检查器逻辑（`scripts/ship-gate.mjs:833-861`）：从 README 宿主行正则 `\|\s*[^|]+\|\s*([^|\s]+)\s*\|` 取第 2 列版本 token，
与 `command` 实测输出（`dsh --version` → `0.1.7-rc.2`）逐字比对。

## 4. 独立预验（跑门禁前本地逐条复核）

```
OK    r93-t0-watch            OK    r93-t2-l3a    field=L3a          actual="established"
OK    r93-t0-probes           OK    r93-t2-l3b    field=L3b          actual="established-via-fallback"
OK    r93-t1-adr              OK    r93-t2-l3cmin field=L3c-min      actual="established"
OK    r93-t3-readme           OK    r93-t2-verdict field=verdict      actual="established-via-fallback"
OK    r93-t3-readme-zh        OK    r93-t2-leak    field=leak_probe  actual="passed (raw key: 0 files…)"
OK    r93-t4-machine-leg      declared=0.1.7-rc.2  installed=0.1.7-rc.2
OK    r93-t4-machine-leg-zh   declared=0.1.7-rc.2  installed=0.1.7-rc.2
```

## 5. 门禁实跑结果

```
[pass] freshness leg: CHANGELOG carries a current-round (r93) entry
[pass] closeout-claims r93: 12/12 registered claims re-derived green
```

**两条机器腿均以真实断言通过**（非 shadow 的 `info` 报告）。

首跑期间修正一处 token 漂移：`r93-t1-adr` 的三个 token 写作 CONTEXT 词块术语
（`Verdict-Gated` / `权限缺口分型` / `证据效力`），而 ADR-0094 正文小节标题为
`判词门控转向票` / `权限缺口三型枚举` / `证据效力口径`。token 逐字对齐 ADR 正文后转绿 ——
这正是该检查器的设计意图：token 必须是**文中实际出现的字面量**，不能是概念同义词。

## 6. 残余 fail（T6/T7 待消解，非本票范围）

```
[fail] closeout-coverage: round 93: registered in docs/adr/index.md but
       .scratch/grill-round-93/handoffs/ has no closeout doc — write the closeout
       or remove the registration (registration means complete; ADR-0077)
```

**归因**：`docs/adr/index.md` 已登记 0094（registration means complete），但收口交接件尚未落盘。
该 fail 由 T6 收口件（closeout 交接 + 轮报）消解，不阻塞 T4 判词。
