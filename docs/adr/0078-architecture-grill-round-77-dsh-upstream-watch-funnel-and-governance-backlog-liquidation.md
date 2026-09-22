# ADR-0078: Grill Round 77 — dsh 上游观测哨分层漏斗（L0/L1/L2+双锚触发器+墓碑制）与 R76 治理 backlog 七项清算

## Status

Accepted (implementation round r77). Records the round-77 decisions per the
serial ticket plan T0–T2. Ledger:
`.scratch/grill-round-77/decision-ledger.md` (D-001~D-005, 无断号).
Evidence root: `.scratch/grill-round-77/evidence/`.

## Context

两件异构但同源的治理欠账：

1. **轨一**：`defer-r73-dsh-event-rename` 的 watch 义务挂在「每次上游发版先
   跑安装预演（L2）」上——L2 每次都过重（repin→install→tsc），且 R73 触发器
   写成版本锚（`0.1.6-rc.1`）：0.1.6 直接跳 alpha 线演进、rc 号被 0.1.7
   接力（leapfrog），版本锚触发器被证伪——若 0.1.6-rc.1 永不发布=死锁，
   若 0.1.7 先出 rc=漏接。
2. **轨二**：R76 审计交接列出七项 backlog 残余（titleRound 未锚行首、
   ROUND_DIR_RE 无 $ 别名、coverage 红序未实测坐实、CANONICAL_JSON_FILES
   空清单可真空报绿、F-5⑥ 互注缺 renderer 侧、F-5⑦ gov-r76 条目缺
   deadline/review_cadence、F-6 BOM 报错只记档不教修）——每项都是
   「治理机器自身 silent-drift」的同类失效模。

## Decision

### D1 L0/L1/L2 哨戒漏斗（ledger D-002）

上游 watch 三层职责分离，alarm 跟随发布、adoption 跟随稳定性：

- **L0 元数据哨**：`npm view <pkg> versions/time/dist-tags` 全族快照——喂
  龄期闸日历（出闸时刻可排程），产 `evidence/t0-l0-watch.json`。
- **L1 静态探针**：`npm pack` 拉候选 tarball 到机器临时目录（不 install、
  不过 pnpm resolver → **不受 minimumReleaseAge 管辖，是闸内唯一合法探测
  闸门外版本的层**）→ 解包 .d.ts 提取 `interface Events` 声明合并块，与
  pin 版消费面快照（`t0-api-snapshot-rc2.json`：keyof Events 键集 + 实际
  消费的 payload 字段）逐键 diff。diff 即破坏面证据预览，并先验预测 L2 的
  expected-RED。
- **L2 安装彩排**：repin→install→tsc——权威终裁但重，**只给采纳候选**
  （双锚全响 + 过龄期闸）。

「每版跑 L2」当 cadence 是错的；正确收缩=降层（每版 L0+L1，L2 等候选）。

### D2 特征+稳定性双锚触发器（ledger D-002）

采纳/重入触发器锚定「特征在发布物中存在」而非版本号：

- **特征锚**：候选 tarball .d.ts 中 `agent/created` payload 携 `source`
  （/`signal`）且 `agent/session-start` 键缺席——R77 T0 实测确权（alpha
  线 0.1.6-alpha.1 起落地）。
- **稳定锚**：发布位于 rc-or-stable 线（alpha/beta 只 alarm 不采纳）且
  changelog 经审阅。
- 版本号只作 transcript 记录字段永不进触发逻辑。非版本触发保留：功能
  桥接缺口、上游宣布现役版本废弃窗口。

### D3 Respect-and-Schedule + latest-only + 墓碑（ledger D-002/D-005）

- 龄期闸交互唯一合法模式：闸内 L0/L1 照跑照归档，动作延迟到出闸自动
  触发（Renovate pending→passing 状态机同构）；不 scratch-dir 绕闸、不
  per-dependency 豁免。
- **latest-only**：被龄期闸窗口+发布节奏跳过的版本不欠逐个 L2——最新合格
  候选彩排 GREEN 时，跳线版本的兼容性被传递证明。
- **墓碑条目**：跳线版本欠一条记录（version+superseded_by+L1 diff 摘要）——
  归registry `tombstones` 字段 + upgrade-ledger 墓碑表双载；Y 彩排 RED 时
  X 的 L1 快照即归因证据。
- **合格候选缺省也是合法终态**：本轮判定 = 无 L2 合格候选（rc.3 无 alarm；
  三 alpha 皆稳定锚不响）→ no-qualifying-candidate 显式结论收口，非吊死
  等闸。

### D4 ADR-0074 cadence 降层修订（ledger D-002）

R73 账本「每次上游发版先跑预演」修订为：每版 L0+L1（轻、可串行归档），
L2 仅合格候选。本轮实证：alpha 线三连发（0.1.6-alpha.1/alpha.2/
0.1.7-alpha.1）若照旧 cadence = 三次 install 彩排税；降层后三次 L1 探针
各几分钟即归档，且结论与 R73 install-RED 互证一致。

