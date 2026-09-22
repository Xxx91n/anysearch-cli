# Grill Round 78 — Decision Ledger

> 防丢账本：每条经用户确认的实质性结论当场追加。状态枚举：current/revised/stale/deferred。
> 唯一权威数据源——整理/压缩/handoff 前必须已落盘到最新。
## D-001 — R78 主题定界

- **原问题**：R78 主题定界（R77 审计交接+R77 closeout 下一轮候选+新鲜哨戒取证后出候选）：A=治理工具链校准轮——R77 审计残账两件 repo 内可收口项同轨清算（①defer-r77-pathlint-envvar-blindspot：PATH_RE 只识别盘符//Users//home//tmp//AppData/ 字面形，`%TEMP%`/`$HOME`/`~/`/`${VAR}` env-var 形全漏网，存量逃逸实例 docs/adr/0042:111 已实证；修法=正则扩形+红向 fixture+存量逃逸处置裁决；②repin 拦截实验：pnpm minimumReleaseAge 对 catalog repin 的确切拦截行为未实测——「L1=闸内唯一合法探测层」核心边界断言把闸行为当公理用，须受控实验坐实或证伪翻案） / B=defer-r72-dsh-web-interactive-matrix 产品面轮 / C=defer-r71-provider-serverside 调查 / D=只做盲区单件 / E=另指。
- **用户原回答原文**：「A」
- **规范化需求**：R78=「治理工具链校准」轮，清算 R77 审计残账两件 repo 内可收口项——(1) defer-r77-pathlint-envvar-blindspot：ship-gate.mjs:1138 PATH_RE 扩 env-var 形（`%TEMP%`/`$HOME`/`~/`/`${VAR}` 等）+红向 fixture 实测+存量逃逸实例（docs/adr/0042:111 %TEMP% 裸引用）处置须立法裁决（补 marker 还是 grandfather）；(2) repin 拦截实验：受控实测 pnpm minimumReleaseAge 对 catalog repin 的拦截行为——R77 ADR-0078 立法「L1=闸内唯一合法探测层」的边界断言建立在闸拦截任何 pnpm-driven resolution 的假设上，该假设未经实测（精确版本钉死 vs range 解析可能走不同路径=潜在证伪面）；实验证据归档后消解 upgrade-ledger v2 待校准项。两工项同属「门禁可信度校准」同构主题——一个拦不住该拦的（lint 漏网），一个不知道拦不拦（闸行为假设未证）。
- **显式约束/负向需求**：其余落选债原名续 deferred 记显式续债条非默认飘过——defer-r73-dsh-event-rename（L2 排程义务已落档，出闸≈2026-09-24 06:0xZ，今日动属抢跑闸）、#1764 观察哨（仍 OPEN 19 天无动静）、registerHooks-esm-arm（repo 无声明 Node floor+无真实 ESM 消费者=仍半响）、provider-serverside、dsh 三件套、bitmap、f16/f17、domain-ownership 均不动；外发闸仍用户动作项；gain gate 降级是 ADR-0052 法定降级路径非缺陷不入题；grill 期间不动源码；本轮不设其他目标。
- **状态**：current
## D-002 — repin 拦截实验设计（atomcode 交叉后终审）

