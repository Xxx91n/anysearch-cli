# R90 Q1 — atomcode 调研归档（下一轮主轴裁决）

> 调研时间：2026-09-29 05:15Z | batch:atomcode | 全文已入 ctx FTS 索引（source=atomcode），本档存核。

## 裁定

**推荐 A（dsh 原生注册实施轮），Confidence 高**，附三个立法性附件。

## 分点结论（四）

1. **API 稳定性的工业判定基准=消费界面的事实证据，不是版本标签**——SemVer §4/§5（0.y.z 任何可变、版本号只是承诺载体）；React 版本政策（unstable_/canary 分层语义，pinned canary 上做 framework 开发是官方用例）；Prisma versioning.md（RC respins 可含破坏是 pre-1.0 特例政策；npm 版本不可变、钉版下现有安装不受影响）。三代同形亲验=事实证据本身 → 触发器实质已响判定正确；「等 0.2.0 stable」从严读法犯范畴错误（版本采纳纪律误套到 API 消费决策）。
2. **feature work 与 dependency-upgrade 正交**——arXiv 2510.08609（版本约束轴 vs 功能开发轴分属两个决策面）；Cargo/RFC 3493（prerelease opt-in 的是版本解析非 API 使用；钉版=对 rc 内容的采纳授权，R87 装船时已做过）；Slack Shadow Jobs（shadow 面对 prerelease；本仓更强=0.1.7-rc.1 是现役钉版非未来版本）。**约束力边界：D-002 三锚判词管版本指针移动，实施票管消费已钉版本能力；两轴并行互不阻塞；唯一交叠=收口义务对实施产物同样生效（stable 晋升时再 diff 本票消费 API 子集+回归测试闭环）。**
3. **prerelease 上开发的工业先例存在，但全部以「隔离+回滚」为前提**——React pinned canary / Slack shadow 隔离 / Prisma early-access；A 的实施形态（L2 expected-RED 闸+mock-Cordis 闭环+桥退役留回滚位）恰好构成该结构。dsh 无公开政策=真实剩余风险，三代同形使 stable 改面先验概率低。
4. **L2 expected-RED 彩排闸是成熟惯例**——TDD red/green RED isolation check 同构；本仓 CONTEXT R68 Spike-Gated Ticket 词条直系执行（跳过门控按假设契约上线=静默失效温床）。

## 对 A 的辩证检验（最强反对论据）

「在 rc 面上开发=赌上游走向」——真实但被三事实压低：①三代同形横跨 minor 边界（0.1.5→0.1.7→0.2.0），stable 晋升通常最小化补丁；②实施零 repin 依赖——赌的不是上游未来而是「已发布内容不变」（npm 版本不可变），与「等 stable」承担同一赌注（stable 后还有 0.3.0）；③桥留回滚位使返工成本=revert+re-pin。**对冲条款立法：0.2.0 stable 收口探针扩展为「对 r72 实施消费的 API 子集 .d.ts 再 diff，漂移即触发返工票」——剩余风险从隐性赌注转为显式收口义务。**

三代同形充分性：不充分但必要性之上的强信号——dsh 无公开政策时 tarball 自证是唯一可得证据类。

B 检验：「等 stable」在「API 已在现役钉版收敛」情形无工业先例支撑（React pinned-canary/Cargo opt-in：钉了就消费是默认、等是例外）；B 的真实价值（否决行立法+watch）可作为 A 的同域纳编件，单独成轮浪费触发器实响窗口。

## 三个立法性附件（随 A 采纳）

1. **正例裁决入票**：实施票正文写明「消费现钉 0.1.7-rc.1 在架 API、零 repin 依赖；D-002 判词管版本轴、本票管消费轴；交叠点=stable 晋升收口探针顺带再 diff 本票消费 API 子集」。
2. **否决行立法（spec gap 补行）**：真值表第四行=「字面拉力=TRUE+稳定龄期闸未过→repin 延后但消费放行（pending-repin：已钉版本上的消费决策独立裁决）」——消 ADR-0090 未定义态。
3. **r72-web-matrix 拆分裁决**：approval-channel 分项若同 API 族且现钉在架，随票裁拆出前置；patchReload/browser-turn 维持 defer（触发器未响，与 native-tools 已响成对照）。

## 对比矩阵

| 项 | 触发器 | 工业惯例对齐 | 剩余风险 | 体量 |
|---|---|---|---|---|
| A 实施轮 | 实响（A-2 亲验，唯一） | 正交性+事实稳定判定+shadow/pinned-canary 先例全支持 | stable 改面返工（先验低）；dsh 政策不可核验 | 厚轮票可拆 |
| B 立法+哨戒 | r72 实响却被搁置 | 违「触发器响则行动」治理一致性 | 机会成本+债不消 | 薄 |
| C 评测/清债 | 无新触发 | f17 提前做空转 | 无 | 薄 |
| D 垂域重议 | 条件未达 | 违预注册纪律 | — | — |

## 来源清单

semver.org（官方）/ react.dev versioning-policy（官方）/ prisma versioning.md v8.0.0-rc.1（官方+反例）/ arXiv 2510.08609（学术实证）/ slack.engineering shadow-jobs（社区先例）/ internals.rust-lang.org prerelease 讨论+Cargo RFC 3493（官方）/ NuGet prerelease 文档（官方）/ pnpm dependency-resolution（官方）/ TDD red-gate 惯例（社区）。全文读 6 篇；Tavily 配额受限由 Exa+AnySearch 双引擎顶替。

## 信息缺口（如实记）

1. dsh 上游无公开 changelog/政策文档——rc→stable API 冻结承诺不可核验，以 npm 惯例+三代同形推断，收口探针条款=制度性对冲。
2. Tavily 配额受限少一路交叉验证。
3. 「expected-RED 作安装彩排闸」无独立专文——TDD red-gate+R68 spike-gated 立法双源支撑。