### D5 轨二七项清算（ledger D-003）

逐项红方向实测行使（fixture/探针断言具体报错，非仅代码存在）：

1. `titleRound` 锚定 title 行首 `^\s*Grill\s*Round\s*(\d+)\s*[—–-]`——
   句中「Grill Round N —」提及不再误登记（红 fixture：`Follow-ups to
   Grill Round 70 — cleanup`）。
2. `ROUND_DIR_RE` 改全名匹配 `/^grill-round-(\d+)$/i`——`grill-round-7x`
   n=null 走显式 drift 判定，不再别名 round 7。
3. coverage 红 defer-exit 序坐实：真门探针（fixture commit：round-98 空
   目录+round-99 伪 closeout）实测混合红态下 `[fail] closeout-coverage`
   与 `[fail] handoff-lint` 双诊断全出（exit 1），互不压制。
4. `CANONICAL_JSON_FILES` 空清单 fail-closed：`governedListViolation`
   导出+ship-gate 接线；真门探针（临时置空 commit）实测 `[fail]
   canonical-json: ... is empty`（exit 1）。
5. F-5⑥ 互注补全：`gen-adr-index.mjs` renderBlock 注释命名消费方
   parser（row 形态 `| [NNNN](file) | title |`、表头字面量、BEGIN/END
   标记的双向契约）；parser 侧同步点名 renderer。结构解耦保持不变。
6. F-5⑦ `gov-r76-registry-canonical-lock` 条目补 `deadline`+
   `review_cadence`（对齐已核销兄弟条目 schema）；编辑走 canonical
   normalize 流程，字节锁自证 PASS（自食其锁第二轮实证）。
7. F-6 BOM 专门报错：`governedJsonViolation` 先检 EF BB BF → 报错指名
   字节签名 + 可粘贴 strip 命令（`subarray(3)`），不发 normalize 指针
   （normalize 读 utf8 后 JSON.parse 仍炸 BOM——教修方向必须是 strip）。

### D6 发布判定：不 bump（ledger 惯例）

本轮全部落在治理机器面（scripts/*、test/*、docs/*、.scratch/*）——无发布
态代码增量、无依赖面变更、无 lockfile 触碰 → 不 bump 版本，显式记录此
判定而非默认跳过。

## Consequences

- watch 义务降层后可持续：每版 L0+L1 几分钟可归档，L2 只对真正采纳候选；
  触发器不再能被上游跳版本号证伪。
- 已知待校准（落锚于 upgrade-ledger v2「待校准项」）：pnpm
  minimumReleaseAge 对 catalog repin 的确切拦截行为未实测——L1 tarball
  探针的闸内合法性依赖该拦截生效，属本地实验项非盲区沉默。
- 七项 backlog 全清且每项有红方向实证；治理机器的 silent-drift 面再缩：
  行首锚定杀误登记、全名匹配杀别名归并、空清单判红杀 vacuous green、
  BOM 报错杀误导性 normalize 指针。
- 0.1.7 家族扩至 21 dsh-* 已入档——采纳轮 overrides 枚举必须按新锁文件
  重推导（现行 15 名清单缺口 6 名）。

## Closure evidence (ledger D-005 三段)

- **(i) 探针段**：`evidence/t0-l0-watch.json`（23 名全族）+
  `t0-api-snapshot-rc2.json`（pin 版消费面）+ 三份 L1 transcript
  （rc.3 无 alarm/alpha.2 锚复核 ALARM/0.1.7-alpha.1 ALARM+家族 21）+
  alpha.1 点探（改名最早落地版）；三问全答（改名未上稳定线/alpha 线内
  payload 零再变/0.1.7 家族扩至 21）；git status 零脏（无 lockfile/
  workspace/源码改动）。
- **(ii) 轨二段**：七项全行使——模块红→绿（closeout-coverage 40→46、
  governed-json 19→25）+ 真门探针两条（item3 混合红双诊断、item4 空
  清单判红）；`pnpm run check` 8/8、`pnpm run test` 13/13、
  `node scripts/ship-gate.mjs --skip-matrix` 65 pass/0 fail 全绿。
- **(iii) 文书段**：registry defer-r73 触发器双锚改写+墓碑字段+落选债
  10 条显式续债+审计返工新立项 `defer-r77-pathlint-envvar-blindspot`（canonical normalize+字节锁验证）+ 本 ADR + index
  regen（78 条）+ upgrade-ledger v2 + handoff（#1764 哨+外发闸+
  no-qualifying-candidate 结论）+ pathlint 自证（round-77 文档全在
  已登记 doc dirs）+ but commit 干净。

## Research sources

`.scratch/grill-round-77/q2-atomcode.md`——分层漏斗（L0/L1/L2）、双锚
触发器、respect-and-schedule、latest-only+墓碑、带期排程义务等教义+
先例来源（Renovate pending→passing、Dependabot cooldown、API
Extractor/Azure apiguard 消费面快照先例）；票内不另开新调研（atomcode
串行配额纪律）。