- **原问题**：Q2 终审——repin 实验判决矩阵：A+=预先登记 6 格+1 正对照（E1 正对照闸外版/E2 scratch 闸内钉版→ERR_PNPM_NO_MATURE_MATCHING_VERSION/E3 strict:false 豁免探针/E4 真身 repin 非 frozen/E5 frozen→lockfile-out-of-sync/E6 手改 lockfile+frozen→ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION/E7 无 time 字段证伪探针）+断言文本按限定条件收窄+minimumReleaseAgeIgnoreMissingTime 置 false 加固项 / B=只跑 E1/E2/E4 核心三格 / C=原双格案 / D=采信调研跳过实测。
- **用户原回答原文**：「采纳」（采纳 A+ 含加固项）
- **规范化需求**：repin 实验=预先登记判决矩阵 6 格+1 正对照，每格预期错误码先写死、实测逐字比对——E1 正对照（scratch 钉已出闸版如 0.1.6-alpha.2→成功，证环境 sane）；E2 核心格（scratch 最小 workspace 携 minimumReleaseAge:2880+catalog 钉闸内版 0.1.7-alpha.1→预期 ERR_PNPM_NO_MATURE_MATCHING_VERSION）；E3 豁免探针（同 E2 加 minimumReleaseAgeStrict:false→预期静默装上=豁免面实证）；E4 真身 repin（仓内 catalog 改闸内版非 frozen install→预期 E2 同款龄期错误，验 lockfile 失配→重解析→闸路径）；E5 真身 --frozen-lockfile→预期 lockfile-out-of-sync（拦截成立但执法点不同须区分记录）；E6 手改 lockfile 写入闸内版+frozen→预期 ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION（验 #11583 lockfile 复核通道在 pin 版 11.24.0 真执法）；E7 证伪探针（无 time 字段源→预期装成功=断言合法证伪向量；npmjs 无标本则以「配置面向量」记档不跑）。断言文本收窄入档：「在公网 registry（带 time 字段）、无 exclude、strict 模式（默认）、trustLockfile 未开启的前提下，任何 pnpm 驱动的 registry 版本解析在龄期闸内均以 hard error 拦截；lockfile 通道由 #11583 复核独立执法」。加固项：minimumReleaseAgeIgnoreMissingTime 置 false 收紧为 fail-closed（pnpm-workspace.yaml 一行，动机=E7 向量在我们配置里默认活）。
- **显式约束/负向需求**：判决矩阵先于实验登记防事后合理化；scratch 产物全留机器临时目录不提交；真身实验后 catalog/lockfile 恢复字节零脏；不 commit 任何钉版改动；实验 transcript 归档 .scratch/grill-round-78/evidence/；任一实测与预期不符=证伪信号呈报非静默改向；时效窗口——闸内标本 0.1.7-alpha.1/0.1.5-rc.3 ≈2026-09-24 06:0xZ 出闸，E2/E4/E5/E6 须在出闸前跑完；E1 用已出闸版今天即可跑。
- **状态**：current
## D-003 — pathlint env-var 盲区修复形态（atomcode 交叉后终审）

