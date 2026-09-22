# Round-76 任务书 — 「治理面静默漂移」清算轮实施

Date: 2026-09-22. 数据源：`.scratch/grill-round-76/decision-ledger.md`（D-001~D-005，唯一权威）。Stack：`r76-grill`（直下 main `381bdae7`/`a61fbe6c` workspace 态）。

## 背景一句话

ship-gate step 1g 的 closeout standing-leg 会把「最新 round 无 closeout」静默回退成旧 round 报绿（R70 F1 四轮未修）；`docs/deferred-registry.json` 被外部工具两次整文件重排无人拦。两件同构=治理机器静默漂移。

## 票序（D-004）

### T0 — registry 格式锁（覆盖 D-003）

- `scripts/ship-gate.mjs` step 1 内新增 `stepGovernedJsonCanonical()` 子函数（**不开新编号腿**——避免 1g/1h/1i+后续全部重编号）。
- 硬编码常量 `CANONICAL_JSON_FILES = ["docs/deferred-registry.json"]`，旁注 `ADR-0077` + 「n≥5 或需包级自服务时迁移注册制 config」触发条件。
- 断言=字节全等：`fs.readFileSync(f)` bytes ≡ `Buffer.from(JSON.stringify(JSON.parse(src), null, 1) + "\n")`；不匹配报 `first differs at line N`；`JSON.parse` 失败先报独立 `invalid JSON`（normalize 指引只在合法但字节不匹配时给）。
- 报错文案附可粘贴 normalize 指令：`node -e "const f='docs/deferred-registry.json';const fs=require('fs');fs.writeFileSync(f,JSON.stringify(JSON.parse(fs.readFileSync(f,'utf8')),null,1)+'\n')"` + 清单常量所在脚本位置（防清单腐化）。
- registry 顶层 `note` 字段追加锁定声明句（canonical form locked by ship-gate/ADR-0077 + normalize cmd）——一次定稿成为 canonical 一部分；写文件用 `JSON.stringify(·,null,1)+'\n'` 保持 canonical。
- **验收锚**：注入非 canonical 字节→该腿 fail 且报 first-differs+指令；恢复→转绿。

### T1 — 1g 修复（覆盖 D-002）

- 改造 `stepHandoffCloseoutLint` leg-b（`scripts/ship-gate.mjs` ~L921-936 的 roundDirs 循环+break）。
- 完成信号：解析 `docs/adr/index.md` 中 `Grill Round N` 登记条目得「已完成 round 集合」；解析器对未知行形状 fail-loud 不 skip。
- fail-closed 三断言：a) 已登记 ∧ N≥76 的 `.scratch/grill-round-N/` 无 closeout→红；b) index 登记集合↔.scratch/ 已完成 dir 双向不一致→红；c) 推导集合为空/不可解析→红。
- floor=76（规则生日）写常量+ADR-0077 注释；在飞豁免（最新 dir 未登记 ADR）打印结构化豁免行 `awaiting closeout: round N (ADR not yet registered)`——不许隐式 break。
- leg-b 字段 lint 面不动（仍只 lint 最新含 closeout dir，控 gh liveness 成本）；成功输出打印 round 覆盖计数。
- **验证纪律**：known-bad fixture 注入「已登记无 closeout」断言具体报错消息（ fixture 形态按 repo 既有测试惯例选型——turbo test 或直跑探针均可，票内定）；当前 round-76 在飞态=豁免行天然实测用例。
- **验收锚**：三断言各自实测红一次+豁免行可见+成功输出带计数+ship-gate 绿。

### T2 — 文书收口（覆盖 D-001/D-005）

- `docs/adr/0077-architecture-grill-round-76-*.md`：floor=76 锚定+键序语义（V8 插入序禁排序序列化）+「登记即完成」纪律+不自修教义+prettier 翻案条件（n≥5 多类型）+双向校验教义；登记 `docs/adr/index.md`。
- `docs/deferred-registry.json`：落选债续债条显式记（9 件原名）+两件本轮处置状态更新（shipgate-1g→核销或 close 流程按 registry schema；registry 格式锁立项事实入档）+`updated` bump——**写后必须过新锁**（canonical 形态）。
- `CONTEXT.md`：本轮新词已在 grill 整理期落盘（Silent-Drift Governance 等 6 条），实现期新增词补记。
- handoff（下轮）：#1764 merge 观察哨续挂+外发闸「待用户发」状态回录+落选债承接。
- pathlint：`.scratch/grill-round-76/` 已在 `scratchDocDirs` 覆盖内（handoffs 已登记），自证=本轮文档过 lint。
- 发布判定：repo 工具链改动非发布态代码→**不 bump 版本**，判定写 ADR-0077。
- **验收锚**：三段收口判据逐项销号+`turbo check`/`test` 绿+`ship-gate` 全绿（新两腿行使实证含在内）+`but` commit 干净。

## 红线（负向需求汇总）

- 禁 contiguity-only / 全量重 lint / git 态完成信号 / 隐式豁免 / 语义级比较 / gate 自修 / prettier / JSON5 / hook 路线 / .gitattributes 当锁 / ADR 先于 closeout 登记。
- 落选债只记续债条不动原名状态；外发文稿用户亲手发，代理不代发。
- grill 定稿后实施期才发现的账本外结论→停下问，不静默加戏。

## Suggested skills

`$implement`（续作）· `$tdd`（known-bad fixture 先行）· `$code-review`（复审可选）· `$but`（栈操作）· `$domain-modeling`（新词补记）· `$atomcode-research`（上游 #1764 再变时补研）。

## 关键文件锚

- `scripts/ship-gate.mjs` step1 ~L208 / stepHandoffCloseoutLint ~L893（leg-b ~L921-936）
- `docs/deferred-registry.json`（canonical=`JSON.stringify(·,null,1)+'\n'`，note 字段自文档）
- `docs/adr/index.md`（完成信号源+新 ADR 登记处）
- `.scratch/grill-round-76/q2-atomcode.md` / `q3-atomcode.md`（调研存档：教义+先例+来源清单）
