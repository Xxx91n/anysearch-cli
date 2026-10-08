
## Grill Round 100 — Terms (ADR-0101)

### Meta-Cap Filter（封顶滤尺）
ADR-0101 D2——新增元验证层立项的三对应物交集滤尺：kill-oracle（`fails` 必填指名用户可见产品故障类）∧ ratchet sunset（退役判据）∧ Meyer 相对性（fraud-vs-style，style 语义上限 info 档）。_Avoid_: 元层无指名故障即立项；style 语义检查器占 RED 判定位。来源：R100 D-003。

### Kill Oracle (fails)（杀敌判定书 fails 字段）
anchors.json 必填 `fails` 字段——锚所防的用户可见产品故障类，指向封闭具名故障类词表；存在性+指向性机检、真实性人审。_Avoid_: 人读描述当机器判定位；自由文本故障类。来源：R100 D-003。

### Audit Tier (info 档)（审计档 tier）
锚条目 `tier: "red" | "info"`——默认 red 零迁移；info 锚仍跑探针（观察不缺席=Coverity Audit 收容档）；档迁移须立法痕迹。_Avoid_: 静默调档；info 锚停探（缺席≠观察）。来源：R100 D-003。

### Sunset Ledger（锚活性一行账）
每轮 closeout claims 段的锚活性一行账——各锚生产 finding 计数/距上次真 RED 轮数；只计生产 finding，fixture kill 不算活性；半机检（行存在性+数值一致机验、归因留人审）。_Avoid_: fixture kill 计入活性；全自动日落（N 无机判准）。来源：R100 D-003。

### Stack-Orphaned-by-Land（栈 land 遗孤）
closeout 在 main 上含活链 Stack 行且其命名 branch 的 origin ref 缺席 → RED——land 重写 SHA/注销 but-ID 后残留的「写时为真」声明。_Avoid_: 以「读取方豁免校验」方向修（dissolved-on-land）；为省事预写 dissolved。来源：R100 D-002。

### Seat Deadline（坐席限期）
坐席条目到期未关票/未具名续期 → RED（裁决日禁永悬，unicorn expiring-todo 先例）；到期计算错宁 fail-loud 不静默有效。_Avoid_: 到期报 info；无结构化的散文限期。来源：R100 D-004。

### Masking-Surfaced（掩盖浮面）
runner 对 open seat 下探针报 no-kill 出具名 masking info 行——哪个坐席掩盖哪个锚，每跑可见。_Avoid_: 泛泛一行 info；坐席掩盖保持隐形。来源：R100 D-004。
