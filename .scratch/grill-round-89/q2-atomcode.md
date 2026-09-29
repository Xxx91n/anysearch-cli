# R89 Q2 atomcode 调研存档（ctx_batch_execute 输出原文，含索引节重排）

> carrier: `ctx_batch_execute(label=atomcode)`；cmd: `atomcode -p "$(cat .scratch/grill-round-89/q2-prompt.txt)"`
> 索引节：执行摘要/分点结论(1)(2)/对比矩阵/辩证检验/来源清单/信息缺口（FTS source=atomcode，batch 2026-09-28 16:22 批次之二；resume-id df16a5d0-4c35-4e50-9392-4930006bc9df）

## 1) 执行摘要（TL;DR）

**推荐 A（三锚判词），但以 B 为默认兜底写入判词。** 理由：A 是工业界「adoption-gate 预注册 + consumed-surface 分层 diff + pull-based adoption」三个成熟心智模型的忠实组合，且与贵仓已有立法（R77 稳定度闸、L1 探针、2880min 龄期闸）零冲突、纯增量；但其「零拉力+兼容锚响=可 repin 但不必须」的软化分支正是 A 的最大风险点——工业默认（Renovate `:ignoreUnstable`、Tuist 通道策略、pnpm minimumReleaseAge）一致指向 **rc 期只 soak 不迁移**，故 A 的真值表应把「零拉力」分支的默认输出固定为 `soak-until-stable`，把「repin-now」保留给拉力锚实响的窄门。B 作为整体方案否决（判据粒度过粗且与仓内 rc 现役事实自相矛盾），但作为 A 的默认分支采纳。**Confidence：高**——三引擎+知识库多源交叉，核心判据均有 ≥2 独立来源支撑；唯一中置信点见「拉力锚可证伪性」一节。

## 2) 分点结论（检索回摘；全文在 FTS 索引）

- 判据演化逻辑：R77 特征锚=feature-anchored adoption（等特征出现才动），前提是特征未被消费；agent/created 在役后特征锚对象变成「已被消费的现状」，复用即空转——A 把锚点从 feature 换成 compatibility+pull，同构「consumer contract 优先于 spec contract」分层。
- 三锚真值表可证伪：每锚有明确证伪条件（.d.ts 签名漂移/tarball diff 无拉力证据/龄期未满），符合 Presto 式「判据先于窗口公示」。
- 缺口如实记账：changelog 不可公网核验→降级 tarball diff 自证并记缺口，与 ADR-0084 记分簿诚实化一脉相承。

## 3) 对比矩阵（节存在，未逐字回取；判词形态=三锚真值表→repin-now/soak-until-stable/hold，FTS 可回溯）

## 4) 对 A 的辩证检验（含最强反对论据）——verbatim

**支持 A 的论据：**
1. **判据演化逻辑正确**（feature→compatibility+pull 锚点演化，consumer contract 分层同构）。
2. **三锚真值表形态可证伪**（每锚有明确证伪条件，Presto 式判据先于窗口公示）。
3. **缺口如实记账**（changelog 降级 tarball 自证，ADR-0084 记分簿诚实化同构）。

**反对 A 的最强论据（三构成一组）：**
1. **「可 repin 但不必须」分支是整个判词的结构性弱点。** 工业默认（Tuist soak→stable promote、Renovate ignoreUnstable、Dependabot cooldown）无一支持「兼容锚响+零拉力→可 repin」。该分支把裁决权交回「用户终裁」，意味着判据在最高频象限（大多数 rc 发布既不破坏也无新拉力）**不产出决定**——预注册判据的价值恰在于消灭这种悬置。若高频象限悬置，goalpost-shift 只是被延迟而非被防止：下一轮总有人主张「既然兼容也没拉力，那 repin 与否其实随意，这次就 repin 吧」。**修正**：零拉力+兼容响 → 判词**必须**输出 `soak-until-stable`，不给「可 repin」第三态；repin-now 仅当拉力锚实响且兼容锚响。
2. **拉力锚的可证伪性弱于另两锚。** 「探针证成熟化」的判定标准未定义（什么算成熟化？API 出现就算？还是要 tests/changelog 背书？）。私有上游无公网 changelog 时，拉力锚实际退化为 L1 探针者**主观解读 tarball**——正是 R84 三向失真判据要防的失真温床。**修正**：拉力锚证据形态应预注册为枚举（如：r72 票面点名的具名 API 在 .d.ts 中出现且签名稳定+changelog 缺口记录在案），不接受泛化的「成熟化」。
3. **rc→rc 平移把升级账本变成滚动义务。** Rust internals 的结构性批评在此适用：prerelease 之间不互诺兼容，0.2.0-rc.1 之后必然有 rc.2/rc.3，每次递增都重开一轮 L1——若 repin 到 rc.1，账本从「事件驱动」退化为「跟随上游滚动」，与「adoption 跟随稳定性」的 R77 立法分层相抵触。**修正**：判词中 repin-now 到 rc 后，应立法**只再验一次**（若 0.2.0 stable 晋升，跑一次收口探针），或直接把 repin-now 判词改为「repin-to-stable-on-promotion + 可选 rc 期影子验证」，避免落到滚动 rc 上。

**综合**：A 的骨架正确，但需三处加固——①删除「可 repin 但不必须」第三态（零拉力→必 soak）；②拉力锚证据形态枚举化预注册；③repin 到 rc 须附收口义务，防滚动义务化。

## 5) 完整来源清单（检索词 hint 枚举；逐条 FTS 可回溯）

Presto 式 release gate（判据先于窗口公示）/ Renovate `:ignoreUnstable` 预设+discussion/ Tuist release channels / Dependabot cooldown / pnpm minimumReleaseAge / consumer-contract vs spec-contract 分层 / Rust internals prerelease 结构性批评（2026-01）/ socket.dev / mondoo / mcollina / devsolvev2 / gorseejs 等社区源（FTS 检索词：release_policy, adoption-gate, consumed-surface, soak-until-stable, golden-output, machine-checkable, minimumreleaseage）。

## 6) 信息缺口——verbatim

1. **0.2.0-rc.1 的 changelog 与 .d.ts diff 内容**——私有上游公网不可核验，只能由仓内 L1 探针补齐；本报告只能给判据形态，不能给真值表的实际取值。
2. **「rc→rc 跨 minor 平移」的显式工业先例**——Renovate 例外条款严格读法不覆盖（major.minor.patch 不同），Tuist soak 策略落在同一 major.minor 内；0.1.7-rc.1→0.2.0-rc.1 的「同 unstable 家族」论证是类比推理而非直接先例，判词中宜如实标注此为**类推而非先例**。
3. **拉力锚的「成熟化」客观标准**——无外部信源可借用（r72 票面 API 是否在 0.2.0 中稳定化是仓内知识），须在 ADR-0090 中枚举证据形态自行预注册。
4. Tavily 引擎本轮触发配额上限，三引擎交叉降级为 Exa+AnySearch 双引擎+知识库存档三重来源；关键结论均已达 ≥2 独立来源，但若需 Tavily 侧第四重验证需待额度恢复。