- **原问题**：Q3 终审——pathlint 修复形态：A++=token+分隔符组合判定器（四类 token+既有字面形，后随分隔符→硬拦；裸 env-var 散文提及不报；单段 POSIX 根形 /x →info 级 surfaced-skip）+warn-first 迁移+棘轮小腿+红绿成对 fixture+inline code 不豁免 / B=原 A 案（只 env-var+tilde） / C=最小修只 %...% / D=另取舍。
- **用户原回答原文**：「采纳」（采纳 A++）
- **规范化需求**：pathlint 修复=「token+分隔符」组合判定器重构 PATH_RE（ship-gate.mjs:1138）——(1) 判定器：四类新 token（`%VAR%` Windows 形、`$VAR` 与 `${VAR}` POSIX 形、`~/` 与 `~\` tilde 形、`\\host\` UNC 形）+既有字面形（盘符//Users//home//tmp//AppData/）统一走「token 检出后必须后随路径分隔符才算 locator」判定→命中硬拦；(2) 裸 env-var 散文提及（无分隔符后缀，如「设置 %PATH%」）不报——非 locator，报则永久噪音；(3) 单段 POSIX 根形 /x（无已知前缀，如 /etc /var /mnt 之外的裸绝对根引用）→info 级 surfaced-skip（可见不阻断，ESLint warn 语义=「不能确定命中问题」层）；(4) 存量迁移：先 warn 模式全量扫已注册文档枚举命中数（know blast radius）→机械可修的 retro-fix→不可机械修的逐条补 machine-local marker（含 docs/adr/0042:111）→翻 fail-closed；不开集中 baseline 文件先例（marker=内联进 diff 的受审 artifact 已合规）；(5) 棘轮小腿：失效标记检测——marker 存在但该行已不再命中 PATH_RE→报，单向收缩语义（rubocop --report-unused-todo-entries 类比）；(6) 测试：两个实证逃逸实例（docs/adr/0042:111 形、R77 %TEMP%/r77-scratch-snap 形）固化红向 fixture+每 token 类红绿成对（绿向含散文提及/URL/已标记行）；inline code 不豁免照常拦（辩证驳回调研建议：locator 常居 code span，豁免即掏空 lint；fence 级 marker 已覆盖代码块）。
- **显式约束/负向需求**：warn-first 枚举先于翻转（不许盲翻）；失效标记棘轮只减不增语义；UNC 与 /x surfaced 层若实施中误报面失控→退化「记档不跑」并呈报非静默放宽；不因误报面而放宽硬拦规则（误报用分层消化不用规则消化）；调研无逐字同构先例=本仓原创小设计须实测校准误报率；红向 fixture 必须命中才证明 fail-closed 真实。
- **状态**：current
## D-004 — R78 票序结构（atomcode 交叉后终审）

- **原问题**：Q4 终审——票序：A+=T0 repin 实验（严格 timebox 闸窗内纯取证）→T1 治理加固批一票三 commit（refactor 判定器/fix 存量清理/chore IgnoreMissingTime:false 配置行）→T2 文书收口 docs-only / B=T1 先行 / C=加固行挂 T2 / D=四票拆。
- **用户原回答原文**：「采纳」（采纳 A+）
- **规范化需求**：三票串行——T0 repin 实验（D-002，时敏最前）：E1~E6 判决矩阵照预先登记跑+E7 记档态；硬截止=闸内标本 ≈2026-09-24 06:0xZ 出闸；严格 timebox 防 spike 膨胀；纯取证不提交任何钉版/lockfile 改动（真身实验后恢复字节）。T1 治理加固批（D-003）一票三 commit：refactor=PATH_RE→token+分隔符组合判定器+棘轮腿+fixture；fix=存量违例清理（retro-fix/marker 逐条）；chore=minimumReleaseAgeIgnoreMissingTime:false 一行（config IS the feature 场景下同票异 commit——atomic commit 惯例：config 与 refactor 分属不同 review 关注，独立可 revert）；warn-first 枚举→清理→翻 fail-closed 在此票内完成；turbo check/test+该腿直跑+ship-gate 绿+pnpm install 绿（验证加固行无破坏）。T2 文书收口 docs-only：ADR-0079+registry（defer-r77-pathlint-envvar-blindspot 核销关闭+落选债 carried_log r78，canonical normalize）+upgrade-ledger v2 待校准项消解+断言收窄文本落锚+CONTEXT 新词+handoff+pathlint 登记 round-78+but 干净；不 bump 判定入 ADR。
- **显式约束/负向需求**：排序理由=WSJF 三项分量全高+Kanban Fixed-date 悬崖型 CoD+依赖驱动（T2 内容依赖 T0/T1 结果锁死最后）+spike 先行惯例；T0 时敏窗口不可后挪；functional change 绝不混入 docs commit；T1 与 T0 无相互依赖但 T0 结论更稳时 T1 才开工（若实验证伪，T1/T2 内容全变）。
- **状态**：current
## D-005 — R78 收口判据

- **原问题**：Q5——收口判据：A=三段收口+证伪合法（实验段逐格比对+证伪处置路径预先合法化+窗口诚实性；pathlint 段 warn-first 枚举+棘轮红向+红绿 fixture 成对+install 绿；文书段 ADR-0079+registry 核销+待校准项消解） / B=两腿代码绿即收口 / C=账本约定。
- **用户原回答原文**：「A」
- **规范化需求**：三段收口——(i) 实验段：E1~E6 逐格与预登记预期比对（一致/不一致逐格显式）；E7 无 npmjs 标本则「配置面向量」记档；transcript 归档 .scratch/grill-round-78/evidence/；真身实验后 catalog/lockfile 恢复零脏实证；证伪处置预先合法化——任一格实测≠预期=断言被证伪呈报信号，处置=如实归档+断言文本按实测收窄/翻案入档（收口产物是真相非确认书）；滑过 09-24 窗口则记「窗口错过」诚实结论不伪造。(ii) pathlint 段：判定器重构落地+warn-first 全量扫命中数实录（blast radius 可审计）+retro-fix/marker 逐条处置+翻 fail-closed+棘轮腿红向实测（注入失效标记断言被检出）+每 token 类红绿 fixture 成对行使（红必拦绿必放）+inline code 不豁免断言+turbo check/test+ship-gate 绿+pnpm install 绿（IgnoreMissingTime:false 无破坏实证）。(iii) 文书段：ADR-0079（组合判定器+豁免三层模型+棘轮审计+判决矩阵实录+断言收窄文本+加固理由+不 bump 判定）+registry（defer-r77-pathlint-envvar-blindspot→closed 走 canonical normalize+落选债 carried_log r78）+upgrade-ledger v2 待校准项消解+CONTEXT 新词+handoff（#1764 哨/外发闸/L2 出闸临近态）+pathlint 登记 round-78+but 干净。
- **显式约束/负向需求**：三段缺一段不收口；红方向必须实测行使；判决矩阵不一致格如实记录不掩盖；证伪结果同样是合法收口产物；不 bump 判定须显式入 ADR 非默认跳过；窗口错过须诚实记档不可补跑伪造。
- **状态**：current
