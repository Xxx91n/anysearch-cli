# Changelog

这里记这个项目每次改了什么，新的在上。格式按
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本号按
[SemVer](https://semver.org/)。

## Unreleased — #257: 空库同时启动可靠完成（冷启动有限重试 + schema 一次成型）

### Fixed

- **两个进程同时开一个全新的库时，不会再随机死一个**。以前哪个进程先改库，另一个就可能直接拿到 `SQLITE_BUSY: database is locked` 然后启动失败，宿主那边看到的就是 MCP 服务时不时少一个。现在初始化阶段遇到忙/锁会有限重试，撑不过去就明确报错，不会假装启动成功。策略写死在 `packages/store/src/sqlite-init.ts`，不走环境变量，发出去的版本不会因为谁设了个变量就变成另一套启动契约：每个步骤最多 5 次（首次 + 4 次重试），间隔 100/200/400/800 毫秒，初始化期间 SQLite 自己的等待降到 500 毫秒（原来是 5000）。窗口是**每个 store 各一份** 6 秒（过了这个点不再开新重试，正在跑的那次自己跑完）；`createEngine()` 先开会话库再开观测库，所以两边同时被占用时最多约两轮窗口，不是总共 6 秒。只重试 `SQLITE_BUSY` / `SQLITE_LOCKED` 及其子码——带别的错误码的不重试，只有拿不到错误码、只能看文字的才按 `database is locked` 兜底；`CANTOPEN`、约束冲突、只读库、IO 错误都原样立刻抛。重试次数或窗口耗尽时抛的是包装过的错误，但真实的 busy 错误连同 `code` 一起挂在 `cause` 上，不会被吞。
- **整段 schema 改成在一个 IMMEDIATE 事务里一次落地**。这是复现过程中发现的第二个故障：两个进程同时建 FTS5 虚拟表时，会撞上 `SQLITE_SCHEMA: vtable constructor failed: …_fts`。它不是忙错误，按规定不该重试，所以修在根上——要么整套表建好，要么一个都不建，另一个连接在事务上排队等，而不是两边边建边抢。初始化完把连接的 `busy_timeout` 恢复到 5000，普通读写不受影响。
- **列迁移不再无差别吞错**（行为变更，老库会受影响）。原来 17 条 `ALTER TABLE ADD COLUMN` 都是 `try { … } catch {}`，任何错误都不吭声地跳过。现在只吞「`duplicate column name`」（那正是新库已经建好这一列的重复执行情形），其他错误照常往上抛。这样出错时启动会失败，而不是带着一个半迁移的库声称启动成功。这是本票「不会输出 database is locked 后继续宣称启动成功」的直接延伸。
- **三处故意 fail-open 的 catch 现在分辨失败类型**：预算去重、预算唯一索引、链锚点 bootstrap 遇到数据问题时照旧降级成 warning 继续启动（原有 D6 行为不变），但忙重试耗尽会抛出去让启动失败，不再出现「打了 database is locked 还继续启动」。

### Tests

- `packages/store/test/sqlite-init.test.ts`：重试策略本身的单元测试——哪些错误可重试（含「带非忙错误码的不重试，哪怕文字里有 locked」）、退避正是 100/200/400/800、次数上限、墙钟上限、耗尽后 `cause` 和 `code` 都还在、非忙错误一次就抛且保持原始对象、`duplicate column name` 不算忙错误。还覆盖 `beginInit`/`endInit` 真的在 500 ↔ 5000 之间切换，以及 `execDdlAtomically` 三种情形：正常脚本全建成、第三条语句坏掉时整段回滚且一张表都不留、幂等脚本重复执行不重复建。
- `packages/store/test/coldstart-race.test.ts`：两个真实进程抢一个全新库，5 轮，每轮两个都初始化成功；每轮查 `integrity_check`、`journal_mode=wal`、21 张表、两个 FTS5 索引、5 个触发器、9 条 edge pattern 种子、单条链锚点、观测库 `user_version=2`，确认没有半初始化残留。另有三个确定性用例：锁 1.5 秒能被重试撑过去；锁 30 秒会如实失败并保留 `SQLITE_BUSY`；路径不可打开时立刻报 `SQLITE_CANTOPEN`、不烧重试退避。
- `apps/mcp/test/coldstart-race.test.ts`：宿主能看到的那一层。两个真实 `ans-mcp` 进程、5 轮、每轮都走完 `initialize` 和 `tools/list` 并拿到 5 个工具，不是“进程还活着”就算过；每轮再查一遍库的结构完整性。
- 修复前的观察如实记着，而且两次量出来的结果不一样：一套是两进程同时走 `new Database` + `journal_mode=WAL` + `exec(schema.sql)`，20 轮撞到 1 次 `SQLITE_BUSY`（位置在 `Database.pragma`）；另一套是走真实的 `SqliteSessionStore` + `SqliteObservationStore`，30 轮一次没撞到，接着跑到 60 轮才撞到 1 次 `SQLITE_SCHEMA: vtable constructor failed: retrieval_results_fts`。修复后用同一套真实 store 路径加跑到 40 轮（80 个进程），0 失败。
- 这些数字都是采样，不是必现证明，也不是因果证明：修复前 30 轮可以一次都不撞，所以无法宣称「修复后跑 40 轮通过」就等于「原故障已被修掉」。真正不依赖运气的是上面那三个锁用例——锁在窗口内一定被重试撑过去，锁超过窗口一定如实失败。
- 「关掉重试也会启动成功」这一情形**确实观测到了，而且如实记在这里**：修复前的代码本来就没有任何重试（`git show origin/main:packages/store/src/session-store.ts` 里没有任何重试函数），所以上面那两次修复前测量就是「有重试之前」的对照组。其中 30 轮两进程冷启动一次故障都没复现，这一轮不能说「重试救回了故障」；只有后来 60 轮撞到那 1 次 `SQLITE_SCHEMA` 才算看到故障本身。所以本轮的因果证据只到「有锁时会重试撑过去 / 锁太久会如实失败」为止，不到「原有竞态已经被消除」。
- 本票**没有**临时加一个关重试的开关再跑一遍：策略是硬编码常量，加开关只会多一条没人长期验证的路径，而 `#255` 已经明确记录「测试用屏障、原型回退开关等不自动成为正式产品接口」。

### Verification

- 本地跑过并通过：`packages/store` 的 `check` + `test`（73/73）、`apps/mcp` 的 `check` + `test`（16/16）、`packages/kernel` 的 `check` + `test`（170/170）、`packages/retriever` 与 `packages/embedding` 的 `check` + `test`，以及 `pnpm -C packages/store eval --offline`（126/126，verdict=warn，与改动前同一指纹）。
- **没在本地跑、留给远端 CI 的**：`apps/cli`、`apps/plugin`、`apps/dsh-plugin` 的 `test`（它们要 `dist/`，本票按约定本地不编译），`pnpm -r build`，`node scripts/ship-gate.mjs`。所以「标准门禁全过」这句话现在还说不出口，要等 CI 结果。
- 这台机器的实测数值也写进了 `sqlite-init.ts` 的注释：单个 `journal_mode=WAL` 尝试在库被别的连接独占时约 1.2–1.4 秒就失败（`busy_timeout` 不管用），锁 15 秒时一个 store 的初始化约 6.8 秒、5 次尝试后放弃。所以每个 store 的真实上界约 7.5 秒，不是“5×500ms + 1500ms 退避”算出来的 4 秒；两个 store 都卡住时约两倍。

## Unreleased — #20: dsh 审批通道真机验收（沙盒，四种结果都跑通）

### Added

- **`scripts/dsh-approval-acceptance.mjs`**：一条命令把 dsh 审批通道从头跑到尾。脚本先从源码构建并打包 `apps/dsh-plugin`（`lib/` 不进仓库，全新检出也能跑），按 `web` 和 `headless` 两个模板各建一个独立 profile，装插件，配好模型路由，再起本地的 anysearch 策略服务和 `ans-mcp`，最后用浏览器真点一轮对话。跑完读会话日志里的 `approval/asked`、`approval/decided` 和工具结果，逐项核对：允许一次就真的执行工具；拒绝时模型拿到的是拒绝错误，不是检索结果；停止生成记成撤回；headless 没有审批通道时按“拿不准就拒绝”收尾。需要 Node 22.15 以上，因为会话日志是 zstd 压缩的。
- **沙盒只碰自己的临时目录**：`DSH_HOME`、默认工作区（`documentsDirectory` 指到临时目录）、两个本地服务和它们的库、模型补丁全在一个临时目录里；退出时先杀子进程，删目录失败会重试，实在删不掉就报错并把退出码改成 1，`--keep` 才留现场。Ctrl-C 也会走同一套清理。真实主目录不写。
- **不钉 dsh 版本**：脚本用 `PATH` 上的 `dsh`，也可以用 `DSH_BIN` 换一个，报告里只打印实际版本。profile 的补丁按当前 0.2.2 的行 id 写的，换大版本要先核对一遍。

### Verification

- 在本机沙盒里用 `@deepseek-ai/dsh@0.2.2-rc.1`（仓库当前钉的版本）跑：退出码 0，8 项检查全 PASS。八项是宿主在位、策略服务、`ans-mcp` 服务、网页起来，加上允许一次（`allowed-once`，工具返回 9912 字符真实检索结果）、拒绝（`rejected`，模型看到 `the user rejected tool "ans_search_web"`）、停止生成（`cancelled`，模型看到 `tool call aborted before dispatch`）、headless（`unavailable`，模型看到 `requires approval, but no approval channel is available`）。打包只是准备步骤，不算一项检查。
- 前三种在网页里点出来；第四种只能走 headless，因为 headless profile 本来就没装审批应答器，这正是它要证明的“默认拒绝”。
- 模型走的是本机现有的 OpenAI 兼容网关，不是 DeepSeek 官方 Key；检索走真实的 `ans-mcp` 和真实网络。这一轮验的是审批交接和拒绝路径，不是检索质量。
- 跑完复查过：临时目录已删，真实 `文档/deepseek-harness/default-workspace` 没被动过（修改时间仍是本轮之前），脚本起的端口都已释放。

## Unreleased — #252: dsh 0.1.7 → 0.2.2 升级

### Changed

- **dsh 依赖族从 `0.1.7-rc.1` 升到 `0.2.2-rc.1`**：`pnpm-workspace.yaml` 的 catalog 里 19 个 `@deepseek-ai/dsh-*` 一起升版；`@deepseek-ai/cordis` 从 `4.0.4` 升到 `4.1.0`。`@deepseek-ai/dsh-invariants` 在 0.2.2 已经没有这个包，catalog 和 overrides 里的同名条目一起删掉；装好的 0.2.2 依赖里也没有谁再引用它。lockfile 重新生成后，`pnpm install --ignore-scripts` 退出 0。
- **插件源码只改了一句版本注释**：对照 0.2.2 的 `.d.ts`，我们用到的工具注册、hook 事件、消息来源这几个类型没变，所以没有改行为，也没有加 `any`、`ts-ignore` 或 `@ts-expect-error`。
- **文档跟版本对齐**：中英文 README 的宿主表改成 `0.2.2-rc.1`，写清网页对话和热重载都验过；`docs/deepseek-harness-integration.md` 的已验证版本、热重载机制和限制说明一起改。旧的 `patchReload` 说法删掉，改成 `dsh-hmr`；`agent/session-start` 改成代码里真实用的 `agent/created` 加 `source === 'startup'` 守卫；仓库里已经没有的 `.scratch` 证据路径换成 #252 的验收评论。

### Verification

- 沙盒真机验收（dsh `0.2.2-rc.1` + cordis `4.1.0`，网页 profile）：这次运行退出码 0，16 项检查全 PASS。验过 `--dump-config` 里有插件和 `dsh-hmr` 两行、第一轮系统提示里路由卡片正好 1 份、工具调用后的请求带预热标记、每次工具调用只发 1 次 `/recall`、运行中改 `llm-deepseek` 的 baseURL 后下一轮请求真的打到新端口、热重载后路由卡片仍然只有 1 份、停宿主后网页端口关掉了。
- 沙盒里的 anysearch 服务、MCP 端点和模型都是本地临时搭的模拟服务；这一轮验的是 dsh 宿主这一侧的行为，不是真实检索或真实模型。

## Unreleased — #213: MCP clientInfo——新版 `_meta` 解析 + trace 断言

### Changed

- **MCP `client_id` 改成每个请求各自算归属**：五个工具的处理函数从 SDK 请求上下文里读 `2026-07-28` 请求带的 `_meta["io.modelcontextprotocol/clientInfo"]`，经 `mapMcpClientId` 映射后写进观测记录（trace）。旧的 `2025-11-25` 无状态 HTTP 调用没有按请求的身份，记成 `mcp_unknown`；HTTP 入口的 `initialize` 里提取的那份留作 fallback，但不再承诺跨请求都归到同一个人。

### Tests

- `apps/mcp/test/client-attribution.test.ts`：五个工具在新 `_meta` 下的 `client_id` 映射、旧版匿名、initialize fallback、按请求优先以及 payload 畸形时降级；内存传输和生产环境的无状态 HTTP 两条路径都覆盖。

## Unreleased — #24: 建 ip 第五域的评测语料（`vert-i*` 语料 + 当时拉到的词表快照）

### Added

- **`ip` 第五域评测语料**（`eval-looks.json`）：14 条能现场跑的条目 —— 参数化 5 条（`vert-i1101..i1105`，覆盖 `ip.global` 词表里 `type`/`keyword`/`applicant`/`ipc`/`date_start` 的两参、三参和四参组合）、语义 5 条（`vert-i1201..i1205`，spec 只写 domain，沿用已有语义层的写法；参数化 `ip.global` 不带参数时多数回的是没有 URL 的文本，当前 adapter 会把这些丢掉，所以这一层不做断言）、对照 4 条（`ctrl-i101..i104`：没有 spec 时防止被误标、spec 配错时静默退回普通搜索、乱写的 sub_domain 被拒、问题本身有歧义）。5 条参数化条目都定义了 `hitHosts`（部分还带 `/patent/` 路径池）；语义条目按 2026-11-07 只给 domain 时实测到的宿主补上 `hitHosts` 测量池。
- **`ip` 进垂域维度词表**（`packages/store/src/eval/docs-golden.ts`）：`VERTICAL_DIMENSION_VALUES.vdomain` 加 `ip`，新语料才能过 schema 校验；docs 那边八个维度的计数检查不受影响（垂域标签走的是另一份词表）。
- **词表快照存档**（`docs/eval/ip-corpus-probe-2026-11-07.md` + `docs/vertical-domains.md`）：记下 2026-11-07 调 `get_sub_domains(domain="ip")` 的原文（只有一个子域 `ip.global`，参数 `type`/`keyword`/`applicant`/`ipc`/`date_start`）和搜索结果的各种形态（只给 domain 时静默退回普通搜索、乱写 sub_domain 时 `isError`、乱写 type 值时静默接受）。快照只用来建语料，运行时不读它。
- **上游阻塞清单里补上 #24 的进展**（`docs/research/upstream-unblock-registry.md`）：#24 那条加上 2026-11-07 触发的事实和语料放在哪；原来的 `登记状态: absent` 不变（内部评测缺口不往 `docs/limitations.md` 补）。

### Verification

- `validateDocsGoldenSet` / `validateCoverageManifest` / `crossCheckDocsGolden` 对更新后的记录零问题（Node 24 用 `--experimental-strip-types` 直接加载校验器，没有构建）。
- 远端的 `test:online` job 不构建 CLI：`apps/cli/dist` 不在时 `eval-looks-vertical.online.ts` 直接 SKIP（exit 0），所以 14 条新现场条目不会进那个 job 的配对 delta；现场语料要在已经构建好 CLI 的环境里单独跑。`check-build` 和其余 CI 检查项已经在这个 PR 上通过。

## Unreleased — #204: MCP 失败语义——isError、空结果与 provider 失败信息（provider failure metadata）

### Changed

- **MCP 工具执行失败返回 `isError: true`**：`search_web` / `research_web` / `recall_memory` 的处理函数抛错、vertical guard 拒绝、`ans_chat` 缺少 LLM 配置或 runtime 报错事件，都按 MCP 规范当作执行错误返回；错误结果只带原来那段可照着做的文字，不再带 `structuredContent`。
- **所有 provider 都失败才算错误，空结果不算**：`search_web` / `research_web` 零结果、而且问过的 provider 全在 `providersFailed` 里时，返回 `isError: true`，并在文字里点名失败的是谁；只要有一个 provider 成功、只是没搜到东西，仍然算成功（`isError` 不为 true）。`research_web` 按轮汇总失败信息，任何一轮有 provider 应答就算成功。
- **部分失败的成功结果带上 provider 失败信息**：至少一个 provider 成功、同时又有失败或 provider 构造错误时，`providersFailed`、`providerErrorClasses`、`providerBuildErrors` 会同时出现在 content JSON 和 `structuredContent` 里。
- **拒答和 `query_knowledge` 的 adapter=none/note 仍然是成功语义**：不因为上面收紧就改成错误。

### Tests

- `apps/mcp/test/failure-semantics.test.ts`：处理函数抛错（三个工具）、`ans_chat` 缺配置和 runtime 报错、全部失败、部分失败信息走两个通道、零结果算成功、拒答、`query_knowledge` 的 note，以及真实的无状态 HTTP 传输上 `isError` 能传出去、"unknown tool 仍然是 JSON-RPC error"。
- `apps/mcp/test/dual-era.test.ts`：离线测 `ans_chat` 缺配置时的错误结果（stdio + HTTP）；`apps/mcp/test/vertical-guard.test.ts`：固定的期望文字没变，新增 `isError: true` 和无 `structuredContent` 的断言。

## Unreleased — #188: token 预算预留——run 开始先占额度 + 超了硬停 + 冷启动估算（T9 做完）

### Added

- **run 开始前先占住 token 额度**（`packages/kernel/src/pi-runtime.ts`）：在 `agent_start` 这个点上（`agent.prompt` 之前）按「输入占用 + 输出上限」调 `ledger.reserveTokens`。现在每次 run 都开新对话，启动时没有历史，所以实际估的是马上要发出去的 system prompt 和用户输入（这个数偏低）；代码里留了「上下文里已经有模型回报用量就直接用」的路径，但当前生产路径走不到。输出上限默认 12288，可用 `[budget].outputReserveTokens` 改（解析仍然只由 #187 的 `resolveOutputReserveTokens` 一处负责）。
- **占不到额度就硬停**：`reserveTokens` 返回 false 时只发一个结构化 `error` 事件，不启动这次 run 的 `agent.prompt`，不发 `done`、不编造摘要，也不结算 token/USD 或 per-call。只停这一次 run；改 TOML 提额后下一轮 run 会重读并刷新上限，可以继续。预算记录本身抛错仍按 #200 的「出故障就放行」处理：用带名字的 stderr 报出来，这次 run 不预留但继续跑。run 正常结束或 provider 报零用量时释放这次预留；事件流被提前关掉时先中止这一轮，最多等 1 秒拿最终用量；等不到就按当时的用量先释放预留再返回，之后有更多用量再补记差额。如果中止时模型还没报最终用量，就按预留量保守记账，不当作零用量放过；进程在后台补记前退出时，晚到的用量可能少记，但预留已经释放。
- **run 开始重读当前领域并刷新预算记录上限**：有 `domainTomlPath` 时，每次 run 开头都走 mtime 重载；新建 runtime 的第一次探测强制加载当前文件（长驻 MCP 每个请求新建 runtime，启动时的配置快照可能已经落后于文件），之后只看 mtime 有没有变。运行时工具调用（`beforeToolCall`）期间读到的 TOML 改动会记下来，到下次 run 开头再刷新，免得下一次探测看不到文件变化而漏掉。读到新的 `[budget]` 时调预算记录接口的 `initBudget`（节被删了就 `clearBudgetCaps`），让提额在下一轮 run 生效，不用重启。TOML 写坏时保留上一份能用的配置，刷新失败就「出故障就放行」，用带名字的 stderr 报出来。runtime 现在也接收宿主的 `domainsDirs`；`domainTomlPath` 也按同一组目录和建引擎时的域名去找那份 TOML，`createEngine` 会返回实际用到的目录（包括默认链），`base` 或当前领域只在宿主多给了目录、或者宿主自己塞了 engine 时也不会退回 `default`。

### Changed

- **token 从「只在结束时结算」改成「先预留、再结算」两段**：run 结束时 `settleTokens` 先释放这次预留，再按 provider 实报的总量计入 spent；实际用量可以超过预留（输出超过静态上限时不倒扣）。USD 仍然只在结束时结算，不预留（因为没有价格表）。
- **`GLOSSARY.md` 里预算记账那一条**同步成「先预留、再结算」两段。

### Tests

- `packages/kernel/test/pi-runtime.test.ts`：预留公式和冷启动估算/用量检查项的纯函数断言；默认 12288 和 TOML 改写都通过预算记录接口观察，并在真实预算记录的上限边界再验一遍（12488 成功 / 12487 失败，4096 改写为 4296 成功 / 4295 失败）；真实 `SqliteSessionStore` 下预留被拒时只有一个 error、没有 done、`agent.prompt` 没启动、预算记录没有 spend/reserved；提高上限后同一个 runtime 可以继续跑；实际用量超过预留时仍按实结算且 reserved 归零；零用量 run 释放预留；事件流提前关闭时最多等 1 秒拿最终用量，停不下来就先按当时用量释放预留、返回后再补差额；`beforeToolCall` 中途读到的 TOML 改动会在下次 run 开头刷新预算记录；`base` 只在宿主额外给了 `domainsDirs` 时也能解析；token 结算抛错时 finally 只重试一次且只记一次账；`reserveTokens` 抛错按「出故障就放行」报出带名字的 stderr，run 继续；真实 TOML 文件覆盖两种生产情形——先改文件再新建 runtime（MCP 的用法）和同一个 runtime 后面升降上限——都会刷新预算记录行。原有 #178/#200 用例的 token 上限跟着预留语义上调，按实际用量结算的断言保留。
- `packages/store/test/url-policy.test.ts`：`createDomainReloader` 的 `forceFirst` 只在第一次探测时强制返回当前 schema，之后恢复 unchanged → null 的原约定。

## Unreleased — #178: PiAgentRuntime 接上预算记录——token/USD 结算进生产路径（承接 #36）

### Changed

- **`ans chat` / `ans_chat` 的生产 runtime 拿到真实 `BudgetLedger`**：`wireChatMemory`（CLI）和 `resolveAnsChatSession`（MCP）在会话行注册成功后，把 `CompositionResult.ledger`（和 store 同一个连接、`createBudgetLedger()` 的同一个实例）跟 `store`/`sessionId` 一起交给 `PiAgentRuntime`；注册失败就「出故障就放行」，不交记录，避免给一个不存在的会话行结算。以前 `CompositionResult.ledger` 只有 engine 用，runtime 的结算代码和单测都在，但生产路径永远走不到（#177 留下的）。
- **runtime 的计费条件收紧为 `store && sessionId && ledger`**（`packages/kernel/src/pi-runtime.ts`）：跟 MemoryPipeline 用同一个条件；只有预算记录、没有 store/session 的接法不再往预算记录写。`reserveCalls()` 被拒时仍照旧继续这次 run（runtime 硬停归 #188），但不再把没占到额度的 per-call 记成计费调用；token/USD 仍然只按实际用量结算。
- **done 事件里的 token 摘要和记录用同一个标准**：摘要多了 `= <total> total`，total 就是 `settleTokens` 写进去的 `usage.totalTokens`（含 cache read/write），修掉摘要只报 input+output、记录按 total 结算时两边对不上的问题。
- **engine answer 模式的 per-call 预留释放修正**（`packages/kernel/src/engine.ts`）：预留和结算用同一个 `perCallEstimate`；以前 answer 模式按 2 倍的 answer-capable provider 预留，却按 provider 数量结算，每个 answer-capable provider 都留下 1 个 `reserved_calls`，一直吃掉 call 预算（#177 审查时转过来的事）。

### Tests

- `packages/kernel/test/pi-runtime.test.ts`：真实 `SqliteSessionStore` + `createBudgetLedger()` 的 runtime 端到端（spentTokens=157 / spentUsd / billableCalls=1 / reservedCalls=0，done 摘要的总数和预算记录一致）；`callCap=0` 拒绝预留时不记计费调用、token 实际用量仍然记账；只有预算记录缺 store/session 时计费条件保持关闭；原有的零 usage 不写结算的回归保留。
- `packages/kernel/test/engine-anchor.test.ts`：answer 模式预留 2、结算释放同一个界，`reservedCalls` 归零。
- `apps/cli/test/chat-memory-wiring.test.ts` / `apps/mcp/test/ans-chat-session.test.ts`：接好的路径返回的 engine ledger 是同一个实例；注册失败路径不返回 ledger；budget setup 失败路径保留记忆接线，但不给 ledger。

### Fixed

- **CodeRabbit #200 返修——预算出故障就放行**：两个接线函数在会话行注册成功、但 budget setup 失败（`initBudget` / `clearBudgetCaps` 抛错，或者声明了 `[budget]` 而 store 没有 `initBudget` 接口）时不再交出 ledger；runtime 的 `reserveCalls` / `settleCalls` / `settleTokens` / `settleUsd` 各自 try/catch 并用带名字的 stderr 报出来，预算记录锁住也不会在 `agent.prompt` 前或完成后打断 chat，消息同步和 done 事件继续。测试覆盖 reserve 抛错、settle 抛错（后面的 settle 仍会执行）和两条接线各自的 budget 失败路径。

## Unreleased — #189: 恢复会话时注入恢复摘要（读恢复存档点的那一侧）

### Added

- **恢复会话时读最后一条 `sufficiency` 存档点，生成并注入一段恢复摘要**（`packages/kernel/src/recovery-digest.ts`、`memory-pipeline.ts`）：这段摘要里有 query、mode、verdict、每个 provider 的结果数、failed/cancelled、unique 计数，并写明「检索计算已完成、送达状态未知」；整块连标记不超过 600 字符的硬上限，query 超长时加一个明显的 `[truncated]` 标记；块头按既有的内容信任边界标成 untrusted（不是用户写的），只当数据、不当指令。只在恢复会话时从存档点读一次；因为 `transformContext` 的输出不会写回 agent history，每个模型调用保持一份，历史里已经有时不重复加（否则工具调用后的后续 prompt 会丢）；新开的会话没有存档点，零注入。engine 仍然只写存档点，读的那一侧全在 kernel 记忆流水线（`packages/kernel/src/engine.ts` 只改了注释）。
- **`done` 事件带上恢复摘要**（`packages/kernel/src/pi-runtime.ts`）：发生恢复注入时，`done` 事件多一个可选的 `recovery` 字段；`ans chat` 和 MCP `ans_chat` 的输出都会显示这段摘要。

### Fixed

- **`summaryAnchor`/`recallAnchor` 的 payload 判空类型收尾**（`packages/kernel/src/memory-pipeline.ts`）：`summaryAnchor?.payload as any` 在 `strict` 下仍然触发 TS18048（possibly undefined），改成先取局部 payload 再判空；注入行为没变。#178 那个窗口已经在 `2b57d8f8` 先带同一个修复，免得误快进到 main 时 check-build 变红；本分支补上后两边可以合并。

### Tests

- `packages/kernel/test/recovery-digest.test.ts`：断言最终注入的文本（prompt / transformContext 接口）包含全部字段和 UNKNOWN 声明；新开会话零注入；只读最后一条存档点；每个模型调用保持一份，历史回传（含更早的 user 轮）时不重复；query 超长时的截断标记；600 字符硬上限和病态 provider 列表下收窄后的形状；untrusted 标记和引号转义；摘要块不污染 RAG recall key；第一次读存档点失败时不把本轮自己写的存档点当成恢复；工具调用后的后续 prompt 仍然有摘要；`done.recovery` 看得见。

### Documented

- `docs/rag-adapters.md` 的注入位置表补上恢复摘要一行、600 字符上限，并写明它只注入一次、历史里会去重。

## Unreleased — #183: store 侧退出路径显式收尾——找到 F-16 的根因 + 恢复 macOS 那一项

### Fixed

- **F-16 这一家的根因不是「better-sqlite3 句柄泄漏」，而是 `process.exit()` 在 Node 线程池/native 状态还活着时执行 C++ 静态析构**（`packages/store/src/teardown.ts` / `src/db.ts` / `src/eval/cli.ts` / `test/helpers/exit-teardown.mjs`）：Apple 的 libc++ 下锁一个已经析构的 mutex 会拿到 `EINVAL` → `std::system_error` → `std::terminate` → SIGABRT，所以 Linux 上从没复现过，光关句柄也不够。
  - **句柄这一侧**：把 `fd249d41` 的「只排空一次」注册表下沉到 `@anysearch-cli/store`（`registerTeardown` 返回 disposer，owner 提前 close 时不留引用），新增 `openDatabase`/`trackDatabase` 作为 store 原生句柄的唯一入口（`close()` 幂等 + 自己注销注册），session-store / observation / eval runner / switch-run / domain-recommend 全部改走它；`apps/cli/src/teardown.ts` 改成 re-export，CLI 和 store 共用同一张注册表。
  - **退出方式**：eval runner 退出改成跟 CLI 一样的写法（先 drain → `process.exitCode` → `unrefPendingHandles()` → 5s unref 看门狗），不再让 `process.exit()` 跟 libuv 的收尾抢；运行期看门狗（`EVAL_TIMEOUT_MS`）在强制 `process.exit(124)` 前也先 drain（看门狗触发时用例可能正拿着被跟踪的句柄）；store 测试进程预加载 `test/helpers/exit-teardown.mjs`，把 `process.exit(code)` 延后成自然退出（退出码保留 + 非零粘性 + 5s unref 看门狗兜底）。预加载**不**做裸句柄拦截：tsx 下 ESM 导入 better-sqlite3 读不到被改写过的 CJS `module.exports`（CI 已经证伪：diag run 42043443737），而且关句柄从来不是止血点——那条路径已经删了，没有留着装样子。
  - **重试语义**：drain 时抛错的收尾会留在注册表里等下一次 drain（原生 close 可能因为还有活跃的 statement iterator 而失败），`trackDatabase` 的注册也要等原生 close 成功才注销；owner 那边和退出那边共用同一个 `closeOnce()`，失败不吞掉登记。
  - **回归**：`packages/store/test/teardown.test.ts` 锁定注册表语义（顺序/异常吞掉/只排空一次 + 失败保留待重试/disposer）、被跟踪的打开器（drain 时关闭、owner close 时注销、幂等）以及**延后退出时退出码的粘性**（`if (failed) process.exit(1); process.exit(0);` 这种先失败后清零的写法不能被盖掉，子进程实测 1/0/2 三例）。
- **证据链（远端取证，不是推断）**：run 41913304226（PR #174 晋级后第一次 macOS 全量门）5/76 个文件 abort 且断言零失败；diag run 42031513303 在「只关句柄」之后仍然丢 4 个文件——access-chain-telemetry / access-chain-verify / eval-abstain / fusion-registry-memory，全都以 `process.exit(...)` 收尾——同一轮 `eval-gate.test.ts` 变绿，唯一变量是 eval runner 不再调 `process.exit()`；diag run 42032450895 跑出 `[pass] turbo run test` + `SHIP_GATE_EXIT=0`；随后 **macOS 全量门连续三次绿**（PR #191，含 store 全量套件）：run 42032463918（head `9d172d3`）、run 42034443431（head `ef6fda5`）、run 42035956744（head `5acf577`）。

### Changed

- **`macos-latest` 回到 `ship-gate` 的阻断矩阵**（`.github/workflows/ship-gate.yml`）：`os: [ubuntu-latest, macos-latest, windows-latest]`，矩阵注释改成讲清「修了什么 + 证据怎么算 + 晋级规则怎么重新校准」的完整因果；`scripts/assert-checks-green.mjs` 的 `REQUIRED_LEGS` 同步加上 `ship-gate (macos-latest)`（跟矩阵两边锁步，`eval-release-layering.test.ts` 断言）。
- **`macos-spillover-probe` 按 TTL 改成「不阻塞、只保留」**：继续当崩溃签名报告器和早期预警，不再当晋级或再剪除的时钟（它单独红不算数，全量检查那一项才是准的）；job 注释和 `scripts/macos-exit-probe.mjs` 的头注释/GREEN/CRASH 结论文字同步。

### Documented

- **`docs/limitations.md`** 的 macOS 条目改写成「根因 = 强制退出 × native 状态」的完整证据链 + 修了哪些地方 + 晋级证据 + 剩下的边界（任何强制退出仍然可能 abort；`apps/mcp`/`apps/plugin` 是按连接 close，没有接注册表 drain）；新增「测试里 `process.exit()` 不再同步终止」一条。
- **README / README.zh-CN 的 Known limitations 行**从「macOS 在阻断矩阵之外」改成「macOS 退出时的 abort 已经找到 + 那一项已恢复 + 剩下的边界」。

## Unreleased — #180: `ans search` 显示哪些 provider 没构造起来（providerBuildErrors，承接 #41）

### Added

- **`ans search` 显示哪些 provider 没构造起来、属于哪类安全错误**：`apps/cli/src/commands/search.ts` 用内核的 `CompositionResult.providerBuildErrors`（#105/#41 已完成的「出故障就放行 + 点名降级」信息，之前 app 侧没人用），跟运行时的 `providersFailed` 信息一起显示——人类可读的输出在原来的 `Providers queried/failed` 行后面加一行 `Providers absent (build failure): <id> — <safe category>`（拒答和 results 两个显示分支都有）；`--json` 返回包多一个字段 `providerBuildErrors`（id → 安全类别；全都正常时是 `{}`）。类别文字原样照抄内核的安全标准（CWE-532：构造错误的原文不进任何显示——记录本身只写类别），让用户自己修 key 或配置；全都正常时人类输出一个字都不多（空记录不打印）。不新开 doctor 子命令（父 spec #175 决议 5：跟「出故障就放行」这一家的显示标准保持一致）。显示逻辑放在纯函数 `formatProviderAbsentLine`（`apps/cli/src/commands/search-abstain.ts`，头注释改成 Search presentation helpers）。
- **全都没构造起来时也能看出原因**：enabled 的 provider 全部构造失败时，内核引擎在 search 入口直接 throw `No providers registered`（原有约定，`engine.test.ts` 钉死）——运行时那行显示走不到，catch 路径补打同样的缺席行（走 stderr，`--json` 的 stdout 在错误路径也保持干净）。「一个 key 都没配」这种要自己动手修的情况，从头到尾都看得明白。
- **只有 `ans search` 显示（故意的，记在案）**：chat/entity/memory/relation 等其他用到引擎的地方这期不显示——它们的命令输出里没有位置挂 provider 信息（取最小形态），构造失败的诊断仍由内核的 stderr 行给出（#41 内核级交付）；以后 chat 那边也要显示，另开票。
- **回归**：`apps/cli/test/e2e.test.ts` 五条命令输出断言，覆盖五个显示——①全部缺席的错误路径（没有 key 的 exa-only 域，引擎零条查找、零网络）：exit 1 + `ans search error: No providers registered` + 缺席行 golden；②部分缺席的拒答分支（exa 构造失败 + anysearch 可选 key 构造成功 + `urlAllowlist` 确定性地把结果清空）：exit 0 +拒答行 + `Providers queried: anysearch` + 缺席行 golden；③部分缺席的 `--json`：`runSplit` 助手（把 stdout/stderr 分开）断言 stdout 只有一个 JSON 文档、干净、字段值正确（`providersFailed` 不做断言——这里测的是构造缺席记录）；④全部缺席的 `--json` 错误路径：stdout 恒空（干净输出的约定钉死）、error 行 + 缺席行都在 stderr；⑤全都正常时零噪音（dummy key 构造成功 + 没有 allowlist 走 results 分支）：缺席行不打印 + 运行时 401 走 `Providers failed` 行——把「构造缺席」和「运行时失败」两个面分开判断。`EXA_API_KEY` 显式空串 + `ANS_PROVIDERS` 显式空串 + 策略可达的夹具（②③⑤）设 `ANS_ALLOW_ENV_OVERRIDE="0"`（TOML allowlist 是唯一权威来源）+ ②③ 设 `ANYSEARCH_ENDPOINT=http://127.0.0.1:9` 死端口注入（跟 install-smoke 一样的做法，CodeRabbit PR #194 Major 返修——anysearch 那条查找照常构造和查询，运行时 ECONNREFUSED 快速失败，不依赖现场端点时序）（rehydrateConfigEnv 不会覆盖显式值，开发机 `~/.anysearch/config.env` 和 shell 里残留的 eval 通道值都灌不回来）。`apps/cli/test/abstain.test.ts` 补 `formatProviderAbsentLine` 纯函数约定（空记录时 `undefined` / golden 单行 / 多个缺席用 `"; "` 连在同一行）。

## Unreleased — #182: 仓务——把 #94 的 MCP SDK v2 调研报告放进 main + `.temp/` 会话残留怎么处理

### Documented

- **#94 的 MCP SDK v2 调研报告归档到 `docs/research/mcp-sdk-v2-status.md`**：证据放在 `main`，跟 `upstream-unblock-registry.md` 的归档做法一致（#171）。内容来自 issue #94 的结案评论（2026-11-03）；归档时原来的 `research/mcp-sdk-v2` 分支已经没法从 `origin` 恢复，那份评论就是现在能拿到的权威结论。没有改动任何行为。
- **`.temp/` 会话残留逐项处理方案 `docs/research/temp-session-residue-disposition.md`**：把 #15/#16 调查文件、CI 日志取证、land 前备份、评审快照四类残留列出来，逐项给出删、存档还是留着的建议；删除动作都标着「要用户单独授权」，本票不执行任何删除。没有改动任何行为。

## Unreleased — #187: 预算配置打基础（TOML 里的 `[budget]` + 注册会话时 initBudget + 没有预算记录行就放行）

### Added

- **领域 TOML 可以写 `[budget]` 节**（`packages/store/src/domain-schema.ts`）：支持 `tokenCap` / `usdCap` / `callCap` / `outputReserveTokens` 四个可选键。不写这一节 = 新会话不建预算记录行 = 没配置就放行；已经有的预算记录行，在重新注册到一个没有 `[budget]` 的当前领域时会被设成 `configured=0`（`getBalance` 当作没配置、预留放行，花掉的记录保留，以后重新配预算还复用同一行），免得切换领域或删掉这一节后旧上限继续生效。节里缺哪个字段 = 那个维度没有上限（写进库里是 `Number.MAX_SAFE_INTEGER` 这个表示「无上限」的值，不是 0）；明确写 `0` = 那个维度全拒（连 `amount=0` 的预留也拒）。未知键、负数、非有限值、计数键不是整数，在加载时就报错停下（`Domain schema:` 这一家）。`outputReserveTokens` 覆盖代码里的常量 `DEFAULT_OUTPUT_RESERVE_TOKENS = 12288`，并由 `resolveOutputReserveTokens()` 作为 #188 唯一的解析入口（43 次真实 run：输出 p95=9,309 / max=9,600；重测触发条件是 R≈1.5× 校准后的 maxTokens=8192）。继承方式跟 `[compaction]` 一样：**整节替换**——子域一旦写了 `[budget]`，就要把全部上限重新写一遍，没重写的维度变成无上限（这是明着要求重写的约定，不是按字段继承）。
- **注册会话时就初始化预算行**：`SessionStore.initBudget(sessionId, caps)` 在 CLI `wireChatMemory`（`ensureSession` 同一个点）和 MCP `resolveAnsChatSession`（`ensureSession` / `createSession` 两条路径）按当时的当前领域调；没有 `[budget]` 时改调 `SessionStore.clearBudgetCaps`（新会话没有行就什么也不做；旧行设成 `configured=0`，`getBalance` 返回 null、预留放行，行和花掉的记录都留着）。`BudgetLedger.initBudget` 靠 `budget_ledger(session_id)` 唯一约束兜底，但实现是先 SELECT 再 UPDATE/INSERT（不依赖 `ON CONFLICT`，老库缺唯一索引时记录照样能建、能读写），重复注册只刷新上限和 configured，保留 reserved/spent 计数。`budget_ledger` 多了一个 `configured` 列（老库用带保护的 ALTER 迁移，老库的唯一索引也用带保护的迁移补建；新库用表级 `UNIQUE(session_id)`，免得 `db.exec(schema)` 中途失败后后面的 DDL 不建）；老库有重复行时，在加唯一索引前先合并（spend/reserved 求和，上限取最严的那条有效行）。只有合并成功并且唯一索引也建成功，才保证一个 session 一行、不丢历史；合并失败只警告并继续，唯一索引可能建不起来，这种降级状态下重复行仍可能存在。已知限制：只在注册那一个时刻采样一次，领域中途切换不会重新初始化；MCP 长驻进程的 `eng.config` 是启动时的快照，TOML 提额要重启进程才生效（CLI 每次运行都重载）；多个进程共享同一个持久恢复点并发跑时，预算行是最后写的那个赢。
- **预算记录里的预留有三种状态**：没有行 = 放行（不写行）；`configured=0` 的已有行 = 记录预留量但不强制上限（行为上放行）；`configured=1` 的行在上限内 = 放行、超了 = 拒绝、上限为 0 = 全拒。`reserveTokens` / `reserveUsd` / `reserveCalls` 先看行在不在，再按 `configured` 决定是强制还是只记账。`initBudget` 没给上限时原来默认 0（意外全拒），现在改成「无上限」那个值。
- **clear 之后结算还是安全的（CodeRabbit PR #196 返修）**：`reserveCalls/Tokens/Usd` 在 `configured=0` 的已有行上仍然记录预留量（只是不强制上限），所以 clear 之后新增的预留、以及 clear 之后又被 `initBudget` 重新激活的预留，都能安全结算；`settleCalls/Tokens/Usd` 的减量统一用 `MAX(0, …)`，不会撞上非负 CHECK，只有 `configured=0` 且没有记录过预留量的 settle 是什么也不做，不会凭空多出 spend。clear 之前的预留量照常能结算、并计入 spend。

### Tests

- `packages/store/test/domain-schema.test.ts`：`[budget]` 解析（含小数 `usdCap`、显式 0、空节、缺节）、继承时整节替换、未知键/负数/小数计数/负输出预留报错停下、12288 常量、`resolveOutputReserveTokens` 缺省/覆盖/显式 0。
- `packages/store/test/budget-ledger.test.ts`：没有行时四个维度都放行、显式 0 全拒（含 `amount=0` 三个维度）、节里缺字段就是无上限、重复 `initBudget` 只刷新上限且保留计数/仍是单行、`clearBudgetCaps` 没有行时什么也不做 / 有行时设 configured=0 后 getBalance 为 null 且 spend 保留 / 重新 init 复用同一行、老库重复行 + 缺 configured 列的带保护迁移（重复行先合并成单行、spend/reserved 求和、上限取最严的有效行；预算记录能读也能初始化）、唯一冲突时 INSERT→UPDATE 重试（并发注册仍是单行）、clear 后结算安全（没配置的预留量什么也不做、clear 前的预留量夹紧后结算不会撞非负 CHECK）。
- `apps/cli/test/chat-memory-wiring.test.ts`：真实 store 注册后预算记录行存在；没有 `[budget]` 不建行；同一个恢复点从有预算切到没预算时 getBalance 变成 null（当作没配置）；TOML 显式 0 和缺省字段经 `toBudgetCaps` 落到预算记录的整条链路断言。
- `apps/mcp/test/ans-chat-session.test.ts`：`ensureSession` 和 `createSession` 两条 MCP 注册路径都建行；没有 `[budget]` 不建行；同一个 handle 删掉 `[budget]` 后 getBalance 变成 null。
- `scripts/validate-domains.mjs`：仓库里的领域 TOML 校验也跟着接受并校验 `[budget]`；规则跟 `domain-schema.validate` 同源（脚本不依赖 TS，注释里写了这层镜像关系）。

## Unreleased — #177: 统一装配入口接线——engine 每次检索带上 sessionId + BudgetLedger（T2）

### Changed

- **per-call 预算和证据够不够的存档点，从「在生产路径上没用」变成真的会触发**：`createEngine` 把 `SqliteSessionStore` 的 `BudgetLedger`（同一个连接，`createBudgetLedger()`）塞给 engine，并在 `CompositionResult.ledger` 暴露同一个实例给 #178 用。预算行的建立和清理由 #187 的会话注册点负责（`SessionStore.initBudget` / `clearBudgetCaps`，按当前领域的 `[budget]`）；engine 不再自己建行，没有 `[budget]` 时沿用 #187 的「没有行 = 放行」。
- **检索时带上会话身份**：新增 `Query.sessionId`；`PiAgentRuntime` 构造一个绑定了会话的 retriever（条件是 `store && sessionId`），同时给内置 search 工具、`MemoryPipeline`、`SufficiencyEvaluator` 的再检索用，让 `ans chat` / `ans_chat` 每次内部检索都带上接好的会话句柄。engine 的预算记录/存档点条件改成 `q.sessionId || 构造期 sessionId`；这个条件的判断、reserve→settle、存档点只追加的语义都没改。
- **plugin 的统一装配入口不注入**：`apps/plugin` 的 hooks/server 不构造 engine，也没有可复用的会话，注释里说明了按「出故障就放行」处理。

### Tests

- `packages/kernel/test/engine-anchor.test.ts`：统一装配入口从搜索到存储（真实 `createEngine` + 空 sources 领域 + mock provider）断言 证据够不够 存档点落库；没有 budget 行时按 #187 的语义放行且不建行；显式 `initBudget` 后验证 reserve→settle、超预算拒绝、拒绝后余额不变；runtime 层验证完整接线会把 sessionId 传下去、只接一半不传、证据够不够的检查共用同一个绑定的 retriever。

## Unreleased — #16: 想让 macOS 变成阻断项，第一次全量跑就推翻了——再拿出去 + 恢复探针 + 给检查项加锁（PR #174）

### Changed

- **`macos-latest` 的晋级尝试被它第一次全量门反过来证伪，于是再次拿掉 `ship-gate` 的阻断矩阵**（`.github/workflows/ship-gate.yml`）：晋级的依据（探针的 TTL 规则「连续 ≥5 次绿就评估恢复」，2026-11-04 的七连绿 41840345806…41850289669 达标）在第一次 macOS 全量门（41913304226）上就不成立了——5/76 个 store 测试文件在**断言全部通过之后**退出时崩溃（`libc++abi` "mutex lock failed: Invalid argument"），另外 `eval-gate.test.ts` 抓到 eval runner 子进程被信号杀死；F-16 这一家在全量负载下还活着。根因：`fd249d41` 的显式收尾只盖住了 CLI 的统一装配入口（`apps/cli`），store 侧进程退出（测试文件、`packages/store/src/eval/cli.ts`）从来没修过，而探针只跑已经修好的 CLI 路径——**探针看到的范围 ≠ 全量门验收的范围**。矩阵退回 ubuntu+windows。
- **晋级规则重新校准**：要让这一项回来，需要 store 侧收尾修好后的**全量门试跑绿证据**；「≥5 次最小复现连绿」已经证明不够。这条规则同步写进 ship-gate.yml 的矩阵注释、探针 job 的 TTL 注释、`scripts/macos-exit-probe.mjs` 的头注释和结论文字、`docs/limitations.md`。
- **检查项加锁（审计 S2，PR #174 CodeRabbit）**：`scripts/assert-checks-green.mjs` 新增 `REQUIRED_LEGS`——按名字找检查项这一层过了之后，没登记的阻断检查项不能再靠已登记的检查项单独判为通过（原来有竞态：macos runner 排队更久时，两项检查就能判为通过）；缺检查项保持在 discovery 阶段，discovery 窗口到期后按「拿不准就拒绝」处理。`release.yml` 的 pre-tag 在 wait-on-check（正则没法要求指定的检查项）后面加了同一个脚本的检查项级断言步骤（`--timeout-min 20`，跟 wait 步骤一样的 20 分钟窗口——晚注册的检查项需要完整的运行时间，5 分钟会把健康的发布按「拿不准就拒绝」拦掉），覆盖同一个缺口。`REQUIRED_LEGS` 跟 ship-gate.yml 矩阵的双向同步（缺检查项和多余的检查项都判为失败）由 `eval-release-layering.test.ts` 的新断言强制（锁步）。

### Fixed

- **观察冒烟测试看不到信号（审计 S1，PR #174 CodeRabbit）**：`scripts/verify-observation.mjs` 以前只查 `cli.error`——CLI 写完 trace 后在收尾时被 SIGABRT 杀死（F-16 的签名）时，冒烟测试仍然 PASS。新增 `cli.signal` 判为失败（status 仍然不设门：收尾会间歇改写退出码，信号才是可靠的标记；MCP 子进程豁免——3 秒兜底 kill 是脚本自己发的信号）。

### Restored

- **`macos-spillover-probe` job 和 `scripts/macos-exit-probe.mjs` 从 73ada6b0 恢复**（逐字节恢复，含 #121 的 `working-directory: packages/store` 路径修复），跟着再剪除一起回来当观察位；TTL 文字改成「崩溃签名报告器，不是晋级时钟」。`eval-release-layering.test.ts` 的 Node 22 锁定版本断言不变（三个 job 的时代 3 个钉全是 22，`pins.length >= 2` 兼容）。

### Documented

- **README 的 Known limitations 恢复「macOS is outside the blocking matrix」这一行**（带上 PR #174 的复现证据说法）；`docs/limitations.md` 的剪除条目改成「晋级尝试被第一次跑推翻」的完整因果和重新校准后的规则，registration 段红条目的收尾说明同步；`docs/release-notes/0.0.3.md` 是当时点的记录，不动。

## Unreleased — #15: 确认 api.anysearch.com 是官方的（证据齐了）

### Documented

- **`packages/retriever/src/providers/anysearch.ts` 的注释块从 DEFERRED-WITH-DEADLINE 改成 CONFIRMED（2026-11-04）**：api.anysearch.com 归官方所有这件事（ADR-0059 D7/T-6.4 原来延期的那项）收尾了。证据：官方仓库 `anysearch-ai/anysearch-mcp-server` 的 README 明确写着 "The production endpoint is: https://api.anysearch.com/mcp"（原生 Streamable HTTP）；Key 控制台在 apex 域（anysearch.com/console/api-keys），官方注册路由 `POST /v1/auth/email/register` 也在同一台主机；通配符证书（2026-09-22 轮换、有效期到 2027-04-07、Amazon RSA 2048 M04、SAN `*.anysearch.com+anysearch.com`）同主体覆盖 apex 和 api 子域；`GET /health` 在 2026-11-04 复核是 200（code:0 返回包）。治理层拆掉（5593fe05）后，这件活账由 issue #15 接着记——注释块原来指向已经删掉的 `docs/deferred-registry.json`，那个悬空引用也一并修好，改指 #15。附注修正：GET `/v1/search` 404 这句补明官方 REST search 是 POST——GET 不通 ≠ REST 不通。纯注释改动，行为零变化，不碰测试；证书 CT/到期观察保留（下一个节点 2027-04-07，轮换时再复核归属没变）。

## Unreleased — #162: `ans chat` 遇到 `Domain schema:` 错误直接报错停下

### Fixed

- **`Domain schema:` 校验错误不再被悄悄降级成默认域**：`apps/cli/src/commands/chat.ts` 里加载 domain 的 catch 先过 `isDomainSchemaError()`（新增在 `packages/store/src/domain-schema.ts`，跟 `createEngine` 用同一个判断函数）；`Domain schema:` 校验错误直接 rethrow，由 CLI 顶层处理写出错误并以非零退出。数据库/IO 故障和 `Domain not found` 仍走原来的回退（持久库失败再降级到内存库并告警）。TOML 语法错误和继承链错误（`Invalid TOML document:` / `Base domain not found:`）不属于票面点名的 `Domain schema:` 这一家，行为没改（不在本票范围）。
- **回归**：`apps/cli/test/e2e.test.ts` 新增「`compaction.lowWatermark` 写坏 → `ans chat` 退出 1、stderr 指明 `Domain schema:` 且不再出现 `using fallback`」；以及「持久库父路径不可用 → 仍然输出 `Durable database unavailable` 的内存回退告警」。`packages/store/test/domain-schema.test.ts` 覆盖 schema 错误 / IO 错误 / 找不到域 / 不是 Error 这几种分类。

## Unreleased — #113: LOW_WATERMARK 改成按上下文窗口的比例（+ 把 contextWindow 传下去）

### Changed

- **L0 压缩水位支持 `compaction.lowWatermark = { fraction = ... }`**：`resolveLowWatermark` 把 fraction 算成 `floor(fraction × contextWindow)`；窗口从 `LlmSession.contextWindow` 取（pi-ai catalog）。`LlmSessionOptions.contextWindow` 会把自定义端点的窗口传下去——不设置时 pi-ai 仍然用 128000 占位，但 `LlmSession.contextWindow` 保持 `undefined`，所以 **L0 不会把占位值当成真实窗口**，而是退回原来的 128000 绝对值。绝对数的写法保持原样；fraction 写坏时由域加载器报错停下（`ans chat` 的整域回退已经在 #162 收窄成只有 DB/IO 故障和缺失域）。
- **比较水位时用当前上下文占用量**：`pi-runtime` 在 `shouldStopAfterTurn` 里用 `max(lastTotalTokens, estimateContextTokens(messages).tokens)`，覆盖工具结果在上一次 LLM 调用之后追加造成的一轮滞后（#114 复审留下的）；预算记录仍按 usage 事件结算，不受影响。
- **新增可选环境变量 `ANS_LLM_CONTEXT_WINDOW`**：CLI `ans chat` 和 MCP `ans_chat` 在统一装配入口读它并传下去；kernel 仍然一个环境变量都不读。非正整数报错停下。

### Documented

- 四份宿主集成文档的 Keys 段补上 `ANS_LLM_CONTEXT_WINDOW`（只有自定义端点需要；不设的话 L0 走未知窗口回退）。

### Tests

- `packages/kernel/test/memory-pipeline.test.ts`：1M/128K 窗口的比例、未知窗口回退、写坏的 fraction、绝对数优先；shell 层覆盖 120K（旧 128K 不触发、新 100K 触发）和未知窗口 15K 必须 skip。
- `packages/kernel/test/llm-init.test.ts`：catalog 窗口暴露、自定义端点默认 UNKNOWN、显式传下去、非法/小数报错停下。
- `packages/kernel/test/pi-runtime.test.ts`：大的工具结果估算会进水位数并能单独触发压缩。
- memory eval 的 golden 切片不走 `MemoryPipeline`（store 侧 consolidate 是独立的 L2 路径），默认 lowWatermark 没动。

## Unreleased — #129: `ans chat` 接上记忆流水线（持久库 + 固定 sessionId）

### Fixed

- **`ans chat` 上 RAG 和 L1/L2 记忆注入从来没生效过**：`PiAgentRuntime` 只在 `store && sessionId` 同时存在时才构造 `MemoryPipeline`，而 CLI 的统一装配入口两个都没传，`this.pipeline` 一直是 `undefined`——`transformContext` 原样返回、`consolidate` 的冷路径也整段跳过，而且**没有任何告警**。#104 的 `fts` adapter 因此在生产路径上等于不存在。现在 `apps/cli/src/commands/chat.ts` 用 `createPersistentEngine`（`ANS_DB_PATH`，默认 `~/.anysearch/anysearch.db`）取代原来落在 `":memory:"` 的 `createEngine`（fallback 分支也一样改），sessionId 取持久恢复点 `readSessionId()`（可用 `ANS_SESSION_ID` 覆盖）。回归：`packages/kernel/test/pi-runtime.test.ts` 的 no-store 透传、告警去重、真实 store 的 wired 三段断言，加上 `apps/cli/test/chat-memory-wiring.test.ts`。
- **没有记忆的统一装配入口不再沉默**：`PiAgentRuntime` 在 `store` / `sessionId` 任缺（包括两个都缺，也就是 `ans_chat` 以前的样子）时打一行带名字的 stderr，说清缺什么、注入已经关了；这个条件的语义（`store && sessionId`）没改。

### Added

- **`SessionStore.ensureSession(sessionId, domain)`**：幂等地（`INSERT OR IGNORE`）注册外部生成的会话 id。`messages` / `resume_anchors` / `retrieval_results` / `budget_ledger` 都用外键指向 `sessions(id)`，而且 store 开了 `foreign_keys = ON`，而 `createSession()` 自己生成 UUID、不收外部 id——持久的 sessionId 必须先注册才能写存档点。回归：`packages/store/test/session-store.test.ts` 用例 7。
- **CLI 统一装配入口的接线测试** `apps/cli/test/chat-memory-wiring.test.ts`：驱动 `runChat` 用的 `wireChatMemory()`（抽到不依赖 kernel 的 `apps/cli/src/commands/chat-memory.ts`），用真实 `SqliteSessionStore` 验证三件事——先把会话行注册好（满足外键）、重开 DB 后同一个持久 id 仍能召回之前的 `retrieval_results`（AC3）、`ensureSession` 失败时返回空接线并用带名字的告警。kernel 只证明接口，这条证明统一装配入口本身接错时会被测出来；运行时注入（RAG 块到达模型、重启召回）由 `packages/kernel/test/pi-runtime.test.ts` 覆盖——CLI 包是 CJS，而 kernel 依赖 ESM-only 的 `pi-agent-core`，测试不能直接导入 `chat.ts`。
- **`MemoryPipeline.flush()` / `PiAgentRuntime.flushMemory()`**：`consolidate()` 的摘要生成和 L2 召回是发出去就不管的，`runChat` 返回后 CLI 会在收尾时关掉持久库，还在路上的 `rolling_summary` / `l2_recall` 存档点写入会丢，而且被 `.catch(() => {})` 吞掉。现在这些写被登记下来，统一装配入口在返回前（`finally`，错误路径也盖住）把它们排空。回归：`packages/kernel/test/memory-pipeline.test.ts` 的门用例。

### Fixed（评论返修，PR #136）

- **L1/L2 注入在 block 形状下会丢用户问题**：Stage-1/T0 已经改用看形状的 helper，但 L1/L2 仍按 `typeof content === "string"` 取文本——pi-agent-core 会把 `prompt("…")` 规范化成 content block 数组，因此一旦有存档点，用户问题会被整个换成注入文本。现在改用 `readMessageText` / `appendMessageText`，没有文本通道时主动放弃注入。这条路径在本票之前走不到（pipeline 从来没被构造），接线后才成了真实风险，所以属于本票范围。回归：`memory-pipeline.test.ts` 的 block 形状和纯图片轮用例。
- **`store.append` 没 await 的 rejection 会终止进程**：同一个原因——路径原本走不到，接线后才启用。`append` 是 async，没 await 的 rejection 不会被外层 `try/catch` 抓到，Node ≥15 默认终止进程且消息丢失。改成逐条 await + 独立 try，单条失败不影响后面的消息并走原来的告警。回归：`pi-runtime.test.ts` 的 append-reject 用例。
- **后台摘要/判定调用没有上限**：`flush()` 会等它们，慢 provider 能把 CLI 退出拖到 provider 超时。压缩调用改用 `AbortSignal.timeout(90s)`，判定调用把 signal 传给 `streamFn`；超时按「发出去就不管」的失败处理（下一轮重试），`flush()` 仍然完整排空、不提前放弃写入。
- **会话存档点写入失败曾经是静默的**：`readSessionId()` 在存档点文件写失败时仍然返回新 id 但不报告，下次运行会换 id、读不到旧存档点。现在 catch 分支输出一行告警（建议设 `ANS_SESSION_ID` 或让目录可写），「出故障就放行」的语义不变。回归：`session-id-propagation.test.ts`。
- **持久库不可用时 `ans chat` 直接退出**：本票把 fallback 分支也改成 `createPersistentEngine()`，一旦 SQLite 或父目录不可用，会在构造 runtime 前就终止，反而比改动前更差（旧代码有 `":memory:"` 兜底）。现在持久引擎失败会降级到内存引擎并明确告警——chat 仍然能用，只是不持久化；内存库下跳过记忆接线（没法跨运行续上）。
- **持久库权限过宽（CWE-732）**：`createPersistentEngine` 之前按进程 umask 建目录和文件；本票让 `ans chat` 第一次往这个库写记忆后，共享主机上别的本地用户可能读到。现在目录 `0700`、库文件 `0600`（已经存在的文件也收紧），`chmod` 只尽力而为（Windows 忽略 POSIX 模式、不是属主也不阻断命令）。这个修复对所有走 `createPersistentEngine` 的命令都生效。

### Documented

- `docs/limitations.md` 更正：`ans_chat`（MCP）是**整条记忆链路都不存在**（pipeline 从来没被构造），不是 `fts` 出故障就放行到 `none`；并记下「只接一半」时的告警约定。`docs/rag-adapters.md` 同步更新 CLI 已经接线的事实和「`fts` 只读 `retrieval_results`、CLI 不写这张表」这条边界。

## Unreleased — #147: 用真的被 SIGKILL 杀掉的持有者来测锁回收（发布锁的路径也照原样）

### Added

- **`apps/cli/test/skill.test.ts`**：新增端到端用例「`a lock left by a SIGKILLed holder is reclaimed by the next install`」。原来的锁回收用例都用 `plantLock` **直接摆**状态（先 `mkdirSync(.installed.lock)` 再写 `owner.json`），那是旧形状——合并后的 `createLockDirectory` 顺序是「先建 `.installed.lock.pending-XXXXXX`、写 owner、再一次 `renameSync` 发布」，所以线上只可能留下「已经发布、owner 能读、持有者刚被信号杀掉」的锁。新用例让子进程用跟生产一样的发布顺序拿到真锁（pending 目录 → `owner.json` 用 `wx` 写 → 一次 rename），然后停在临界区里被 `SIGKILL`（唯一退出路径，不跑任何清理代码）；父进程先确认锁已发布、`owner.json` 里的 pid 就是被杀的子进程、而且这个 pid 已被操作系统回收（`waitUntilGone` 轮询 `process.kill(pid, 0)` 直到 `ESRCH`），再跑真的 `install`，断言回收成功后清单登记了新 skill、managed root 里除了 `installed.json` 和这个 skill 之外**一点残留都没有**（没有锁、pending 目录、隔离目录或 staging 目录）。验收的意思：把 `probeLockOwner` 改成永远返回 `"alive"` 时这个用例必须失败——它测的是回收，不是「install 恰好成功了」。这个改坏代码的试验真跑过（本地 `node --import tsx --test test/skill.test.ts`）：改坏后新用例报 `ans skill: another skill operation is running in this scope (pid <holder> on <host>): …/.installed.lock` 失败（`1 !== 0`，`skill.test.ts` 的 `installed.code` 断言），同文件 `not ok 37`；改回来之后 53/53 全部通过，改坏的提交从没进过分支。两个 CI 平台（ubuntu + windows）都跑，Windows 上顺带覆盖「目录 rename 发布 + SIGKILL 后回收」。这个用例跟已有的 4 进程竞态用例不共用锁目录，互不影响运行时间。子进程的身份字段按 `pidIdentity()` 的 **全有或全无** 语义读：Linux 上把 `boot_id` 和 PID namespace 放在同一个 `try` 里，任一读取失败就两个字段都不写、继续发布锁（评论返修，PR #151 的 CodeRabbit Minor）——否则一次偶发的 `/proc` 读取失败会让子进程在发布前退出，用例红在环境上而不是被测行为上。

## Unreleased — #146: 启动对账只删安装器真会生成的名字（精确匹配）

### Changed

- **对账判断从前缀匹配改成精确形态**（`apps/cli/src/skill-store.ts`）：新增四个模式——`STAGING_ENTRY`（`.install-` + 6 位 `[A-Za-z0-9]`）、`LOCK_PENDING_ENTRY`（`.installed.lock.pending-` + 6 位）、`MANIFEST_TEMP_ENTRY`（`.installed-<小写 uuid v4>.tmp`）、`QUARANTINE_ENTRY`（`.installed.lock.reclaim-<小写 uuid v4>`；两个 uuid 模式也锁定 `randomUUID()` 一定会产出的版本位 `4` 和 RFC 4122 的 variant 位 `[89ab]`，别的 UUID 版本不是安装器能写出来的名字），`isInstallerResidue` / `isEmptyManagedRoot` / `hasStaleLockOrResidue` / `reconcileManagedRoot` 共用这套判断。以前 `.installed-notes.tmp`、`.install-archive/`、`.installed.lock.pending-notalock` 这种操作者自己的内容会被判成残留：一是 `list` / `install` 拿着锁直接 `rm -rf`，二是 `isEmptyManagedRoot` 把它当成「没什么东西」的记账，于是在有用户内容的目录里 bootstrap 出 `installed.json`——检查和删除共用同一个过宽的前缀，错误自己确认自己。现在这类条目一律算内容，scope 继续按「拿不准就拒绝」处理、不删任何东西。判断依据是**名字的形态，不是归谁所有**：恰好长成生成形态的操作者名字（比如 `.install-backup`，`.install-` 后面正好 6 位字母数字）仍然跟安装器残留分不出来，会被当残留处理；README 已经写明这条边界。旧命名形态的残留变成**漏删**：留在原处不删（漏删能恢复，误删不能恢复）。

### Added

- **`apps/cli/test/skill.test.ts`**：新增「操作者自建的相似名字不被当成残留」用例（`install` 失败于 `skill manifest is missing in a non-empty managed directory`，三个条目全部保留、不生成 `installed.json`；`list` / `validate` 同样按「拿不准就拒绝」处理且只读），以及「安装器真会生成的条目名能匹配精确模式」的反向用例（32 次 `mkdtempSync` 的 6 位后缀在 ubuntu + windows 上断言落在 `[A-Za-z0-9]`，`randomUUID()` 的临时清单和隔离目录名能匹配，而相近的操作者名字匹配不上——含非 v4 版本位、非 RFC 4122 variant 位的 uuid）。原有对账用例只把构造用的名字改成真实形态（`.install-ab12cd`、`.installed-<uuid>.tmp`、`.installed.lock.pending-dead01`），断言没改。

### Documented

- README / README.zh-CN 的对账章节改成按精确形态讲残留，并写明两条边界：像残留的名字属于操作者内容、永远不删；恰好符合生成形态的名字仍按残留处理。同时更正 pending 锁的说明——owner 还活着或读不到时原样保留、不急着动，只有回收隔离目录在没法证明已死时才让运行失败。

## Unreleased — #145: 把 rename 重试挪进独立的 `fs-atomic` 模块，平台判断改成显式接口（#137 收尾）

### Changed

- **rename 重试模块化，平台判断改成显式接口**：新增 `apps/cli/src/fs-atomic.ts`，收拢 #137 的重试策略（10ms→1s 指数退避、大约 60s 预算、用完了抛原始错误）和平台判断——`RenameSeam.platform` 明着写 `"win32"` 时重试 `EPERM`/`EBUSY`/`ENOTEMPTY`，其他平台只重试 `EBUSY`，取代 #137 里靠对象身份猜 `DEFAULT_RENAME_IO` 的做法（那个猜法一旦接口形状变了，POSIX 语义会悄悄退化而且测试全部通过）。`skill-store.ts` 删掉内联常量 / `RenameIO` / 重试循环，改成 re-export（`renameWithRetry` / `renameSeam` / `setRenameSeam`；`skillRenameIO` 保留为 deprecated 别名），rename 调用点和生产行为零变化。`sleepSync` 移到 `fs-atomic` 导出，`skill-store` 的锁重取节奏（#137）继续用它。

### Added

- **`apps/cli/test/fs-atomic.test.ts`**：win32 三个错误码依次注入（第 4 次成功，等待 `[10, 20, 40]`）；预算用完抛同一个 error 对象且假时钟累计 ≤ 60s；`ENOENT` 和没有 `code` 的错误第一次就抛、从不 sleep；POSIX 门（`EBUSY` 重试、`EPERM`/`ENOTEMPTY` 立即抛，以前这条语义一个测试都没有）；`setRenameSeam` 嵌套 restore 回到上一层而不是默认；默认接口完成一次真实的 rename。原有 `skill.test.ts` 的 rename 用例改成显式声明 `platform: "win32"`（含依赖 `EPERM` 重试的 uninstall 备份用例），断言没改。

## Unreleased — #137: `ans skill` 安装器处理并发（回收旧锁 / Windows rename 重试 / 启动时对账）

### Added

- **同 host + PID namespace 的旧锁自动回收**：锁记录 `{token, pid, host, bootId, namespace}`（boot/namespace 只有 Linux 暴露，拿不到时就只按 host 判断）；`ESRCH` 只有在 host 和 PID namespace 都一致时才判定为已死，上一个 boot 留下的锁直接算已死，跨 host / 跨 namespace / owner 读不到一律按「拿不准就拒绝」处理。回收时用一个唯一的隔离 rename 做选举，移走后复核 owner token；可能还活着的隔离目录只报告、不删除。
- **启动时对账**：`install` / `list` / `validate` 在拿着锁、又没有 `installed.json` 时清理 `.install-*`、`.installed-*.tmp`、已经死掉的 `.installed.lock.reclaim-*` 和 `.installed.lock.pending-*`；`.uninstall-*` 备份、没登记过的 `<name>/` 和未知条目永远不自动删，`list` 对没登记的内容继续按「拿不准就拒绝」处理。
- **拒绝带本地 Git content-filter 的源**：`git status` 会执行仓库本地或 worktree 配置里定义的 `filter.<name>.clean`/`process`（即使 `core.fsmonitor=false`），安装器在跑 `status` 前先检查这两类配置，遇到就拒绝这种源；检查 dirty 用 `--ignore-submodules=all`，不进子模块，也不会执行子模块配置的 filter。

### Changed

- **旧锁回收串行化**：回收的人先拿到独占 guard（带 owner 记录、死 guard 也能回收），拿着 guard 复核 owner token 之后才移动锁，免得把刚发布的活动锁移走、把互斥搞坏。
- **关键 rename 有上限地重试**：发布清单、payload→target、target→backup 碰到 Windows 的瞬时 `EPERM`/`EBUSY`/`ENOTEMPTY`，按 10ms→1s 指数退避重试，上限大约 60s，用完保留原始错误；其他平台只把 `EBUSY` 当瞬时错误。锁连 owner 记录一起一次性 rename 发布，发布失败直接当成争用、马上失败，不占用重试预算。

### Documented

- README / README.zh-CN / GLOSSARY 同步恢复说明、PID namespace 判断和「安装 ≠ 激活」。

## Unreleased — #104: 接入企业数据的接口（RagAdapterPort）+ fts 最小实现（#35 做完，决策 #90）

### Added

- **kernel 的接口层新增 `RagAdapterPort`**（`packages/kernel/src/ports.ts`）：`retrieve(query, limit) → { block, label, hitCount } | null`，`label` 复用内容信任那边的 `SourceTraceLabel`，注入出来的内容自带来源标记，不是一段没头没尾的文字。
- **`rag.adapter` 三态注册表**（`packages/kernel/src/rag-adapter.ts`，`RagAdapterRegistry`）：`none` = 不注入；`note` = 保留 `config.note` 的老注入方式（旧版假 adapter，逐字节不变）；`fts` = 最小真实现，包住已有的 `SessionStore.searchMemory`（严格的 FTS5 阶梯 + 放宽的阶梯 + 已有的其他查找），不新建索引、不依赖 embedding。解析结果按 domain 对象身份缓存，TOML 热重载后下一轮就按新 id 生效。
- **`fts` 注入块带来源标记头**：`[RAG Context] (adapter=fts, provenance=memory, hits=N, traceId=rag:fts:N)`，每条命中有角色标签（`- [assistant] …`）；命中的文字在注入边界过 `sanitizeText`（去掉零宽字符和双向覆盖符）并压平换行，防止伪造块结构；单条上限 600 字符、整块上限 4000 字符，避免一条超长行把其他命中挤掉。
- **用户文档 `docs/rag-adapters.md`**：`[rag] adapter` 三态配置（含「`rag.adapter` 必填、派生域沿继承链继承、缺省 ≠ `none`」和「`none` 不会压掉非空的 `config.note`」两条容易踩的点）、`fts` 注入块的形状和来源标记、四个预算常量、消息形状要注意的地方（pi 会把 prompt 规范化成 content block）、出故障就放行的矩阵和验证方法；README 的 Domains / Known limitations / For contributors 三处接上。新代码的公开接口补齐 JSDoc（`RagAdapterPort` / `RagAdapterRegistry` / `createNoteRagAdapter` / `createFtsRagAdapter` / `readMessageText` / `appendMessageText` / `prependMessageText`）。
- **`#104` 验收测试** `packages/kernel/test/rag-adapter.test.ts`：fts 注入 + 来源标记（AC1）、`none` / 旧版 `note` 逐字节回归（AC2）、未知 adapter 出故障就放行 + 带名字的 stderr（AC3），另外覆盖没有 store / 检索抛错 / 没有命中 / 空查询 / 缓存和热重载 / Stage-1 注入点 / 不叠乘 / 出厂域全量审计。

### Documented

- **`fts` 管的范围 = 跨会话共享的调研资料库（不是当前会话）**：`SessionStore.searchMemory` 查 `retrieval_results_fts`，不带 session 过滤（既有 `recall_memory` 的语义），本票只在它上面包了一层、没改范围；按会话过滤的是 `searchFts5(sessionId, …)`。已经在 `docs/rag-adapters.md` 单独写了「范围」一节，并点明「多个域共用同一个 DB 时开 `fts` 等于放宽域间的信息边界」的后果。要做到「只看当前会话」，得给 `RagAdapterPort` 传 sessionId，再给 store 加一个带会话过滤的调研资料库查询——这是另一个决定，不在本票改。

### Fixed

- **Stage-1 注入在真实运行时从来没命中过（#104 自查 + CI 发现）**：pi-agent-core 0.84.2 会把 `agent.prompt("…")` 规范化成 content block 数组（`content: [{type:"text",text}]`），而注入代码只认 `typeof content === "string"`——RAG 内容注入在真机上落空，旧的 `note` 路径更会在有 note 时把用户消息整个改写成 RAG 文本（数据丢失）。新增 `packages/kernel/src/message-text.ts`（`readMessageText` / `appendMessageText` / `prependMessageText`）：两种形状都支持，block 形状原地追加到文本块、非文本块原样保留，没有文本通道时主动放弃注入。Stage-1 和 T0 偏好注入同时改用这个 helper；回归见 `packages/kernel/test/message-text.test.ts` 和 `rag-adapter.test.ts` 的 content-block 用例，端到端断言不再假设消息形状。

### Changed

- **RAG 内容注入的位置改成按 adapter 分派**：注入的位置没变（`MemoryPipeline.inject` 的 Stage-1、第一条 user 消息）。`fts` 的检索 query 取第一条 user 消息的原文（截到 400 字符，适配严格的 FTS5 阶梯）。**兼容保留**：`adapter = "none"` 但还留着 `config.note` 的域，仍按 #104 之前的条件（`adapter && config.note`，`"none"` 是真值）注入那条 note——AC2 要求 `none` 的行为逐字节不变，所以不做「adapter 是唯一开关」的收紧（CodeRabbit PR #123 的 Linked Issues 检查指出这个冲突后改的）。
- **`query_knowledge` 的边界照实记录**：这个 MCP 工具还是占位（得先定「知识查询读哪个记忆范围」），已经写进 `docs/limitations.md`；GLOSSARY 的「领域检索适配器」条目从「只是占位、没实现」更新成三种取值的定义，并加了一条 RAG 内容注入的说明。

## Unreleased — #100: MCP SDK v2 多包仓库收尾（server 2.4.x + zod ≥4.2 + 两条传输通道/新旧两代协议验收）

### Changed

- **apps/mcp 迁到 `@modelcontextprotocol/server` 2.4.x**：`@modelcontextprotocol/server` ^2.0.0 → ^2.4.0、`@modelcontextprotocol/node` ^2.0.0 → ^2.1.2（node 2.1.2 强制要求 server ^2.4.0，所以同一批升；core 跟着到 2.4.0）。TypeBox 输入 schema 仍然经官方 `fromJsonSchema()` 直接交给 `registerTool`（没有用 zod 再写一遍，#39）；stdio + Streamable HTTP 两条通道和新旧两代协议的兼容行为都没变——旧版握手逐版本回声、`2026-07-28` 的声明优雅降级到 `2025-11-25`，宿主客户端看不到变化。HTTP 仍然是每请求一个 `buildServer()` 工厂（满足 server 2.3.0 #2918 的单连接约束）。
- **zod 锁到 ≥4.2（删掉 4.0–4.1 的 fallback 分支，#46）**：`pnpm-workspace.yaml` 的 override 从 `zod: ">=3.25.28"` 改成 `">=4.2.0"`（整棵依赖树仍然只解析到 4.4.3）。SDK v2 协议 schema 自己转出来的描述保留，tools/list 的输入 schema 不再比 zod 4.2+ 差。

### Added

- **#100 验收测试**（assert 风格，经 tsx 跑，不用构建）：`apps/mcp/test/sdk-v2-schema.test.ts` —— tools/list 5 个工具的 type 描述完整回环等于 kernel 的 JSON schema、`~standard` 的 vendor 是 "mcp"（不是 zod）、#94 的实证；`apps/mcp/test/dual-era.test.ts` —— 旧版 5 个版本 + `2026-07-28` 的降级协商、stdio + 无状态 Streamable HTTP 上全 5 个工具的 tools/call 冒烟、AJV 入参校验（空 query / 额外属性被拒）。
- **#94 里点名但没证实的地方，现在证实了**：裸 TypeBox TSchema（`@sinclair/typebox` 0.34.52 和 `typebox` 1.4.3）都**不**带 `~standard`，不满足 StandardSchemaWithJSON —— 必须经 `fromJsonSchema()`（vendor "mcp"、`~standard.jsonSchema.input()` 原样返回、AJV 校验）。结论固化在 sdk-v2-schema.test.ts 里，并回写到 #39/#46。
- **`scripts/mcp-smoke.mjs` + CI 冒烟扩到两条通道**：对构建产物 `dist/index.cjs` 跑 stdio + 无状态 Streamable HTTP 的全 5 工具 tools/list 冒烟（descriptions + 新旧协议协商），替换原来只查一个工具的 grep 握手；只跑 tools/list，不需要 provider/LLM 的 key。

## 0.1.2 — 2026-10-22（修补：ans_chat 不检索、搜索太多自动停、限流分类错误）

### Fixed

- **ans_chat 从来不做检索**：三个自带域（default/docs/research）的 `hooks.toolWhitelist` 只列了宿主那边的工具名（`ctx_*`），把内核自带的 `search` 工具过滤掉了，ans_chat 的 agent 循环一个工具都没有——模型要么凭参数记忆作答，要么把工具调用当正文输出。三个域的白名单补上 `"search"`；白名单仍然是安全过滤器。回归：`packages/kernel/test/agent-tool-filter.test.ts`。
- **搜索循环没有预算之外的停止条件（r18 seal-0）**：新增 `SearchSaturation`——连续 2 次搜索没有新 URL，或者累计 12 次搜索之后，挡住后面的 `search`，要求模型用已经拿到的证据作答。回归：`packages/kernel/test/search-saturation.test.ts`（修之前 30 次，修之后 ≤3 次）。
- **限流提示被误判成 permanent-auth（r18 STOP-20）**：正文里的限流/额度提示（没有开户标记）改成抛 `rate limited` 并归到 `transient`；开户提示仍然是 `permanent-auth`。回归：`packages/retriever/test/anysearch.test.ts` case 17、`provider-error-class.test.ts`。

### Changed

- 全包版本 0.1.1 → 0.1.2（9 个 package.json + plugin.json + ship-gate 的发布锁定版本 + 两处 clientInfo，同一个 commit）。

## 0.1.1 — 2026-10-15（修补：放宽记忆召回的阶梯）

### Fixed

- **用日常说话的方式提问，recall 取不回已经存下的证据**：`recall_memory` 查内部记忆和项目索引两层时都只走严格的 FTS5 阶梯（全部词 AND + 整句），宿主日常提问几乎不可能在一行里凑齐所有词，库里的证据就取不回来。现在严格阶梯不够 `limit` 时补一层放宽的阶梯（实词 OR + 前缀、还是按同一个 BM25/新鲜度排序，严格命中的仍然排前面）；覆盖 `searchMemory` / `searchMemoryMultiQuery` / `ProjectIndexStore.search` 三条路径。回归：`packages/store/test/fts5-relaxed-recall.test.ts`、`apps/plugin/test/project-index-relaxed.test.ts`。

### Changed

- 全包版本 0.1.0 → 0.1.1（9 个 package.json + plugin.json + ship-gate 的发布锁定版本 + provider clientInfo，同一个 commit）。这个版本同时带上下面那些 Unreleased（~0101）条目。

## Unreleased — r100: 给这套检查工具自己加上限（三种条件同时满足 + 区分修旧层还是建新层 + 待办登记 + tau 递归/AST 前置检查 + deferred 什么时候触发）

> ⚠️ 这一节写的检查工具（检查项 schema v2、待办条目/`pending_anchors`、STACK_RED_CODES、`enumerateScriptFiles`/AST 前置检查、handoff-reanchor 等）已经被治理那边的 commit `3f85fee8`（"governance court: retire meta-validation machinery, untrack .scratch"）整套删掉——`docs/enforcement-anchors.json` 已经不在了。这一节只当历史记录留着：事实没改，只把解释文字换成了大白话。/ ⚠️ The checks described below were removed wholesale by the governance-court commit `3f85fee8` ("governance court: retire meta-validation machinery, untrack .scratch") — `docs/enforcement-anchors.json` no longer exists. The section is kept as history: the facts are unchanged; only the explanation text was put into plain language.

### Added

- **检查项 schema v2（T2-A）**：`docs/enforcement-anchors.json` 升到 v2——`failure_classes` 是一个封闭的故障类词表，每一项检查必须写非空的 `fails`，而且只能是词表里的值（意思是这条检查必须点名它防的是哪一类用户能碰到的产品故障，不准自己随便写）+ `tier:"red"|"info"`（审计级别，保证每条都有观察）；新增三个判为失败项 `anchor-fails-empty` / `anchor-fails-unregistered` / `anchor-tier-invalid`。
- **待办条目要有结构、有期限、写明谁在挡着（T2-A）**：`pending_anchors` 既接受 `{anchor,reason,seated_at,review_by}` 这种结构化条目，也接受旧的裸字符串；裸字符串迁移那天设了期限 `LEGACY_SEAT_REVIEW_BY`（老条目到期不豁免）；新增三个判为失败项 `anchor-seat-expired` / `anchor-seat-malformed` / `anchor-seat-info-conflict`（pending_anchors 和 info 不能同时有）；还有待办没关时，没拦住的那条要出一行 `masking-surfaced` info，点名是哪个待办挡住了哪条检查项。
- **`stack-orphaned-by-land` 判断（T2-B）**：STACK_RED_CODES 的第四个成员——收尾已经进了 `origin/main`、又带着还没关掉的链、但栈 ref 不在了 → 判为失败（专门抓 land 之后解散的栈留下的、已经没用的分支链：R99 的 `sha-not-commit` 漏检类）；用 `git ls-tree origin/main` 采「文档在不在 main 上」的事实，采不到就记 env-PENDING、不猜；3 组成对夹具（红 / 还在飞就拒绝 / 还在推就拒绝）。
- **tau 递归 + AST 前置检查（T2-B）**：`enumerateScriptFiles` 扩成 `scripts/**/*.mjs` 递归（把 `scripts/tau/` 也纳进来）；`scripts/top-level-effects.mjs` 做纯静态三分类（TypeScript API 经 packages/store 的 createRequire 拿，零新依赖、零顶层副作用）——①带 codes 又有副作用 → `ast-top-level-effect` 拒绝注入，判为失败 / ②`*_CODES` 不是字面量初始化 → `ast-codes-unverifiable` / ③有副作用又没有 codes → 具名排除候选，出 info；`EXCLUDED_PATHS` 是封闭的具名排除清单，第一条 `tau/tau-scan.mjs`（spawn 启动器没法做命名空间注入），排除路径带着 codes → `ast-excluded-codes`。
- **land 之后两个必须绑定做的事（T2-C）**：audit-checklist §5 加第二个勾——land 的同一个会话里，land 后重验（向 main push 跑三次都通过、落进代码树的 ship-gate 再跑）并让收尾把重新登记那一行写在固定位置 `scripts/handoff-reanchor.mjs` 里；检查项活性记一行账 `kind:"anchor-activity"` claim 类别（一半靠机器检查：expect 记录重新导出收尾行逐字比对，夹具 kill 不入账）。

### Fixed

- **R99 发布检查修好（T0）**：`.scratch/grill-round-99/handoffs/round-99-closeout.md` 的 Stack 行六个死 SHA 改成 `Stack（dissolved @ 2026-10-06）`（capture 留散文史料 + re-anchor 注记）——main tip `992412d6` 从失败变成通过 `8d1854e2`，`r100-green-repair` 独立栈 ff-land（ref 随 land 注销），同一个会话里重新登记的 commit 存档；候选 CI 两次都通过 + 落进代码树后跑三次（ci/ship-gate/native-smoke）都通过 + 本地 ship-gate 九步重新通过实测。

### Docs

- **定规矩（T1）**：五条 Decision——D2 上限条件三交集（fails+sunset+fraud-vs-style）/ D3 修层新层判断标准 / D5 待办 Addendum / D6 tau 递归+AST 前置检查 / D7 负向边界+deferred 触发器；Consequences 带着这套尺子第一次用的先例（R99 收尾里六个死 SHA = 已经没用的分支链）和 T0 引用；CONTEXT「Grill Round 100 — Terms」七个词条；ADR 索引重新生成到 101 件。
- **deferred-r72 触发器注记（T3）**：`defer-r72-dsh-approval-channel` 的 carried_log 里记上 R100 留下的后续欠账——「R101+ 带 deferred 前置依赖的正题，开工前先评估触发条件」（任务书 D-003④ 兑现，这条的 trigger 已经满足，列进 R101 立项评估候选）。
- **AGENTS.md 扫描范围摘要刷新（T3）**：递归范围 + AST 前置检查 + schema v2 + 待办限期四件改成只留指针，指向别处。

## Unreleased — r99: 词表检查扩到整个 scripts/（逐模块注册表 + glob 顶层枚举 + 逐模块故意改坏验证）

### Added

- **vocab-registry 逐模块注册表（T2）**：`scripts/vocab-registry.mjs` 是纯数据叶子（零 import、`Object.freeze`）——`CODE_GROUPS = {verdict, anchors, evalIntegrity}` 按模块分组，值是该模块受管的 `*_CODES` 导出名；`GOVERNED_MODULES` 是显式的模块→组映射（是数据，不是约定）。注册表不依赖判定核心，受管模块也不会反过来 import 它（单向依赖，没有循环）。
- **vocab-scan 薄壳枚举（T2）**：`scripts/vocab-scan.mjs`——glob `scripts/*.mjs` 的顶层（不递归，`tau/` 不在范围内）分两相枚举：先静态预筛 `*_CODES` 导出名 → 只对带词表的模块做命名空间注入 → 再由纯核心逐模块断言；封闭的排除清单（`.ts`/`.py`，理由是没法做命名空间注入）漂出就记 info，不判为失败。
- **三个扫描面外的导出补登记（T2）**：`ANCHOR_RED_CODES`/`ANCHOR_SKIP_CODES`（enforcement-anchors）和 `SHIP_OVERRIDE_REASON_CODES`（eval-integrity-contract）登记进册——Known-Risk 1 的开放面缺口关掉。
- **探针没有孤儿 + 三处对抗演练（T2 验收段）**：e2e 新增「探针模块导出没有孤儿」的反向断言 + 四处故意改坏（探针名伪造 / 待办伪造开 / 待办关了又红 / 空注册表）逐条验证。

### Changed

- **`unregisteredCodeExports(ns)` → `(ns, registry)`（T2/D5）**：签名泛化成由外部注入注册表（`registry ?? 默认表`，向后兼容），跟 `env.registry ?? STATE_PREDICATE_REGISTRY` 的注入方式同构；`isKnownCode(code, vocabularies)` 也按同一族泛化。
- **anchor:vocab-guards 扩范围（T2/D1）**：约束/对象从单模块 `CODE_GROUPS` 改成整个 `scripts/` 顶层逐模块注册的语义；探针从单命名空间改成逐模块注入（3 个受管模块改坏都会被抓住）。

### Docs

- **定规矩（T1）**：六条 Decision + 两块预写（第一次抓到真红怎么读的纪律 / 四级迁移阶梯的次序硬约束）+ CONTEXT「Grill Round 99 — Terms」七个词条。
- **待办关票（T0/T3）**：`defer-r98-anchor-ratchet-recount-seat` 关闭（零代码改动，探针升成全量 kill）；`defer-r98-anchor-open-surface-demo` 随扩范围关闭。
- **AGENTS.md 顶层零副作用摘要**：只指向，不复述全文。

### Fixed

- **审计 R99 返工（A1~A3）**：① `probeVocabGuards` 的枚举面改成用生产扫描 `scanVocabGuards(...).scanned` 的词表模块（同源约定补正，抽样的死角关掉）；② `enumerateScriptFiles` 从吞异常返空改成抛异常 + `scan-surface-unreadable` 致命 finding（按「拿不准就拒绝」补正，枚举不了的面不再假装是绿的）；③ ship-gate step 3 和根 `package.json` 的 test 任务加 `--concurrency=2`（跨进程 SQLite 竞争 + spawn 密集套件在 Windows 负载主机上让资源上限稳定下来，被测内容不变）。

## Unreleased — r98: 第五种做法【装饰性机器约束检测】+ R97 审计返工（R1~R8/R10）

### Added

- **enforcement-anchors 自检项（T3）**：ship-gate 新增跟 handoff-lint 平级的 `enforcement-anchors` 检查项（`scripts/enforcement-anchors.mjs`）——读 `docs/enforcement-anchors.json` 的封闭的检查项注册表，逐条跑故意改坏的探针，判断能不能拦住；`anchor-unresolvable`（没有夹具不准进表）/ `anchor-not-consumed`（拦不住就判为失败）两个自指钉子按「拿不准就拒绝」处理；注册表文件读不了就判为失败。
- **五个证伪探针（T3）**：`scripts/enforcement-anchor-probes.mjs`——`anchor:predicate-registry` / `anchor:reuse-pointer` / `anchor:bare-word-single-source` / `anchor:vocab-guards` / `anchor:ratchet-recount`；探针通过模块导出自己解析自己，名字和实际对不上就到不了稳态。
- **注册表参数化（T3/R1 配套）**：判定核心 `env.registry ?? STATE_PREDICATE_REGISTRY`——「唯一引用即自己声明」在签名层面不再可能（S-5 根治），缺省值是生产表路径，顺便当隐式夹具。
- **解散栈的声明语法（T1）**：Stack 行 land 之后的变体——ref 不在了就判为通过、ref 复活就是 `declaration-fact-conflict`、ref 在但为空 = 不是解散栈；模板语法家同轮登记；3 个夹具（已验证 / 矛盾 / 没采集）。
- **清理义务的机器检查（T1/R6）**：`assessClearingLeg`——「栈空 ∨ deferred 在册」这条收尾时的清理义务第一次由机器兑现；`clearing:` 注解面 + `clearingRed`/`clearingEnv` 两个新治理组。
- **claims-verbatim 抽取（T1/R5 配套）**：`scripts/claims-verbatim.mjs`——把逐字 claim 检查做成可注入的模块；`reauthored` 和 `reanchor_log` 的 recount 比对后放到面上（P-6「让重复批准的次数看得见」兑现）。
- **deferred registry 的 `pending_predicates` / `pending_anchors` 字段（T1/R7）**：第二种情况的 PENDING 位和检查项的 PENDING 待办统一挂点——marker 点名 seat 判断条件 → surfaced PENDING 不算词表外判为失败；待办检查项照跑探针但 skip 不 fail，关票就自动升级。
- **E2E/结果对照表扩网（T1/R2）**：没采集的分支单独记 env-PENDING、清理三态、deferred-PENDING 位、词表双向锁、检测器自己四种失效（解析不了 / 拦不住 / 待办 / 注册表读不了）；结果对照表 357→444 / E2E 270→360，断言只加不减。

### Fixed

- **S-1 「没采集」不等于「没有」，方向反了（R1）**：分支事实没采集到（git/but 不可用）从静默判为通过改成显式的 env-PENDING——「出故障就放行」的方向根除，没看到的观察不再折叠成空事实。
- **P-7 误降级方向收窄（R8）**：`parseButStatusIds` 里以符号开头的 detail 行不再整体降级成 `butOk=false`——detail 行改成逐行丢弃，Stack 元素只在 but 真的不可用时才 env-PENDING。
- **P-9 reuse 指针消费（R4）**：`resolveReuse` 把注册表里的 `reuse` 字符串解析成薄壳导出函数的实参——解析不了的 spec 就是源降级，`no-branch-runs` 的 env 源按名字接线，不硬编码。
- **P-8 裸词单源化（R3）**：`STATE_BARE_RES` 从 `STATE_PREDICATES` 派生——删掉判断条件就会漏报（双源实锤面消除），扩表漏改也不可能再漏扫。
- **P-5 CHANGELOG 分行（R10）**：这一节和 R97 节按 feat/fix/docs(errata) 分行——errata 从 Fixed 条里拆出来，放进 Docs 类。
- **P-2 清理义务补码（R6）**：见 Added 里的清理检查项（降格方案放弃，防止 D-002 的记录连锁改写）。
- **审计 LOOP1 返修（F-1/F-2+N1~N5/C7）**：检查项从顶层裸块收成 `stepEnforcementAnchors()`（`step_1_6_enforcement_anchors` 自己标 reportStep——report.json 证据 + `--override` usage-error 顺序回归）；空表/畸形检查项表 `anchor-registry-empty` 按「拿不准就拒绝」处理（non-vacuous 先例）；前检把注册表自己排除掉（subject 自证结构性死亡修复）；`unregisteredCodeExports` 升成生产守卫单源（探针+结果对照表两边消费，杀掉 PROBE_TABLE 装饰双源）；解散栈检查项补 `branchRefs` 交叉校验（ref 在场 + 成员缺席 = conflict 不是 GREEN）；`state-bare-word-in-code-exempt` 夹具的元数据更正；`### Deferred` 子节补上；N6 收尾——`ANCHOR_RED_CODES`/`ANCHOR_SKIP_CODES` 的发射端引用消费（码 token 全部来自常量表）+ e2e「每条 RED 行都带注册码」断言（R-1 零消费消除）。

### Docs

- **定规矩**：第五种做法——行为消费验证为主 + 静态前置检查永远不能单独判为失败 / 封闭的检查项注册表 schema + 两个自指钉子 / 参数化注入 / 只减不增的检查类 PENDING 待办 / 两处判为失败的设计意图写进 Consequences / 开放面写进 Known-Risk。
- **CONTEXT `Grill Round 98 — Terms` 九个词条**：第五种做法 / 检查项 / 证伪探针 / kill-no-kill / 不可杀变异体 / 检查项待办条目 / 注册表参数化 / anchor-not-consumed / 解散栈声明。
- **handoff-template 同步**：解散栈语法家 + state-PENDING/clearing-RED/clearing-env 词表行——模板跟 CODE_GROUPS 双向等集。
- **deferred 新增三张票**：`defer-r98-anchor-ratchet-recount-seat`（只减不增的检查类待办）+ `defer-r98-anchor-open-surface-demo`（开放面扩展示范）+ `defer-r98-stack-land-authorization`（残留分支的清理待办）。

### Deferred

- `defer-r98-anchor-ratchet-recount-seat`：`anchor:ratchet-recount` 的 PENDING 待办，关票就升成全量 kill 判定。
- `defer-r98-anchor-open-surface-demo`：开放面检测的第一张扩展示范（新检查项必须带证伪夹具才能进表）。
- `defer-r98-stack-land-authorization`：`r98-anchor-detector` 的残留分支等 push/land 授权（clearing 检查项的 covers 挂接）。

## Unreleased — r97: 自己给自己写「失效声明」也能机器检查【统一定规矩 + 第一/三种情况实现 + 第二种情况先定规矩】

### Added

- **第一种情况的状态检查（T2）**：解析单行 `state:` 标记 + 扫描裸词违例 + 用 `unpushed`/`unlanded`/`no-branch-runs` 三个离线判断 + 接进判定；封闭的注册表常量 + 10 个成对夹具；结果对照表 310→357 / E2E 207→270（复现：`node packages/store/test/handoff-lint-verdict.test.mjs` / `node packages/store/test/handoff-lint-e2e.test.mjs`）；检查器不把自己当靶子 + 报告和检查各跑各的速度。
- **第三种情况的逐字检查项（T3）**：claims schema 新增 `verbatim` kind（整句逐字节）+ 重新登记仪式（理由 + 审计 + 重批计数）+ R97 第一批自己用的检查项。
- **模板状态声明位（T5）**：handoff-template 的标记语法节 + 第二种情况的内容规则全文（实测值定义 / marker 示例 / PENDING 位挂接和只减不增的检查排程引用）。

### Fixed

- **N5 检查项覆盖缺口（T4）**：`parseButStatusIds` 的标记类放宽成单个非空白非制表符号 + 未知形状整体降级（but 视为不可用 / env-PENDING）+ E2E 冻结样本三个 glyph 全集。

### Docs

- **Known-Risk 1 errata 原条目注记（T4）**：N5 修复对应的 errata 注记从 Fixed 条里拆出来（按 R98 R10/P-5 的分行规矩回填）。

### Deferred

- 第二种情况的排程任务：把只减不增的检查从建议升级成会判失败的判定；扩展示范任务（`no-pr`/`unpublished`）见 `docs/deferred-registry.json`（R97 T6 登记）。

## Unreleased — r96: 交接检查假通过收尾【出口分三种状态】（模板和检查的 PENDING 说法冲突 + 祖先性冒充/静默折叠 + CI 拓扑不可满足三个缺陷一起关掉）

### Changed

- **ship-gate 的 handoff-lint 检查项改成薄壳（T2）**：判定从「必填 URL 在不在 + 活体祖先性」重构成三种状态的受控判定；检查项里只做「采环境快照 → 调判定核心 → 报出口」三步，判断分支全部搬出去。祖先性冒充（`merge-base --is-ancestor`）、裸 `rev-parse HEAD` 拿等值当目标（GitButler workspace 合成 commit 自己指自己的悖论）、`gh` 不可用时静默 pass 这三处一起根除。
- **handoff-template 的三种状态语法同步（T3）**：run-URL 字段改成 `GREEN: <url>` / `PENDING: <code>` 这种显式状态行（散文或旁注里的 URL 不再满足字段）；Stack 行三要素约定、降级标注格式、生效范围边界（>=96 用新语法 / <96 用只查存在性的旧语法）同轮同一语法——模板和检查同源，F8-a 的根因消除。

### Added

- **判定核心纯模块 `scripts/handoff-lint-verdict.mjs`（T1）**：输入是交接件文本 + 注入的环境快照，输出是三种状态 + 理由码 + 标注；核心里不许用 `spawnSync` / `fs` / `Date.now()` / `process.env`，所以结果对照表可以在没有仓库、没有网络、没有时钟的情况下穷举。
- **薄壳 `scripts/handoff-lint-shell.mjs`（T2）**：采集（git/gh/but/workflow 触发器）→传递→出口三步；快照形状冻结，E2E 按同一个形状注入。
- **结果对照表单测 + E2E 冒烟 + 共用夹具（T1/T2）**：`packages/store/test/handoff-lint-verdict.test.mjs`（OPA 允许+拒绝成对 / Stack 三要素 8 格 / 词表外必须报错 / 空缺和超长边界）、`packages/store/test/handoff-lint-e2e.test.mjs`（同一套夹具走完整薄壳路径）、`packages/store/test/fixtures/handoff-lint/`；空文件必须失败的红线。
- **定规矩 + CONTEXT 词条区**：D1 三种状态语义 / D2 Stack 三要素分级 + 环境分级降级 / D3 回归锁形态 / D4 生效范围迁移边界 / D5 同轮跑通 / D6 收尾件三种状态预登记；Known-Risks 预写五项；CONTEXT `Grill Round 96 — Terms` 五个词条。

### Fixed

- **F8-a 模板和检查的 PENDING 说法冲突**：模板里诚实的 PENDING 写法跟检查要求的必填 URL 互相排斥（诚实的人永远红、不诚实的人永远绿）——三种状态语法 + PENDING 封闭词表 + 检查离线判断自己证明自己，跑通。
- **F8-b 活体检查静默折叠 + 祖先性冒充**：`gh` / 仓库不可用时不再静默 pass（改成 env-PENDING + 带名字的降级码）；「这一轮的 run」从祖先性升级成栈内成员性，main 基线的 run 不再满足主字段。
- **F8-c CI 拓扑不可满足**：特性分支 push 永远没有 run 这件事本身可以机器检查，现在由 `PENDING: pushed-no-branch-runs`（判断 = 没有 workflow 的 `on.push` 覆盖这个分支）接住，不再是解不开的死结。

### Deferred

- 无。F8 由同一轮跑通（`docs/deferred-registry.json` 的 F8 行 status=closed）。

## Unreleased — r95: 评测矩阵修订轮【语料解冻 + matrix@3 读数】（vert-f1105 原地退成退役标记 + 判分程序指纹滚动 + 匿名层最后一次读数只读一次，结论 INCONCLUSIVE-instrument-flag）

### Changed

- **语料修订（T1）**：`vert-f1105` 原地降成 `unmeasured-by-design`（退役标记理由码受控 `upstream-validator-vs-doc-mismatch` + prior 载荷留档 + 从 `golden.scopes` 除名），能测的条数 57→56，指纹 `7ac0a48e55cd7954`→`8da3e482b98f8cba`；语料 diff 只有这一格。机器检查载体：`TOMBSTONE_REASON_CODES` 常量 + `validateDocsGoldenEntry` 交叉规则 + kernel 作用域豁免 + store 负例（自由文本的理由码被拒）。
- **判分程序升到 matrix@3（T3）**：`EXPECTED_FP` 滚动 + `out.matrix` 指向 `grill-round-95/prereg-matrix@3`；G0–G4 检查顺序/β 后验/四字段/早停/单次终读逐字没变；selftest 夹具一处 n 漂移重调（indeterminate 先例 P=0.658）7/7 全部通过。
- **台账记账（T7）**：`defer-r86-anysearch-corpus-param-contract`→closed（字段集照 r87-f3 先例）；新 finding `finding-r95-upstream-validator-vs-doc-vocab-mismatch`（type:finding，owner anysearch-eval，evidence 带可机检验证信号 `evidence/verify-validator-vs-doc.ts`）；`r88-candidate-vertical-direction-redeliberation` 只追加 carried_log（条件③④的 verifier 工件快照路径），status=`formally-declined` 不动。

### Added

- **matrix@3 预注册（T2）**：在任何跑数记账之前先落（parent 时序自证含 T1 diff）；含新指纹、「读数=复活条件③④的输入证据，不是方向判定」条款、G1b 判断条件检查项（>30%→INCONCLUSIVE-instrument）、单次终读纪律、57→56 可比性边界（prereg §7）。
- **定规矩 + CONTEXT 词条区**：D1 语料退役标记形态 / D2 判分程序修订幅度 / D3 读数在法律上的角色 / D4 匿名层的执行裁量 / D5 三记账 / D6 收尾形态；Known-Risks 预写三项（可比性边界先于读数/退役标记词表/G1b 判断条件检查项）；CONTEXT `Grill Round 95 — Terms` 七个词条。
- **匿名层终读路（T4–T6）**：容量探针登记成测量、不是判分读数输入（执行级修正：board 速记端点值要补完整 MCP 路径 `/mcp`）；终读档（56 格×4 项=224 调用，351s）中途开始系统性 `permanent-auth`（匿名配额边界，122 项），兑现预注册的分支→单次终读 `INCONCLUSIVE/instrument-flag`（G1b：instrumentDown 30/40；探针读数当量化检查项）。

### Deferred

- **B 升级路径（用户这边）**：复活私有端点 `127.0.0.1:20128` 或给一个有效 key → 兑现后按声明的环境跑一次干净的全量（判断同 R86 T5：装置性失败=∅ + 覆盖≥70%）；agent 不替用户修环境、不代持凭证。
- **backlog 候选（不进本轮 diff）**：`fundamental×cn_code` 新格开票（同 id 换芯禁令→必须新 id，下一个语料轮）；全语料约定一致性体检（独立轮次）。

## Unreleased — r94: r88-candidate 垂域方向要不要砍的最后复核【复核轮】（五段议程 + B3 混合结论 reaffirm 自动生效 + formally-declined 生效 + 四项点名复活条件 + D6 检查证据效果复核确认）

### Changed

- **r88-candidate 最终判定（T4）**：经过五段复核审理（段 0 资格核验四要素全在、段 1 调档和实测登记为负序列、段 2 判断标准合法性先审并废止原来 |ΔarmHostHit|≳0.4 的重开门槛、段 3 B3 充分条件判断求值命中自动生效为 `reaffirm`），`docs/deferred-registry.json` 里 `r88-candidate-vertical-direction-redeliberation` 的状态改成 `formally-declined`，结束 5 轮以来的无限期 rolling 候审。确立四项点名复活条件（dsh stable 晋升、上游补参数词表、cn_code 约定补齐、新评测矩阵修订版读数），按可控性分类归档，以后由 owner `anysearch-eval` 重新开票。
- **D6 检查分级判定（T0/T7）**：本轮复核确认 `scripts/ship-gate.mjs` 在基线时就已经有阻断式合入检查的效果，本轮没有源码改动；`check` 和 `test` 保持只给建议、不阻断；把证据怎么算的规则讲清楚。同时如实记账：T0 预检因为 CHANGELOG 还在排期出现 exit 1，属于「还没写完的分节假红」，没有触发降级复议票的未申报偏差。

### Added

- **复核定规矩（T1）**：D1 议程五段式结构和程序出口（0 资格核验→1 证据陈述→2 判断标准先审→3 结论表决→4 最终判定，T0-F 复议轮降级出口）；D2 B3 混合结论的归属和 exploratory 区机制（充分条件命中就自动生效，没命中进暂存区由用户拍板，用户拍板够不着时的出路是 pending-user-verdict 记着待办）；D3 三种结果的判断条件加固和复活条件的可控性分类（可控检查项≥1→优先 reaffirm，可控检查项=0→retire，检查项计数取证时刻预标注冻结）；D4 快照/现场查询分级纪律和具名步骤（判断标准快照不重跑 delta，现在的约定要逐个现场查）；D5 复核即预通知和 carried_log 双动作时序（carried_log 追加先 commit 自证时序，ADR 固化随后 commit）；D6 副议题分级落实；D7 dsh 漂移条款和 Known-Non-Goals；D8 claims 冻结纪律；D9 结论词汇和最终状态预注册冻结。
- **复核取证和文书归档（T2/T3）**：五面卷宗存在 `.scratch/grill-round-94/evidence/t2/`；两边证词全文和检查项计数预标注冻结（可控检查项=2，点名 owner 可控检查项 2 个：条件 ③ 和 ④；广义含外部可机检条件 ① 是 3 个，都满足 $\ge 1$ 充分下界）存在 `evidence/t3a/`；终审结论文书和 `verdict.json` 自动归档在 `evidence/t3b/`。

### Deferred

- **defer-r93-deprecate-credential-scope**：T5 的 deprecate 探针确认 `npm whoami` 是 E401，分型 `credential-scope`，6 个版本的命令清单纯备准续挂（见 `.scratch/grill-round-94/evidence/t5-deprecate.md` §3），外发动作等有权限的用户亲手做（EOTP 不代跑）。
- **常驻待办续期**：`defer-r72-dsh-web-interactive-matrix`、`defer-f17` 等仍明确列在范围外候审。

## Unreleased — r93: L3 修复续轮【换模型跑三次】（冻结 Kimi-K2-Instruct-0905 + 中英文 README 行对齐 + readme-token 机器检查第一次跑）

### Changed

- **dsh L3 换模型跑三次（T2）**：冻结模型从 `Qwen/Qwen3-32B`（reasoning 形态会吃掉 `max_tokens` 预算，是 R92 的 F-bug 签名）换成 `moonshotai/Kimi-K2-Instruct-0905`（上游裸探针实测 `200 + finish_reason=tool_calls + ans_search_web` 载荷）。新建隔离 profile `r93-kimi`（不复用 `r92-smoke`——它的 patch 硬写 `Qwen/Qwen3-32B`，而且属于 R92 的证据工件，冻结的东西一点都不能碰），patch 层注入 `providers.featherless`（`contextWindow: 32768` 取托管目录的值）+ `agent-default-model` 覆盖。三次严格串行、N=3 全部通过：L3a `established`（dump-config 8/8 断言）、L3b `established-via-fallback`（宿主 stream 通道不暴露 tools 枚举载荷，3 次各 1 个 `ans_*` tool_call 侧证）、L3c-min `established`（`ans_search_web` 往返完成，result 是 8177B 的真实检索载荷 `totalResults:10`；收窄判断标准下没有未声明工具的幻觉）。结论 `branch_label=A` / `verdict=established-via-fallback`，换实验组 0 次。凭证泄漏探针双查（原文 + SHA-256 前缀）零命中。
- **中英文 README 行对齐（T3）**：verified-hosts 表的 dsh 行按预注册措辞版本 B 誊抄——版本 token `0.1.5-rc.2 → 0.1.7-rc.2` 对齐实测宿主，机制列更新成 R90 之后的实际形态 `native registration (ctx.tools)`，状态列嵌入 `established-via-fallback: [L3b]` 结论和 `tool_call` 侧证注。中英双版锁步。

### Fixed

- **readme-token-pin 机器检查第一次跑（T4）**：`readme-token-pin` 断言检查器专属的机器检查项从 shadow 模式改成**真实非 shadow 断言**第一次跑（`closeout-claims.json` 两条 `command: dsh --version` 实测比对，README.md / README.zh-CN.md 两份）——R92 明确记着待办的项关掉。

### Added

- **定规矩（T1）**：D1 T2 执行设计全包（隔离 profile 注入面 / B1 预注册单链和链级硬顶 / 诱导句和 N 预算 / max-tokens 预算下限判断标准 / 签名族三形态闭集 / L3c-min 结论收窄成「`ans_*` tool_call」/ 换实验组三义务 / 凭证卫生）；D2 结论条件的转向票（触发判断条件 = 链尽结论显式成立，不是「T2 未绿」；429 和环境违规不触发；内容白名单 = F-bug 登记 + 复核议程；T-B/T3/T4 三条件票互斥求值判断条件显式声明）；D3 README 措辞承继和四列表格形态调和；D4 `r88-candidate` sunset 硬截止（R95 前必须复核 + R94 预通知义务 + owner 点名）；D5 deprecate 权限缺口三型枚举（`credential-scope` / `maintainer` / `org-owner`，每型含 fallback 行为字段）；D6 证据怎么算的规则（本机检查只给建议不阻断，登记 R94 复核）；D7 票序和 commit 结构；D8 Known-Non-Goals（多轮 tool_call ID 污染）。
- **max-tokens 预算下限判断标准**：诱导轮的 `max_tokens` 下限钉成 2048——T0 探针实测 `max_tokens: 8` 就会触发 `finish_reason=length` 且 content 被截断，证明极小预算下的 `length` 形态跟模型能力无关，所以低于下限的 `length` 判环境违规，不计入 N。

### Deferred

- **r88-candidate 垂域方向要不要砍的复核**：写入 sunset 条款——R95 前强制复核，R94 收尾批要在 registry 的 `carried_log` 追加预通知并点名 owner `anysearch-eval`；复核 ≠ 翻案（`reaffirm` / `revise` / `retire` 三种结果都合法），结束无期限 rolling 候审。复核主体在 R94/R95，本轮只定规矩。
- **常驻待办续期**：`defer-r72-dsh-web-interactive-matrix` 主体保持 defer（patchReload:live + browser-turn 上游的 `.d.ts` 键面还缺席）；评测面（`defer-f17` 等）和常驻待办清理仍明确列在本轮范围外。

## Unreleased — r92: featherless 自定义上游 T2 复跑 + 售后收尾轮（判断标准复用和 L3b 修订 + 凭证卫生 + readme-token 检查器接线）

### Changed

- **dsh 售后复跑轮**：通过 User-scope 安全注入 `DEEPSEEK_API_KEY`（len=67，SHA-256 前缀 `64a88ea6`），配置自定义上游 Featherless（`api.featherless.ai/v1`，模型 `Qwen/Qwen3-32B`）。L3 实机冒烟确认 L3a 成立（`cordis.patch.yml` 注入 `id: llm-pi-ai` 和 `id: agent-default-model`，`dump-config` 证实 bundle 层和 patch 覆盖都生效）；因为 Featherless 上游服务异常（响应碰到 4096 max-tokens 并报 `server_error: no_response`，没有产出 `tool_calls`），结论落在分支 C（F-bug），T3 条件票锁住、不启动、不留记录。泄漏探针经 SHA-256 前缀检测全部通过 passed。

### Fixed

- **readme-token-pin 检查器接线（T4）**：在 `scripts/ship-gate.mjs` 的 stepDocClaims 里正式接上 `readme-token-pin` 声明断言检查器（两拍节奏的第二拍），执行 shadow dry-run 并归档证据，第一次专属机器检查项记着待办到 R93。
- **弃用文案双空格核实（T5）**：尝试修复 `@anysearch-cli/cli@0.0.3~0.0.8` 的双空格文案（目标是单空格）；碰到 E401/E404 权限检查，如实记账，closeout-claims 的两种说法随本票预注册。

### Deferred

- **defer-r92-t2-featherless-upstream-f-bug**：T2 实机复跑因为 Featherless 上游模型服务异常挂起，登记 F-bug，转到下一轮修复和排查模型源。
- **defer-r92-readme-token-pin-machine-leg**：readme-token-pin 检查器专属机器检查项的第一次跑，明着记着待办到 R93。
- **常驻待办续期**：登记表明确续录 2 条在册条目（web-interactive matrix 主体、approval-channel headless 继续生效）到 carried_log；其余 3 项（domain-ownership、f16、f17）保持 open。

## Unreleased — r91: dsh L3 冒烟验收 + 售后收尾轮（L3 判定规则定下来 + 宿主升版 0.1.7-rc.2 + README 行对齐 + 小修批）

### Changed

- **dsh 售后验收轮**：宿主升到 `@deepseek-ai/dsh@0.1.7-rc.2`（测的、记的、钉的三个版本统一）；这个条件的判断标准三项检查（L3a 装册通过/L3b 枚举通过/L3c-min 执行通过）定规矩；L3 实机冒烟确认 L3a 成立（dump-config 单行注册在位）；因为环境缺 `DEEPSEEK_API_KEY`，L3b 取证通道证实能直达端点但 tools 载荷确认不了，结论如实落在分支 C（F-bug），T3 条件票锁住、不留记录。

### Fixed

- **ship-gate.mjs 正则修补（T4a）**：把 `/id:s*mcp-anysearch/` 修成 `/id:\s*mcp-anysearch/`，防止漏了反斜杠导致任何选言都误判。
- **弃用文案双空格核实（T4b）**：列出 `@anysearch-cli/cli@0.0.3~0.0.8` 的双空格文案，备好修复命令；尝试执行时碰到 E401/权限检查，按 R87 D4 对执行状态如实记账。
- **WORKFLOW.md §4.2 终审 ADR 判死（T4d）**：明确 supersede 语义——由 GitButler skill + 全局 `but` 协议等价覆盖，10+ 轮缺位的关掉审计正式封口。

### Deferred

- **defer-r72-dsh-approval-channel**：经 T4c 探测，`dsh-headless` 缺交互式 ApprovalAnswerer，调用会按「拿不准就拒绝」降级，保持 open/defer。

## Unreleased — r90: dsh 原生工具面实施轮（五个 ans_* 工具原生注册 + 桥退役 + approval-channel 拆成单独任务）

### Fixed

- **defer-r72-dsh-native-tools 解除**：五个 ans_* 工具（search_web/research_web/recall_memory/query_knowledge/ans_chat）经 `ctx.tools.register` 原生注册在 apps/dsh-plugin 的 `apply()` 里；用的是裸 ToolDefinition（不是 defineTool——零依赖的约定比 DSL 的方便更重要），parameters 逐字照 KernelJsonSchemas 投影，execute 只做传输（MCP tools/call→ans-mcp HTTP /mcp，带三个头 + 出故障就放行、返回空结果）。测试 21/21 绿（先写期望失败的那一步留了证据）。

### Added

- **kernel 的 `./tool-json-schemas` 子路径导出** + KernelToolDescriptions 单一来源（apps/mcp 五个 .tool.ts 的描述文案统一到一处）。
- **callServer 加槽位**：headers/timeoutMs/signal + 空体 2xx→{}（同一个约定的扩展，不是新通道）。

### Removed

- **mcp-anysearch 桥接线**从 cordis.patch.yml 退役（单独一张票做重构；回滚=revert）。注册表 native-tools→closed；approval-channel 拆成独立条目 defer-r72-dsh-approval-channel。

## Unreleased — r89: dsh 上游线轮（0.2.0-rc.1 调研 + repin 结论 soak-until-stable + r72 两张票定形）

### Changed

- **dsh 上游线调研轮**：0.2.0-rc.1（next，2026-09-28T12:14Z 全族同发）的 L1 tarball 探针——我们用到的那部分 `.d.ts` diff 全部相等（12/12 字段级 IDENTICAL）、Events 键面没有任何增删、依赖闭包同一个集合零变化；三个检查项的结论=**soak-until-stable**，锁定 0.1.7-rc.1 + cordis 4.0.4 不动；证据在 `.scratch/grill-round-89/`（upgrade-ledger v3 + t1 transcript/snapshot）。
- **r72 两张票定形（不实现）**：native-tools 的依赖触发器实际上已经响了（注册 API 三代同形）；web-interactive-matrix 分项——approval-channel 解除、patchReload:live/browser-turn 上游缺席继续保持 defer。

## Unreleased — r88: 搜索面清理轮（a06 两层合并 + a03 吞词修复 + a08 死参数清除 + F-6 探针卫生）

### Fixed

- **defer-r83-a03-flagvalueset-swallow**：修复 `ans search --vertical-domain finance finance` 吞掉查询词的问题——旗值改成按位置消费（已知值旗的 i+1 位就是值位），查询词跟旗值长得一样也不会被剔掉（回归测试先红后绿，在案）。

### Removed

- **defer-r83-a08-dead-maxresults**：search_web 删掉没用的 `maxResults` 解构——schema 的 `additionalProperties:false` 从来不放行这个键，行为零变化；kernel 约定测试明确断言拒收 `maxResults`（说明这是有意的特性决定，不是顺手清理）。

### Changed

- **defer-r83-a06-vertical-assembly-dup**：垂域组装和 require-domain 守卫合并成 `buildVerticalSpec`/`verticalSpecReject`（packages/retriever/src/contract.ts，判别联合 {ok,vertical}|{ok:false,reason:"missing-domain"}）——cli/search、search_web、research_web 三个地方共用同一套组装和守卫语义、各写各的错误文案（错误输出逐字节相同，golden 断言在案）；kernel 的 `verticalSpecProps` TypeBox 片段共用，`additionalProperties:false` 保持不变。
- **r88-candidate-f6-refactor-round**：scripts/probe-anysearch-mcp-raw.ts 清理——env 读到 POSIX 空串≈没设（统一用 `||`）、sanitize 对称地遮住 endpoint（`<endpoint>`/`<key>` 跟 provider 探针同形）、UA/clientInfo 的版本字面量从根 package.json 锁定；CHANGELOG 里 r81–r85 五个存量 `## Unreleased` 段归位成 `## 0.1.0 —`。

## 0.1.0 — 2026-09-27（r86 全部检查通过的发布轮）

这一轮：修好变红的检查的根因 + 做 provider 失败的判别实验 + 修正判分程序的语义 + 用真测量版复跑 + 给所有包锁定版本。

### Added

- `ProviderErrorClass` 约定层的错误分类（transient / permanent-auth / permanent-protocol / session-expired / unknown）+ `classifyProviderError`；engine 的 `metadata.providerErrorClasses`（id→类别）贯通到 `ans search --json` 和 delta 证据行（providerErrorClasses{On,Off,IsoOn,IsoOff}）——失败从此记类别，不记裸旗标。
- `scripts/probe-anysearch-provider.ts` + `scripts/probe-anysearch-mcp-raw.ts`——provider 直调取证探针和 raw MCP 原文探针（长期保留的夹具；env 值只记「有没有」的那一类）。
- `apps/cli/scripts/stamp-dist.mjs` 构建戳（anysearch/build-stamp@1：commit+dirty）+ eval runner 的 dist 新鲜度断言（过期→FAIL，缺 dist→SKIP，保证 CI 在没有构建检查项时也能跑）。

### Fixed

- **ship-gate 变红的检查**：R85 closeout claim 的 kind:path 指向一个被 gitignore 的机器本地证据件（CI 双平台必然红）——改成指向入库的指纹清单 `.scratch/grill-round-85/evidence-manifest.json`（path+sha256+size+来源commit+判分程序hash+环境指纹）。
- **判分程序记分簿失真（matrix@2）**：provider-failed 的 隔离检查项不再被读成「测到零增益」——这一格判 unmeasured/unknown；subject 层 instrumentDown>30% 触发 instrument-flag（新的检查 G1b）；runner 捕获层的失败的检查项不再落成空列表。
- **defer-r84-anysearch-empty-endpoint-env**：ANYSEARCH_ENDPOINT/ANYSEARCH_API_KEY 的空串按 POSIX「空≈没设」回落（\s*||undefined\s*），不再落成空端点或裸 Bearer 头。
- **quota/auth nudge 归因**：上游匿名配额边界的自动签凭证回复能被具名识别，归到 permanent-auth（不再落进 malformed/permanent-protocol 桶）。

### Changed

- R85 的 NO-GO 结论语义勘误成 indeterminate—instrument down（程序性判定锁定，不追溯改）；matrix@2 先登记再读数，T5 用原指纹复跑实测 **NO-GO/direction-negative**（P=0.0378、净胜率 −0.125）——垂域实验组在 armHostHit 轴上实测是负效应。
- docs/deferred-registry.json：r85-arm / r84-env 关掉；新增 defer-r86-anysearch-corpus-param-contract 和 defer-r86-anysearch-anon-quota-nudge。

## 0.1.0 — r85: delta 测试全量重跑 + prefer-capable 预注册判分读数（NO-GO 终局）

### Added

- 预注册判分读数矩阵 `.scratch/grill-round-85/prereg-matrix.md` + 确定性判分程序 `.scratch/grill-round-85/readout-delta.mjs`：G0–G4 固定检查顺序（输入完整→对照层装置检查→覆盖检查→2-of-4 负向硬检查→方向轴）+ `Beta(1+b,1+w)` flat 后验（P/EL 精确数值积分、固定网格无 RNG）+ 效应量四个字段 + 单次终读条款；`assert-corpus | selftest | readout` 三种模式——判分程序自己就带离线夹具测试面，判分读数先于读数写进文件 commit。
- delta runner 的 instrument-health 排序（采样协议不变）：对照层前置探针 + G1 旗标早停 + 处理层 vdomain×stratum 轮询交错（配额截断近似 MAR）+ `ANS_VERTICAL_DELTA_PLAN=1` 零配额排演面 + `hadVerticalSpec` 记账检查项字段。

### Deferred

- `defer-r83-prefer-capable-weighting` **关掉（NO-GO 结论附细节）**：全量重跑完成（57/57 格全部有效、覆盖 41/41、指纹 7ac0a48e55cd7954），注册矩阵单次终读判定 NO-GO——但「没有信号」其实是 anysearch 实验组全程 provider-failure 空列（装置级零数据，不是测到零增益），来龙去脉如实写在 decision-record 里；复活前提是新增 `defer-r85-anysearch-arm-providersfailed`（清障候选，owner anysearch-retriever）。`defer-r84-delta-quota-rerun` 关掉（触发条件满足 + 全量重跑的实际结果 + 降格件归档 `delta-2026-09-26.degraded.json`，不删）。

## 0.1.0 — r84: 垂域评测证据检查项——约定断言 + 标准答案语料 + 两实验组配对 delta

### Added

- 垂域评测双层扩展：`eval-looks.json` 的金标账册扩出 `expected.vertical{role,domain,sub_domain,paramsKeys,paramsSent,hit,degraded,hitHosts,hitPaths}` 断言；`vert-*`/`ctrl-*` id 族 + `stratum:`/`vdomain:` 独立维度词表（不碰 docs 八维计数检查）；57 条能现场跑的垂域语料（finance/academic/code/health × parameterized/semantic）+ 对照类一等断言条目；来源字段全带 + 建集时拉到的词表快照（get_sub_domains 只人工看，不进运行时）。
- 配对 delta 的现场检查项 `packages/store/test/online/eval-looks-vertical.online.ts`（D-002 证据层/D-004/D-005）：同一个 query 同一批期望集，vertical-on/off 跑四趟（隔离 `ANS_PROVIDERS=anysearch` 做实验组级主证 + 全同时查多个源融合级副列），产出 `anysearch/vertical-delta@1` 证据件（datasetFingerprint + 实验组标识 + 显式 n + better/worse/tied/unknown + providersFailed 四面 + 实验组采样 URL）；测不了的格记 null/unknown，不记 0。
- CLI eval 面的环境变量开关：`ANS_ARM_SNAPSHOT=1`（`--json` 透出 `metadata.fusion{labels,lists}`）+ `ANS_PROVIDERS=a,b`（provider 子集过滤走 `Query.providers`）。

### Changed

- 三个入口的错误形状统一成「直接报错停下」（A-02 定规矩）：CLI/TOML 对齐 MCP 的拒收报错——bare/subordinate flag 没有 domain、空串 domain/subDomain、非法 JSON `--vertical-params` 全部明确报错；`canonicalizeVertical`（contract.ts）是「params:{} 等同于没有」的唯一规范化点（A-04），engine 审计事件和 anysearch wire 边界共用。

### Fixed

- 测量容错：delta runner 的 host 解析能容忍上游不带 scheme 的 URL；hitHosts 池按后缀匹配域（site.financialmodelingprep.com ↔ financialmodelingprep.com）。

### Deferred

- `defer-r83-prefer-capable-weighting` 注记更新成「证据机制在役，等数据」（open，未关掉）；新增 `defer-r84-ip-fifth-domain`（上游补 ip 结构化参数后再建集）/ `defer-r84-delta-quota-rerun`（匿名配额耗尽后第一轮部分降格，拿到有效 key 再重跑）/ `defer-r84-anysearch-empty-endpoint-env`（ANYSEARCH_ENDPOINT 空串应该视同没设）。

## 0.1.0 — r83: 垂域贯通轮——AnySearch vertical-domain 参数直通 + TE1 dsh 事件迁移

### Added

- `SearchRequest.vertical{domain,subDomain?,params?}` + `SearchProvider.verticalDomainSupported` 能力位（D-003/D-004）：仓 TOML 的 `[sources] vertical={domain,sub_domain?}` 是静态的默认亲和 + 工具参数 `verticalDomain/verticalSubDomain/verticalParams` + CLI 的 `--vertical-domain/--vertical-sub-domain/--vertical-params` 三个注入面；查询级会整个覆盖仓级（没有深合并）；能力由信息源自己声明，只有声明支持的 provider 才收到 wire 字段 `domain/sub_domain/sub_domain_params`，没声明的走 general 同时查多个源并进 degraded 名单（只是提示，不是拒答）。
- `retrieval.vertical.pre` 审计事件（D-005）：attrs=anysearch.domain+vertical.domain+vertical.sub_domain+vertical.params_keys（只记键名不记值）+vertical.source(repo|query)+vertical.sent+vertical.degraded；跟 domain_filter.pre 同构镜像、独立触发；没有 vertical.post。垂域命中的结果带 `NormalizedResult.extra.vertical` 机器标记（融合时保活）。
- `packages/kernel/test/vertical-domain.test.ts`（28 条断言）+ store domain-schema 的垂域断言 + retriever anysearch wire 映射用例 13/13b/13c/13d；README §AnySearch vertical domains 词表+约束表（17 个值的枚举快照+params 约束示例+上游拒收的语义，标了 2026-09-25 这个日期源）。
- `.scratch/grill-round-83/evidence/` —— T0 观测（dsh 两个观测点齐判定+rc.1 龄期检查实测+#1764 OPEN 趋僵 22d+CI 观察窗）+ TE1 迁移实录（三条件+repin 枚举重推导+L2 彩排）+ T1 垂域贯通证据（上游非法组合实测矩阵+CLI e2e）。

### Changed

- `@anysearch-cli/dsh-plugin` 的事件面迁移（TE1，fix-r82-dsh-event-created-consumption 开关打开后兑现）：`ctx.on('agent/session-start')` → `ctx.on('agent/created')` + `source === 'startup'` 守卫（resume/clear/compact 不再重复注入）；@deepseek-ai/* 全族从 0.1.5-rc.2 repin 到 0.1.7-rc.1（catalog+overrides 枚举重推导 21 个名字；新增 workspace/storage/storage-domain/session-persistence/sandbox/sandbox-policy/ptc-runtime，退役 code-runtime/util-crypto）+ cordis 4.0.2 → 4.0.4；contextMessage 适配新约定（MessageId brand + 自有 anysearch-plugin MessageSourceMap 增扩）。旧宿主（<0.1.7）下 payload 没有 source → 守卫自然不注入，就是静默降级。

### Fixed

- `apps/cli/test/e2e.test.ts` 的隔离修复：chat 没 LLM 的用例把环境的 `ANS_LLM_*` 剥掉（`run()` 加了 env 参数）——配置了 LLM 的开发机上不会再假失败。

### Deferred

- `defer-r83-anysearch-vertical-domain-passthrough` 收尾（本轮做完）；`defer-r73-dsh-event-rename` 两个观测点都消费完，关掉；新增 prefer-capable 加权调参跟进项（D-004 §4，交给 eval 数据驱动，不是约定职责）；R82 审计剩下的 nit 分两档处理（e2e 隔离当场修好；度量行自指/JSON id 不对称/clientInfo.version 硬编码/engines 地板缺席逐项登记）。

## 0.1.0 — r82: 迁移上线轮——AnySearchProvider 从 REST 迁到 MCP-over-HTTP

### Changed

- `@anysearch-cli/retriever` 的 AnySearchProvider 传输面迁移（分支 b 执行，fix-r82-anysearch-mcp-migration）：GET /v1/search（REST，404 死路由）→ POST /mcp（MCP Streamable HTTP，initialize→notifications/initialized→tools/call search 这种薄 JSON-RPC，不引入 @modelcontextprotocol/sdk——eventsource-parser 是唯一新增依赖，约 2KB）。Accept 双类型+MCP-Protocol-Version 每个 POST+协商版本回写+Mcp-Session-Id 捕获回显+session 404 重新初始化；fail-first 映射（优先 structuredContent→markdown 返回包容错解析→isError/错形/意外的 Content-Type 一律降级这一路，错形不吞成零）。ANYSEARCH_ENDPOINT 以 /v1/search 结尾→剥到 base+/mcp+warn 一次。`max_results` 名义上限从 REST 时代宣称的 20 修正为 MCP schema 实证的 **10**（静默 clamp）。`domainFilterSupported` 保持 false——MCP 的 domain 是垂域路由枚举，不是 host allowlist（垂域贯通立了 defer-r83-anysearch-vertical-domain-passthrough）。

### Added

- `packages/retriever/test/online/anysearch-mcp.online.ts` + `test:online` 脚本 + ci.yml 的 `test-online-anysearch` 非阻断 job（continue-on-error）——补上 provider 现场搜索的 CI 探针面（R81 分水岭诊断的修法）。
- `.scratch/grill-round-82/evidence/` —— T0 观测（dsh rc.2 龄期检查 ETARGET 实测+特征观测点 tarball 复验+#1764 OPEN 趋僵+两个观测点未齐判定）+ T1 wire/R2 对照/R3 判断条件/垂域检查项实录。

### Removed

- AnySearchProvider 的 REST /v1/search 调用路径和 data.results 映射（随 MCP 迁移整体移除）。

### Deferred

- `defer-r81-provider-shape-validation` 收尾（fail-first 映射+错形测试面）；`defer-r81-anysearch-rest-route-removed` 继续按季度监控；`defer-r73-dsh-event-rename` 两个观测点没齐，继续记着待办（rc.2 特征观测点复验齐了/稳定观测点没齐，合格的候选还没出现）；新增 `defer-r83-anysearch-vertical-domain-passthrough`；残余 R1–R5 的四分诊全部落位（registry residual-triage 五张卡）。

## 0.1.0 — r81: 产品摸底轮——provider-serverside spike 诊断 + release.yml R1 同一个版本重复发就跳过 + 发布出插曲后怎么办的规矩

### Added

- `.github/workflows/release.yml` 的 publish 检查项幂等跳过（D-004 R1）：每个包 `npm publish` 之前先 `npm view <name>@<version>`，已经存在就 `::notice::` 记录并跳过（npm 没有内建开关，rfcs#387，precondition-check 是通行解法）+ E403 "cannot publish over"/EPUBLISHCONFLICT 容错兜底（check/publish 的 TOCTOU 竞态）——同一个 tag 上 `gh run rerun` 对已经发出去的包零副作用，C1 复跑的前提成立。
- `.scratch/grill-round-81/evidence/` —— T0 观测实录（dsh 0.1.7-rc.1 特征观测点进了 rc 线但还在龄期检查内/原生工具注册面 rc.2≡rc.1 零漂移触发器没响/llm-init flake 没复现/#1764 趋僵 21d）+ 插曲事件 1 取证（v0.0.8 三个扳机全扣：五个包发布+SLSA provenance attestations+装跑冒烟 npm i-g/ans doctor/dsh plugin add 全部通过+CI 矩阵绿）。
- `.scratch/grill-round-81/` 的 spike 产物——端点测绘+fake-ip 审计+宣称审计判定表+判别实验矩阵+诊断书（T1a/T1b/T2/T3 实录，判定权归别处）。

### Changed

- `docs/publishing.md` —— 失败分级节定规矩（C1 零发布→修原因+同 tag rerun；C2a 基础设施原因→修原因+复跑补全；C2b 已经发出去的内容坏了→0.0.9 patch-forward；C3 全发冒烟失败→deprecate+0.0.9；unpublish 只留给灾难性事故边界）。

### Deferred

- `defer-r71-provider-serverside` 本轮主轴处理（spike 诊断→三分支推荐→别处判定）；`defer-r72-dsh-plugin-npm-publish` 状态改成已发布上线（三个扳机实证，evidence/release-interlude-1.md）；其余 open 待办 carried_log r81 明确续记。

### Known Issues

- `@anysearch-cli/cli@<0.1.0`（0.0.3–0.0.8）内置的默认端点指向已经退休的 `/v1/search` REST 路由——装上就报 route 404。0.1.0 起默认走 `/mcp`（旧值会被守卫自动改写）；旧版本的停用处理=deprecate 处方（执行状态见轮次收尾档）。升级：`npm i -g @anysearch-cli/cli@latest`。

## 0.0.8 — 2026-09-23 — r80: 发布就绪轮——dsh-plugin 备货上架 + E6 lockfile 复核检查项实证收尾 + 派生件新鲜度检查项 + 上游观测

### Added

- `@anysearch-cli/dsh-plugin` 发布就绪（D-003 预首发路径）：`private:false` + `publishConfig {access:public, provenance:true}`；release.yml 的 pack/publish 清单接上第五个包——从 v0.0.8 tag 起五个包统一走 OIDC+sigstore provenance（tag 的前置条件=用户手发 0.0.7 + npmjs Trusted Publisher 四个字段配置完成，没就绪就顺延、不拆清单）。
- ship-gate 派生件新鲜度检查项（D-004）：CHANGELOG 当前轮条目必须在场（拿不准就拒绝）+ `no-changelog-entry: <理由>` 结构化豁免字段 + 可机器验证的声明注册面（计数类/符号和路径存在性/日期和轮次号——声明和推导命令同一个 diff 变更）+ 叙述一致性先按 warn 起步分档。
- `.scratch/grill-round-80/evidence/` —— T0 观测实录（npm/gh 快照 + rc.3/alpha.1/alpha.2 三版检查状态 + 两个观测点判定）+ T1 E6 实测矩阵（frozen/install/fetch/vdbr-install 四路全拦 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` + verdict 缓存污染机制）+ T2 pack/dsh plugin add/dump-config 复验 transcript。

### Changed

- `scripts/ship-gate.mjs` —— step 1s 的断言同构更新（private:true→publish-ready 形状：private:false + publishConfig.access:public + provenance:true）；step 1a 版本钉 0.0.7→0.0.8，同一个 commit 同步。
- `apps/dsh-plugin/AGENTS.md` —— invariant 行同步成发布就绪状态。
- `docs/publishing.md` —— 新增「新包首发」节（预首发四步 + provenance 边界声明：证明 origin 不等于证明 integrity + no-go 分支顺延、不拆清单）；publish set 从 4 改成 5。
- E6 检查内执行判定：pnpm 11.1.3+ 的 `verifyLockfileResolutions` 复核检查项在锁定版本 11.24.0 实测闭合（`trustLockfile` 默认 false=复核开着）；R78「lockfile 回放绕过龄期检查」被证伪，按实测 revised——当年五个变体放行=`lockfile-verified.jsonl` 判定缓存污染（宽松写入 warn-pass 继续沿用），不是缺检查项；放行依据=上游机器检查项闭合 + CI 断言依赖声明（ws yaml 禁 `trustLockfile:true`/`minimumReleaseAgeStrict:false`/非空 `minimumReleaseAgeExclude`）。

### Deferred

- `defer-r72-dsh-plugin-npm-publish` 状态=就绪等用户扳机（手发 0.0.7→npmjs TP 配置→推 v0.0.8 tag）；`defer-r79-lockfile-agegate-replay` 记判定=上游机器检查项闭合关掉（剩下的边界=同机宽松写入沿用+`trustLockfile:true` opt-out+no-op 短路，CI 断言依赖声明兜底）。
- 落选的 10 条待办按原名继续 deferred（`carried_log` r80 明确记录）：`defer-anysearch-domain-ownership` / `defer-f16-macos-native-crash` / `defer-f17-quarantine-ids` / `defer-r71-provider-serverside` / `defer-r71-transformers-undeclared-dep` / `defer-r72-dsh-native-tools` / `defer-r72-dsh-web-interactive-matrix` / `defer-r73-dsh-event-rename`（alpha.2 特征观测点齐了、稳定观测点还缺=alpha 线+changelog 没审，L2 候选观测继续挂）/ `defer-r74-logo-bitmap-matrix` / `defer-r75-registerhooks-esm-arm`。

## Unreleased — r79: pathlint 豁免范围定规矩——三个豁免面明着定规矩（covered-fence/locator 行/`/x` 只在散文里）+ WORD_CHAR 边界修复（仓库工具链/治理文书的增量，发出去的代码没变，不 bump）

### Changed

- `scripts/ship-gate-pathlint-detect.mjs` —— 豁免范围定规矩：`/x` 的 surfaced-skip 产出顺序挪到 fence/locator 判定之后——所有 fence（不管 marker 有没有覆盖）和 `Stack:` locator 行不再产 info，散文面照旧；`WORD_CHAR` 补 `_`——`foo_C:\x` 这种标识符粘着盘符不再误报，裸 `C:\x` 仍然拦。 <!-- machine-local: 判定器边界用例字面量（裸盘符散文引用） @ 2026-09-23 -->
- `packages/store/fixtures/pathlint/{red,green}.md` + `ship-gate-pathlint.test.mjs`（9→14 cases）——豁免范围的近邻成对断言：covered-fence in-repo 放行↔unmarked-fence 仍然拦、locator in-repo 放行↔不是 locator 的同款仍然拦、fence/locator 里的 `/x` 零 info↔散文仍然产、`foo_C:\x` 零违例↔裸 `C:\x` 仍然拦；跟 AGENTS.md 镜像一致性的机器断言新增。 <!-- machine-local: 判定器边界用例字面量（裸盘符散文引用） @ 2026-09-23 -->
- 某份 ADR 的 D1 修正 + `AGENTS.md` 镜像段 + 第 80 号 ADR——豁免范围三条定规矩+drift 归因（文本侧没审/实现侧有意图）+rejected alternatives（Revert=毁掉 transcript 的保真、逐面混裁=定规矩负担差不多但内聚更差）+豁免扩大风险的三重缓解（一致性测试/stale-marker 只减不增检查/季度审计）+结构性同构先例标注+不 bump 判定。
- 文书的连带效应（自己踩自己实录）：WORD_CHAR 修复让 r78/r79 文书里只靠 `foo_C:\x` 误报撑着的 5 个 marker 变 stale，按只减不增的规则移除；任务书 2 行裸 `C:\x` 字面量补 marker；全仓 markdown 扫描 0 违例（333 个文档）。 <!-- machine-local: 判定器边界用例字面量（裸盘符散文引用） @ 2026-09-23 -->

## Unreleased — r78: 检查可信度校准——pathlint 的 token+分隔符组合判定器 + minimumReleaseAge 拦截边界实测（仓库工具链/治理文书的增量，发出去的代码没变，不 bump）

### Added

- `scripts/ship-gate-pathlint-detect.mjs` —— pathlint 判定器抽成共用的纯函数模块（D-003），ship-gate step 1i 和 warn-sweep driver（`.scratch/grill-round-78/evidence/t1-warn-sweep.driver.mjs`）用同一份实现，两处消费：「token+后面跟着分隔符=locator」的组合判定，新增四类 token 形态——win-envvar `%VAR%` / posix-envvar `$VAR`、`${VAR}` / tilde `~` / UNC `\\host` 形——跟已有的字面形（drive / posix-home / appdata）统一到一处；裸 env-var 的散文永远不命中；单段 POSIX 根 `/x` 降成 info surfaced-skip（看得见但不阻断）；失效标记只减不增检查项（marker 行不再命中就报 stale-marker，标记只减不增）；inline code 不豁免。
- `packages/store/fixtures/pathlint/{red,green}.md` + `packages/store/test/ship-gate-pathlint.test.mjs`（9 cases）——红绿成对夹具把判定器约定固化：红向全部 token 类+两例真实逃逸+inline code+失效/畸形标记必须拦；绿向散文提及、URL 边界、已标记行、locator 行、已标记 fence 全放，跟 `turbo test` 一起跑。
- 第 79 号 ADR——组合判定器+豁免三层心智模型（marker=受审 artifact/只减不增/baseline≠规则漏洞）+只减不增检查的审计+E1–E7 判决矩阵实录+断言收窄文本+`minimumReleaseAgeIgnoreMissingTime` 加固理由+不 bump 判定。

### Changed

- `scripts/ship-gate.mjs` —— step 1i 的 PATH_RE inline 块整个替换成 detect 模块的 import（`enumerateScopedMarkdown`/`buildEnv`/`scanLines`），拿不准就拒绝语义不变。
- `pnpm-workspace.yaml` —— 新增 `minimumReleaseAgeIgnoreMissingTime: false`：缺 time 元数据的源从「默认跳过」（豁免面）收紧成拿不准就拒绝；npmjs 永远带 time，对现状没有破坏（E7 记档态向量）。
- 存量违例批量清理——先 warn 全量扫 313 篇登记文档，实录 96 个命中 → 97 个处置动作/52 个文件行尾补上受治理的 machine-local 标记（`…:111` 等）→ 复扫 0 之后翻成拿不准就拒绝（证据 `.scratch/grill-round-78/evidence/`：`t1-warn-sweep.md` + `t1-remediate.md`，driver 幂等可复跑）。
- `docs/deferred-registry.json` —— `defer-r77-pathlint-envvar-blindspot` 关掉 closed（closed_by 另记）；11 条 open 待办在 `carried_log` r78 明确续记。
- `.scratch/grill-round-77/upgrade-ledger.md` v2 的待校准项消解——断言收窄登记检查项：minimumReleaseAge 检查只拦新鲜解析路径（catalog/range 重新解析），lockfile 回放不执行龄期检查；E6 格证伪如实记档（检查范围内的版本手写进 lockfile + frozen/fetch 五个变体全放行，`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 在 11.24.0 不触发——跟 #11583 调研结论矛盾，按实测为准）。

### Deferred

- 落选的 11 条待办按原名继续 deferred（`carried_log` r78 明确记录）：`defer-anysearch-domain-ownership` / `defer-f16-macos-native-crash` / `defer-f17-quarantine-ids` / `defer-r71-provider-serverside` / `defer-r71-transformers-undeclared-dep` / `defer-r72-dsh-plugin-npm-publish` / `defer-r72-dsh-native-tools` / `defer-r72-dsh-web-interactive-matrix` / `defer-r73-dsh-event-rename`（L2 排程中）/ `defer-r74-logo-bitmap-matrix` / `defer-r75-registerhooks-esm-arm`。
- E6 证伪的后果记着待办——带着检查范围内的版本的 lockfile 不在龄期检查的执行范围内（frozen 回放静默放行），这个口子由 lockfile review 纪律兜底，不指望检查覆盖。
- pathlint 残余盲区记着待办——多段未知根 POSIX 路径（gitbash `/d/` 盘形等）判定器不命中也不报，继续沉默，等后面轮次评估。

## Unreleased — r77: dsh 上游观测哨分层漏斗 + R76 治理 backlog 七项清理（仓库工具链/治理文书的增量，发出去的代码没变，不 bump）

### Added

- `scripts/governed-json.mjs` 新增 `governedListViolation` + `stripBomCommand`——`CANONICAL_JSON_FILES` 是空清单时拿不准就拒绝（真实检查探针实测 `[fail] canonical-json:... is empty`）；UTF-8 BOM 单独报错（EF BB BF 签名 + `subarray(3)` strip 命令，不给 normalize 指针）。
- `.scratch/grill-round-77/evidence/` —— T0 轨一探针取证：`t0-l0-watch.json`（23 个名字全族 npm view 快照）、`t0-api-snapshot-rc2.json`（pin 版消费面 API 快照）、三份 L1 transcript（rc.3 无 alarm / alpha.2 检查项复核 ALARM / 0.1.7-alpha.1 ALARM+家族扩到 21 个 dsh-*）。
- `.scratch/grill-round-77/upgrade-ledger.md` v2 —— L0/L1/L2 漏斗重排 + 改名映射纠偏（rc.2 的 session-start 本来就带 source）+ 退役标记表 + no-qualifying-candidate 显式结论。

### Changed

- `scripts/closeout-coverage.mjs`——`titleRound` 检查项定在 title 行首（句子里提到「Grill Round N —」不会误登记）；`ROUND_DIR_RE` 改成全名匹配 `/^grill-round-(\d+)$/i`（`grill-round-7x` 不再被当成 round 7 的别名）。
- `scripts/gen-adr-index.mjs` —— renderBlock 互相标注，点名谁在读取（F-5⑥ 双向约定）。
- `docs/deferred-registry.json` —— `defer-r73-dsh-event-rename` 的触发器两个观测点改写（特征+稳定性，版本号退出触发逻辑）+ `tombstones` 字段（0.1.6-alpha.* superseded-by 0.1.7-alpha.1）+ `gov-r76-registry-canonical-lock` 补 `deadline`/`review_cadence` + 10 条 open 待办 carried_log r77 明确续记（canonical normalize+字节锁自证）。

### Deferred

- L2 合格候选本轮不存在（no-qualifying-candidate 显式结论）：rc.3 无 ALARM、alpha 线的稳定观测点不响；下一个合格候选出现就按 latest-only 直接彩排，跳线版本只补退役标记。落选待办按原名继续 deferred（carried_log 记）：transformers(#1764 未 merge) / provider-serverside / dsh 三件套 / bitmap / registerhooks / f16 / f17 / domain-ownership。
- `defer-r77-pathlint-envvar-blindspot`（审计返工新立项）——ship-gate step 1i 的 PATH_RE 不认识 env-var 形态的机器路径（`%TEMP%`/`$HOME`/`~/`），是意图层面的盲区；修复方向=PATH_RE 扩形态+红向 fixture。 <!-- machine-local: 用户级 ~ 路径引用（存量合规化） @ 2026-09-22 -->

## Unreleased — r76: 治理面悄悄跑偏后的清理（仓库工具链/治理文书的增量，发出去的代码没变，不 bump）

### Added

- `scripts/governed-json.mjs` + ship-gate step 1 的 `stepGovernedJsonCanonical` 检查项——受治理 JSON 必须逐字节一致的检查：`CANONICAL_JSON_FILES = ["docs/deferred-registry.json"]`，逐文件断言字节 ≡ `JSON.stringify(JSON.parse(src),null,1)+'\n'`；非法 JSON 单独报错；不是 canonical 就报 `first differs at line N` + 可粘贴的 normalize 指令 + 清单常量位置；gate 不自己修（committed≠reviewed）。
- `scripts/closeout-coverage.mjs` + ship-gate step 1g 的 leg-b 重写（–D3）——完成信号改成 ADR index 里登记了 `Grill Round N`（登记即完成），拿不准就拒绝三条断言（已登记但没有 closeout→失败 / index 和 .scratch 双向漂移→失败 / 推导集合为空或解析不了→失败），从第 76 轮开始算，还没收尾的轮次先放行，打一行结构化 `awaiting closeout: round N (ADR not yet registered)`，成功输出带覆盖计数；字段 lint 面不动（仍然只 lint 最新含 closeout 目录的那份）。
- `packages/store/test/governed-json-canonical.test.mjs`（19 条断言）+ `closeout-coverage.test.mjs`（40 条断言，含审计返工 F-2/F-4 和二批 residual 回归用例）——用已知有问题的夹具常驻跑，坏的情况和好的情况都证明一遍，跟 `turbo test` 一起跑。

### Changed

- `docs/deferred-registry.json` — `defer-r71-shipgate-1g-coverage` 关掉 closed（closed_by 另记）；新增 `gov-r76-registry-canonical-lock` 立项事实入档；11 条没排上的欠账按原名继续 deferred，并且每条都附 `carried_log` 续记条；顶层 `note` 追加 canonical 锁定声明。

### Deferred

- 没排上的欠账按原名继续 deferred（carried_log 明确记）：transformers(#1764 未 merge) / provider-serverside / dsh 三件套 / event-rename / bitmap / registerhooks / f16 / f17 / domain-ownership。#1764 观察哨继续挂；两份 drafts 文稿仍等用户亲手发。

## Unreleased — r75: transformers 没声明的依赖，查清楚了（发出去的代码没变，不 bump）

### Added

- `packages/embedding/test/transformers-ghost-dep.test.ts` — 两道静态保护措施：(a) `src/` 整棵树禁止直接引 `@huggingface/transformers`（import/from/export-from/import 全禁，唯一合法入口 = `createRequire.require`；注释和 `typeof import(…)` 类型查询豁免）；(b) 版本配对断言——自己声明的 `optionalDependencies.onnxruntime-common` 要等于实际 `onnxruntime-node` 里嵌的版本（当前 1.21.0 ≡ 1.21.0），两个反例都自证会红（`.scratch/grill-round-75/evidence/t2-guardrails-selfproof.log`）。
- `.scratch/grill-round-75/drafts/` — 给上游的申报文稿（等用户审阅，agent 不代发）：`pr-1764-comment.md`（4.3.0 pnpm 隔离 scope 运行时复现 + 发布后消费者裸奔 + 下游 ≥4 个项目自己造轮子的清单）+ `issue-1087-comment.md`（给检索者指路的短评）。
- `.scratch/grill-round-75/evidence/` — T0 运行时实证 transcript：4.3.0 在 `hoist:false` 下 `Cannot find module 'onnxruntime-common'`@`transformers.node.cjs:13520`；3.8.1 不打补丁同样红、带补丁绿；默认 virtual-store hoist 把这个面盖住的注记。

### Changed

- `docs/deferred-registry.json` — `defer-r71-transformers-undeclared-dep` 证据刷新（4.3.0 解剖 + 运行时复现 + 配对纪律 + watch 改成 >4.3.0 + #1764 链接），status 继续 open（#1764 没 merge，条件没达成）。
- `scripts/ship-gate-pathlint.config.json` — `scratchDocDirs` 登记 `drafts`（新建文档类型的唯一入口）。

### Deferred

- `defer-r75-registerhooks-esm-arm`（新条目）— 给 ESM 分支补 registerHooks 的点名回头票，三个重返触发器：(a) src 里出现 ESM import 加载路径（保护措施断言会红）；(b) #1764 merge 且发布版带声明（补丁整体退役）；(c) Node 地板 ≥22.15 且出现真实的 ESM 消费者（按 GitNexus#2069 的做法做到「出故障就放行 + 动态配对」）。落选待办按原名继续 deferred：shipgate-1g / provider-000 / dsh 三件套 / bitmap / f16 / f17 / domain-ownership。

## Unreleased — r74: README 的图 + Antigravity 集成专文（只改文档）

### Added

- `assets/readme/logo.svg` — 项目原生的「域名白名单」纯 SVG 标（256² 深色芯片底=深浅两个主题都安全；图形对应真实模块：三路 provider 结果汇进来 / pre+post 两道竖向检查 / TOML 域界框 / 融合落点点 /拒答截停×；16px 也认得出）。概念筛选：3 个文字提案（视觉解剖+图形和模块的对照表）由用户选定概念 1。
- `assets/readme/hero.svg` — `1200` unit 的 viewBox 的首页图：左边是字标+一句话价值+install 元数据+logo 标，右边是同时查多个源→`urlAllowlist` 检查→白名单内落点行+白名单外拒答卡。自包含（没有 foreignObject/脚本/远程资源/会被剥掉的 CSS）；Playwright 渲染核验 900px/360px/深浅底/16px 全过。
- README/README.zh-CN 的 `## How it works` 双语新节——Mermaid 流程图（`ans`/`ans-mcp` → fanout → tavily/exa/anysearch → domain gate pre+post `urlAllowlist` → RRF fusion + attribution → FTS5 memory + observation store；kept/dropped/zero-kept→拒答三个分支），放在 Verified agent hosts 前面。
- README/README.zh-CN 真实输出 proof 块（status 段后面）——`ANS_DOMAIN=docs ans search "model context protocol"` 亲手跑的摘录（返回的 URL 全在 allowlist 里）+ 标准的拒答行，证据先于承诺；中英逐字相同（parity 检查项 ii）。
- `docs/antigravity-integration.md` —— agy 双宿主专文（CLI 1.2.5 + IDE 2.12.2）：named-hook map 约定 / camelCase stdin / 严格 protojson（`{}`=DENY、空=allow）/ argv 传事件 / 五个事件没有 SessionStart / `call_mcp_tool` 伞 / pending 暂存→injectSteps 注入 / IDE 不执行 hooks 时的 `.mdc` 兜底 / 隔离 HOME 探针法。承接 verified-hosts 表的 agy 证据迁移（先于瘦身提交）。

### Changed

- README/README.zh-CN 的 `Verified agent hosts` 表瘦身——5 列段落级长文压成 4 列好扫读（Host / Version / Verified scope / Status=结论短语+专文指针）；Date 列和探针细节迁进各宿主专文，证据没有净丢失；表下指针段补 `docs/antigravity-integration.md`。

### Deferred

- `defer-r74-logo-bitmap-matrix` —— logo 的位图衍生矩阵（PNG/WebP 导出）延期：repo-logo 位图流程依赖的 imagegen 工具不存在；本轮只落纯 SVG 标，真要位图时以 `assets/readme/logo.svg` 为源件。

## 0.0.7 — 2026-09-19 — /0074 r72+r73: DeepSeek Harness 宿主适配（两阶段 C：Phase-1 MCP 桥 + Phase-2 薄 bundle）+ 上游依赖族锁定版本

### Added

- `apps/dsh-plugin`（`@anysearch-cli/dsh-plugin`，private、零运行时依赖的 Cordis bundle）——第一个 in-process 宿主适配器：只做五个面的 hooks（`agent/session-start` routing-card `agent.inject`、`ctx.systemPrompt` `anysearch:routing-card` section、`tools/pre-execute` URL 策略 deny/ask + recall 预热注入、`tools/post-execute` 蒸馏 `additionalContexts`、`tools/result` `/index` IPC），业务逻辑全留在 127.0.0.1:33333 HTTP IPC（出故障就放行；URL 检查按 /0055 拿不准就拒绝）。`@deepseek-ai/*` 只做 devDep `import type` = 编译期变化的报警器；`dsh.bundle.patch` → 自带 `cordis.patch.yml` 整行复述插入插件行 + `mcp-anysearch` 桥行（`dsh plugin add` 一步装两阶段）。共享 hook 逻辑复用 `@anysearch-cli/plugin`，用 esbuild 打包进 `lib/index.js`（`createRequire` banner——CJS 依赖在纯 ESM 下 `Dynamic require of "node:crypto"` 是真实 loader 实测修好的）。
- `apps/plugin` 新增窄口子导出 `./hooks/routing-card` + `./hooks/server-token`（esbuild entries + exports map）——dsh bundle 复用 routing card 和 server token resolver 的单一事实来源。
- `scripts/ship-gate.mjs` step 1s——dsh-plugin 的变化检查（拿不准就拒绝）：`@deepseek-ai/*` 漏进任何 runtime dep 字段就判为失败；private:true/type:module/dsh.bundle.patch/cordis.patch.yml 关键键位断言。PKG_DIRS 加 `apps/dsh-plugin`（0.0.6 锁定版本+打包检查项覆盖）。
- `docs/deepseek-harness-integration.md`——Phase-1 手写 MCP 桥行 + Phase-2 bundle 安装指引 + 层序三条规矩（config 整行替换不是合并 / `- insert:` 新增 vs `- id:` 打靶 / 同 id 双 insert=loader 硬错）+ 升级 diff 检查 + 限制记档。
- README/README.zh-CN 的 verified-hosts 第 6 行（DeepSeek Harness 0.1.5-rc.2）。

### Fixed

- 真实 loader 的三处语义修正落档：`- insert:` 同 id 重复= `duplicate loader entry id` 硬错（Phase-1 手写行和 bundle 行不能并存）；`- id:` 打缺失的行只告警（`patch: entry ... not found`）；CJS 依赖经 ESM bundle 需要 `createRequire` banner。
- R71 审计修复包（F1-F6）：`tryImport` 逐候选 guard（resolve-ok+import-fail 归 absent 不抛、不污染 modPromise）、doctor pnpm 行、config marker 接线、globOk 拿不准就拒绝、cosmetic 组——同一套验收全部通过后跟着本版上架。
- 升级 diff 预演的 alpha 兼容警报定档：上游 0.1.6 把 `agent/session-start` 移出 Events（改名 `agent/created`，载荷加了 `source`/`signal`）——本轮锁定版本不迁移，迁移记录见 `.scratch/grill-round-73/upgrade-ledger.md`。

### Changed

- `pnpm-workspace.yaml` —— dsh 上游依赖族锁定版本：新增 `catalog:` 单点块（15 个 `@deepseek-ai/dsh-*`=0.1.5-rc.2 + `@deepseek-ai/cordis`=4.0.2），`overrides:` 逐名枚举→`catalog:` 全树统一；`apps/dsh-plugin` 的 5 个 deepseek devDeps 改成 `catalog:` 引用（`dependencies:{}`/`private:true` 不动）。修 R72 审计 F7——caret range 放任传递依赖漂到 0.1.6-alpha 的混版树。

### Deferred

- `defer-r73-dsh-event-rename` —— dsh 0.1.6 的事件改名迁移（`agent/session-start`→`agent/created`，payload 加 `source`/`signal`；durable 路由卡只在 `source=fresh` 时注入）。采纳触发器和迁移蓝图见 `.scratch/grill-round-73/upgrade-ledger.md`。

## 0.0.6 — 2026-09-19 — r71: 第一次上架——机器路径治理检查 + embedding 两种安装方式都能找到 + 第一次真正的两层发布检查

### Added

- `scripts/ship-gate.mjs` step 1i/9 — 机器本地路径纪律检查（拿不准就拒绝，配置在 `scripts/ship-gate-pathlint.config.json`）：Stack/locator 行里的裸绝对路径合法；库内的绝对目标强制写成仓库相对路径（marker 不豁免）；库外的绝对路径必须带 `<!-- machine-local: <reason> @ <YYYY-MM-DD> -->` 治理声明；声明紧贴 fenced block 就覆盖整段；文档目录显式登记（.scratch 轮根/handoffs/reports/evidence/backups）。历史机械扫描 317 处库内引用转成相对路径 + 93 个声明标记，先红（330 violations）后绿（224 docs clean）。
- `packages/store/src/embedding-arm.ts` 的兄弟根回退 —— pnpm-global 把每个顶层包装进 `<prefix>/global/v11/<hash>/node_modules` 这种孤立树，optional peer 的裸 specifier 找不到；回退用 argv[1]（bin shim 保住布局路径）+模块自己的地址做检查项，往上找祖先并扫 `*/node_modules/@anysearch-cli/embedding` 兄弟根。单测合成布局 + install-smoke leg 3c（junction+--preserve-symlinks 模拟）两边证明。
- `scripts/install-smoke.mjs` leg 3c —— pnpm 孤立根布局的模拟检查项，断言回退能让 doctor 报 vector arm present。
- README/README.zh-CN 的 `## Post-install` 双语段 —— 激活验证 + backfill 命令、模型缓存位置、离线预置法、只用 FTS 的降级说明。
- `ans memory backfill-vectors` 失败提示 —— failed>0 时输出可达性/缓存/doctor 可照着做的指引（替代光秃秃的计数）。
- 跟着这一版一起发的 R68-R70 的东西：发布检查分两层（pre-tag 烧 look+ledger commit / post-tag 纯断言+publish）、收尾必填栏检查、README 双语化+parity 常驻检查每小时、docs/limitations.md+ADR index 生成器、assert-checks-green 严格两段式、spawnSync 测试抖动处理、LICENSE 换成标准 Apache-2.0、F2-F6 文档级修复。

### Changed

- `packages/embedding` —— lazy load 改成 `createRequire().require()`（CJS 入口）+ 作用域内的 `Module._resolveFilename` 补丁（只补 `onnxruntime-common`+只补 `@huggingface/transformers` 这个父域）；声明 `onnxruntime-common@1.21.0` optional dep —— 修 transformers@3.8.1 没声明外部依赖、在 pnpm 孤立 scope 下的 MODULE_NOT_FOUND（npm hoisting 会把它盖住）。
- doctor 的 vector-arm SKIP 文案 → 给出可执行的启用路径（install+backfill 两步 copy/paste）。
- release.yml 的 assert-checks-green timeout 10→15min（p90=740s>600s，尾巴会被削掉）。
- AGENTS.md 的路径规则 → 按用途分三种（locator/库内/库外）；pnpm 锁定版本说明改成单个 `packageManager` 声明。

### Fixed

- **release-gate pre-tag 的结构性断点（第一次真客户暴露）** —— 写记录文件的那次 commit 是 GITHUB_TOKEN push 的，GitHub 的递归守卫让它永远不触发 workflow run → 记录文件的 sha 没有 check-run → `FAIL_ON_NO_CHECKS` 必然失败（run 35385345425）。修复：release-gate 在记录文件的 sha 上自己 dispatch ci+ship-gate（临时 ref `release-gate-ledger` 确定性地锁定 sha，wait 之后清理）——断言一条没减，需要的权限是 `actions: write`。
- **EBADDEVENGINES 根治** —— 删掉根 `devEngines`：对锁定版本来说是多余的（packageManager+pmOnFail 实证 pnpm@11.7.0 仍然 ERR_PNPM_BAD_PM_VERSION），而且让仓库里所有 npm 命令都告警；发布的 tarball 从来没带过它。
- R70 审计的 Temp transcript 入库 `.scratch/grill-round-70/evidence/r70-audit-temp/`（默认提交判定）。

### Deferred

- 1g 覆盖缺口 / macOS spillover 探针 / provider 服务端排查 / deferred 大池（cursor / F-01a / npm provider / projectIndex / TUI / cross-OS / plugin / watch）。

## 2026-09-18 — r70: 把验证的时间顺序定死（assert-checks-green 严格两段 + spawnSync 抖动处理）

### Added

- `.scratch/grill-round-70/fixture/` — assert-checks-green 的 ESM-loader 夹具常驻化（acg-hooks/acg-cp-stub/acg-register/run-legs 四件，`node:child_process` 定向拦截注入脚本化的 gh check-runs 响应；7 条检查项断言：全部通过/完成段 stale/空信号/部分→全到齐/家族永远不注册/发现段红/完成段红）。

### Changed

- `scripts/assert-checks-green.mjs` — 严格两段式时序：Phase 1 discovery 要求全部 5 个 required family 在 --discovery-sec 内各自注册 >=1 个 check-run，过期拿不准就拒绝，exit 2 且错误行点名 missing-families/present-families；Phase 2 completion 沿用进程启动的绝对检查项（不 re-anchor）；terminal 不是允许的 conclusion（failure/cancelled/timed_out/startup_failure/action_required）在两段内立即 exit 1；没建模的 conclusion（比如 stale）在完成段按 not-allowed 拿不准就拒绝；--once 快照和 exit 10 的语义不变；release.yml 调用时的 flag 没有漂移。

### Fixed

- **store 里 spawnSync 型测试的负载抖动（R70 T1，签名=spawnSync 子进程 CPU 饿死）**：裸 .mjs 测试文件不受 --test-timeout 约束，而且同步阻塞、抢不走——4 个测试内层 spawnSync 全部加显式 timeout（eval-calibrate --boot 200 judgeRun 180s，其余 60s）+ ETIMEDOUT 带描述的抛出；同负载实测转绿（66s/94s），断言和 --boot 规模没动。

### Deferred

- ship-gate(windows) 的 check 耗时 p99=740s > assert 的绝对界 600s（尾巴侵蚀呈报，C 升格触发器已经武装）——最直接的缓解=release.yml 的 timeout-min 往上调，明着记档 deferred，不静默吸收。
- R68/R69 的方向指示继续 deferred：真 release 摘掉 partial 帽 / agy ans-MCP P7 真链 / PR-mode required-checks 治理。
- deferred 大项池继续：cursor / F-01a / npm provider / projectIndex / TUI / embedding / cross-OS / plugin / watch。

## 2026-09-18 — r69: GitHub 首页中英双语 + 紧急修红（README 首页结构 + 双语对齐常驻检查）

### Added

- `README.zh-CN.md` — 中文伴生件：顶部翻译件声明（规范以 README.md 为准）+ 互链切换器；heading 结构 1:1 + 代码块/链接逐字节相同。
- `docs/limitations.md` — Known limitations 全录（20 条，从 README 逐字迁入）。
- ADR 索引独立生成件（`scripts/gen-adr-index.mjs` 从 README 内嵌段重指向；行内相对链接；index.md 自己排除自己）。
- ship-gate step 1h — 双语 parity 常驻拿不准就拒绝：heading 骨架 1:1 + 代码块逐块逐字节相同 + 链接多重集（减掉互链切换器）一致 + docs/limitations.md 指针可达；漂移一直存在就一直判失败。
- README 的徽章 ×3（npm version / ci workflow / license——全是动态可验证的端点）+ 顶部切换器。

### Fixed

- **main tip 的 ship-gate 红（e265667）**：`isCloseout` 的裸 `^round-\d+` 前缀误伤了 `round-69-direction.md`——收窄成必须带 `closeout|closure` 关键词（双向验证：direction 脱靶 + round-67/68-closeout 仍然命中）；方向文档补 Stack 头 +「绿色 run URL」段引六条实证 run（主张-引证教义）。
- **`LICENSE` 实际上是变体的 Apache-2.0**：专利反制/再分发条款被改写过 → GitHub 判 Other 属实；换成标准 Apache-2.0 全文（根目录 + 4 个发布目录副本），对齐 package.json 声明里说的意思。
- **verify-observation step-8b 抖动**：响应后异步写 trace 可能被硬杀丢掉——stdin EOF 优雅退出（3s 兜底 kill）+ 落库重试窗（20×250ms）。
- L-1：report L43 的相对路径 → 绝对路径。

### Changed

- `README.md` 重构成首页结构（312 → 159 行）：把 limitations 全文和 ADR 索引段搬出去，机器路径清零，Known limitations 摘成 top-3 摘要表 + 指针，ADR 目录段改成 Design rationale 三句 + 指针。
- `scripts/gen-adr-index.mjs` 的目标从 README 改成 ADR 索引文件（generate-and-diff 纪律不变）；ship-gate step 1b 同步改目标；`readme-adr-index.test.mjs` → `adr-index.test.mjs`。
- `isCloseout` 的定界 = 语义关键词，不是文件名形状（见 Fixed）。
- `release.yml` 的 `gh issue create` 双写回退补注释（没有 label 时的兜底语义写明白）。
- 仓库元数据：`gh repo edit` 的 description 改成产品向的一句英文 + topics ×9（settings 面的变更，命令 + 前后 JSON 都进了证据）。

### Deferred

- F-S4：`assert-checks-green.mjs` 严格两段的 discovery/completion 截止另开票；现在先靠 timeout-min 兜底。
- R68 方向指示的三条线继续 deferred：真 release 摘掉 partial 帽 / agy ans-MCP P7 真链 / PR-mode required-checks 治理。
- deferred 大项池继续：cursor / F-01a / npm provider / projectIndex / TUI / embedding / cross-OS / plugin / watch。

### 过程违规自报

- R69 的 grill Q2 曾经被跳过没问（D-002 的空号保留，作为跳号的证据）——用 Q6 补问，流程违规如实记账，不追认。

## 2026-09-17 — r68: 发布检查分两层 + 收尾必填栏检查（写仓库的自动化守门）

### Added

- `scripts/assert-checks-green.mjs` — post-tag 前置断言器：在固定 SHA 上轮询 check-runs（ci+ship-gate 五个 job 族），全部通过就放行 / 有失败就立刻停 exit 1 / in-progress ≤10min 短轮询 / 没有信号拿不准就拒绝，exit 2；同名 check 取最新 started_at 的那个。
- release.yml 的 pre-tag 自等检查项：写记录文件的那次 commit+push 之后 `lewagon/wait-on-check-action@v1.9.1`（pin `36976907`）等固定 SHA 的 ci+ship-gate 全部通过——discovery 120s 空窗 + step `timeout-minutes:20` 硬超时拿不准就拒绝。
- release.yml 的告警检查项：gate 红了 → blocking job failure + step summary + 自动开 issue + `release-gate` commit-status（failure）打到写记录文件的那次 commit。
- ship-gate step 1g：`.scratch/*/handoffs/` 收尾文档的必填栏检查——「绿色 run URL」段 + Stack 行 + `actions/runs/<id>` URL + gh 可用时校验至少一条 run 的 headSha 是本轮历史的祖先。范围=diff 碰到的 ∪ 最新的收尾文档（历史收尾 grandfather）。

### Fixed

- **`eval-looks.json` 丢了 `schema_version: 1`（main 两个红的根因）**：release-bot 的回写流程 read→normalize→write 逐字段重建，把不认识的字段剥掉了。`looks-ledger.ts` 改成宽容读取（根/行索引签名+spread 保留）；`cli.ts` 的 calibrate-reset 同类修复——F-17 排查里同一种 N=2 并修。`eval-docs-golden.test.ts` 增加逐字节 round-trip 约定断言。
- **`eval-abstain.test.ts` 裸跑 `runAll(GOLDEN_CASES)`**：semantic/vector-arm 组必须归到 `test:online`——补上 `excludeGroups: OFFLINE_EXCLUDED_GROUPS`。
- **release.yml 的发布通道两头都没查（v0.0.5 用红树发布的原因）**：pre-tag 不等 push 触发的检查、publish 不查 tagged SHA——两层检查都关着。

### Changed

- `concurrency` 组从 `release-${{ github.ref }}` 改成 `release`：pre-tag dispatch 和 tag push 不再交错。
- 治理入档：`but land` 直推 main 判定为 grill 轮次的合规通道；未来方向=PR-mode + required checks + tag ruleset/environment reviewers。

### 验证边界

T1 检查只是**部分验证**：dry-run 只打了既有 concluded 的 SHA（绿 14514da / 红 d7bed91 / 无信号 4833833），wait-action 那一项没有实跑；第一次真正的 pre-tag dispatch 之前不能宣称 fully verified。

### Added (T3 — Antigravity spike 验收通过)

- `ans-hook-antigravity` bin（→ `dist/hooks/adapters/antigravity.cjs`）——agy 的 hooks 命令经 PATH 解析 + argv 传事件名。
- `test/antigravity-contract.test.ts`（11 条）：named-hook schema 校验、bin+argv 事件断言、PreToolUse 始终 `allow`/绝不发 `{}`、PostToolUse 发 `{}`、PreInvocation 的 inv0 注入 routing card、pending 暂存/flush、出故障就放行、mdc 兜底、Stop 的 protojson 安全。

### Fixed (T3 — agy 1.2.5 实测约定重写)

- **configs/antigravity/hooks.json 是个死文件**：Gemini-legacy 的 `{hooks:{...}}` 包装被 agy 拒绝（`command hook must specify 'command'`）——重写成官方 named-hook map，五个事件全挂上。
- **adapter 读错了字段**：stdin 实际发的是 camelCase（`conversationId`/`toolCall{name,args}`/`workspacePaths`），而且没有 `hook_event_name`——改成 argv[2] 为主源 + camelCase 映射 + `call_mcp_tool` 内层工具名解包。
- **输出形状在真宿主上全废**：`additionalContext` 这类非 proto 字段 protojson 拒收并让工具调用报 ERROR；`{}` 在 PreToolUse 就是 DENY。重写成：PreToolUse 始终 `{decision:"allow"}`、PostToolUse 始终 `{}`、Pre/PostInvocation 用 `injectSteps[].ephemeralMessage` 注入、Stop 发 `{}`。
- **PostToolUse 拿不到工具输出**：宿主不投递 output——preheat/distill 的产出先暂存到 `<artifactDirectoryPath>/anysearch-pending.jsonl`，下次 invocation 用 ephemeralMessage flush（真机 e2e 证明 routing card 进了 transcript）。

### 降级声明

- Antigravity **IDE**（2.12.2）：不执行 hooks——`.antigravity/rules/anysearch.mdc` 的 rules 兜底是唯一支持面（README 按 surface 拆分）。
- ans MCP 工具链检查项排除在外（probe 沙箱没有 ans server；约定测试覆盖 call_mcp_tool 解包+isAnsTool+pending）；`agy -p` 在用户的 MCP 配置下会被挂起的 server 阻塞 turn（probe 用隔离 HOME 绕开）。

## 0.0.5 — 2026-09-17 — r67: 对齐 Codex 0.142.5 真实宿主的约定

### Added

- `apps/plugin` 新 bin `ans-hook-codex`（→ `dist/hooks/adapters/codex.cjs`）——Codex 的 hooks 命令经 PATH 解析全局安装，跟 claude 那条路同构。
- `apps/plugin/AGENTS.md` 随包分发（`files[]` 收录）——ans_* 白名单+出故障就放行+namespace 说明块，供人贴进项目的 AGENTS.md（可选步骤见 `docs/codex-integration.md`，/D-003③）。
- `test/codex-contract.test.ts`（11 条）：官方 schema 校验、bin→entrypoint 解析、matcher 全匹配覆盖、SessionStart `--envelope` 断言、生成器漂移守卫（codex 配置纳入）、返回包输出形状、hook_event_name 优先+legacy 兜底、拿不准就拒绝 ask、非 ans 静默、畸形 stdin 出故障就放行。
- `docs/codex-integration.md`：Codex 接线文档（config.toml 两层配置 + MCP + hooks + 实测宿主事实清单 + 出故障就放行）。

### Fixed

- **configs/codex/hooks.json 是个死文件（现场抓出来的）**：0.0.4 用的是 `{name,command,args}` 条目——Codex 严格态报 unknown-field、宽松态静默注册零 hooks。重写成官方 `{matcher,hooks:[{type:"command",command}]}` schema，纳入 `scripts/gen-claude-configs.mjs` 单源生成+漂移守卫。
- **codex 适配器的裸输出被宿主丢掉（现场判定）**：`adapters/codex.ts` 的 PreToolUse/PostToolUse 原来把顶层 `additionalContext` 直接写出去——codex 0.142.5 实测大约 80% 被丢掉（合成桩 1/8、实物 1/3）。全部改放进 `hookSpecificOutput{hookEventName,...}` 返回包。
- **URL 策略的 deny 在 Codex 上完全失效**：适配器原来只发 additionalContext、把 `decision.permission` 丢了——deny 决策零输出、工具照跑。现在把 `permissionDecision`/`permissionDecisionReason` 传出去，真宿主端到端拦阻实测通过（router: `Tool call blocked by PreToolUse hook`）。
- **SessionStart 的裸输出在 Codex 上不可靠**：shipped codex 配置改传 `--envelope`，路由卡经返回包投递实测成功。
- **matcher 不是全匹配**：`mcp__anysearch__` 匹配不到 `mcp__anysearch__search_web`（全匹配 regex）——shipped matcher 改成后缀检查项定 `.*(search_web|research_web|recall_memory|query_knowledge|ans_chat)$`，跟 namespace 无关。

### Changed

- 宿主实测事实（钉进 /docs）：codex 的 `-c` 没法表达 hooks（值按字符串解析）；hooks 必须走 config 文件层（config.toml 的 `[[hooks.*]]` 或项目 `.codex/hooks.json`）；required=true 的 MCP 会硬退出；hook trust=[hooks.state] 用 sha256 持久化；PostToolUse 的 ctx 注入是同 turn 边界可变的，索引的副作用才是持久价值。
- README 的 Verified agent hosts：新增 Codex CLI 0.142.5 行；Known Limitations 补上 0.0.4 的 Codex 三个缺口。

## 2026-09-17 — r66: 对齐 Claude Code 真实宿主的约定（返回包/schema/骨架）+ OIDC 发布通道

### Added

- `apps/plugin` 新 bin `ans-hook-claude` / `ans-hook-session-start`——hooks 命令经 PATH 解析全局安装，模板里不再有绝对路径或 `${CLAUDE_PLUGIN_*}` 变量。
- Claude Code plugin 骨架：`.claude-plugin/plugin.json` + `hooks/hooks.json` + `.mcp.json`，由 `scripts/gen-claude-configs.mjs` 单源生成（settings 模板也出自它）；在已安装的包上 `claude plugin validate` 通过。标成 **experimental**（`CLAUDE_PLUGIN_ROOT` 在 Windows 上的展开有上游 bug #16116）。
- `test/claude-contract.test.ts`（10 条）：返回包形状断言、官方 schema 校验、bin→entrypoint 解析、骨架存在性、生成器漂移守卫、拿不准就拒绝 ask、全量和瘦身两种 tool_response 形态。
- `docs/claude-integration.md`：Claude Code 接线文档（走 settings 这条路 + plugin 这条实验路 + 实测宿主事实清单）。

### Fixed

- **Claude 的决策键被宿主静默丢掉（现场抓出，ER-2）**：`adapters/claude.ts`/`session-start.ts` 原来把 `additionalContext`/`updatedToolOutput`/`permissionDecision` 写在顶层——Claude Code 2.1.251 哨兵实测：顶层 `permissionDecision` 拦不住工具执行，返回包里的 `hookSpecificOutput.permissionDecision:"deny"` 和 legacy `decision:"block"` 都能拦。全部决策键改放进 `hookSpecificOutput{hookEventName,...}`；PostToolUse 的蒸馏摘要走 `additionalContext`（Claude 没有改写输出的字段）。
- **configs/claude/hooks.json 不是官方 schema（现场抓出，ER-1）**：`{name,command,args}` 这个形状被静默接受，但会毒掉整个事件列（混进来的合法 sentinel 一起丢）。重写成 `{matcher,hooks:[{type:"command",command}]}`。
- **plugin 骨架缺失（ER-3）**：`claude plugin validate` 原来报 "No manifest found"；骨架补齐后通过。

### Changed

- README 的 Verified agent hosts：新增 Claude Code 2.1.251 行（settings 通路现场验证过；plugin 通路标 experimental）。Known Limitations 补上 0.0.3 的 Claude 两个缺口说明。
- 宿主实测事实（钉进文档/测试）：Pre/PostToolUse 钩子在 headless 下真的跑，但 stream-json 零事件（只有副作用能观察）；输入校验失败发生在钩子分发之前；`type:"http"` 的 settings 钩子被静默丢弃；MCP 工具调用触发钩子正常。

## 2026-09-16 — r65: 真实宿主部署首次接入轮（CodeBuddy 三件套 + hooks 约定对齐修复）

### Added

- `apps/plugin` 新适配器 `hooks/adapters/codebuddy.ts`：CodeBuddy Code 2.149.0 的约定——stdin 的 `hook_event_name`（兼容 `event` 兜底）、stdout 决策放进 `hookSpecificOutput{permissionDecision|additionalContext|updatedToolOutput}` 返回包、SessionStart 路由卡原文直接输出（CodeBuddy 会把 stdout 原文注入上下文）；单入口内部按事件分发三个事件。
- `apps/plugin` 新 bin `ans-plugin-server`（→ `dist/server/index.cjs`，server/index.ts 补 `#!/usr/bin/env node`）——0.0.3 里陌生人得手动拉 server 的部署缺口补上。
- `configs/codebuddy/hooks.json` 模板：`{matcher, hooks:[{type:"command",command}]}` schema，命令用 `$(npm root -g)` 解析全局安装路径（兼容 Git Bash）。
- `test/codebuddy-contract.test.ts`：16 条合成 stdin 约定测试（CodeBuddy 真实形状逐事件 + 数组 tool_response 的实物形状 + legacy 兜底 + claude 回归）。
- `docs/codebuddy-integration.md`：给陌生人看的 CodeBuddy 接线文档（install/keys/server/mcp.json/settings.json/出故障就放行）。
- README 新增 Verified agent hosts 表（CodeBuddy=第一个真实宿主条目，含验证范围和状态列）。
- `apps/mcp` 新增 `scripts/sync-domains.mjs` + `files+domains`：domains/*.toml 跟着 mcp 的 tarball 发布（镜像 cli 的 B1 机制）。
- `packages/kernel` 导出 `mapAssistantMessageEvent` 纯函数（pi-ai 的 AssistantMessageEvent→AgentEvent 文本映射，可测）。

### Fixed

- **hooks 假通过（潜伏的缺陷）**：四个适配器 + session-start.ts 读的是 `stdin.event`，真实宿主注入的是 `hook_event_name` → 部署之后就是静默 no-op。统一改成 `hook_event_name ?? event`；合成 stdin 的红绿证据对见 `.scratch/grill-round-65/evidence/`。
- **hooks 模板指向库文件**：configs/*/hooks.json 的 Pre/PostToolUse 原来指向 `dist/hooks/{preheat,distill}.cjs`（纯库、没有 main）——照着模板接线永远是静默 no-op；T3 修了 claude/codex/antigravity + 新增 codebuddy，cursor 漏掉的由审计返工（F-A1）补齐，并加上「模板目标可执行」的断言堵住盲区。
- **`configs/` 不随包发布**：`files:["dist"]` 导致模板根本不在 npm tarball 里；`files` 补上 `configs`，模板从 0.0.4 起随包。
- **plugin server 没有启动入口**：package.json 原来没有 bin；补上 `ans-plugin-server`。
- **CodeBuddy 的 tool_response 形状（现场抓出）**：真实宿主送的是数组 content blocks `[{type:"text",text:"<json>"}]`，适配器只认 string/{content:[]}/object → distill 的 `resultCount:0` 假通过。新增 `core.unwrapToolResponse` 共享解包（codebuddy+claude 接入）。
- **ans-mcp 域向全灭（现场抓出）**：`domains/` 不在 mcp 的 tarball 里，`createEngine` 也没传 `domainsDirs` → 默认链只有 `<cwd>/domains`（宿主的 cwd 永远没有）→ `ANS_DOMAIN` 在 MCP 路径上静默无效。补上包内域链回退。
- **ans_chat 上游不可达（现场抓出）**：MCP 工具只读 `ANS_LLM_PROVIDER/MODEL`，没有把 `ANS_LLM_BASE_URL/API/API_KEY` 传下去（cli chat.ts 有这套逻辑）→ v1/chat 自定义上游永远打不到。补齐 env 三件套。
- **ans_chat 永远空正文（现场抓出）**：pi-runtime 等的是 `assistantMessageEvent.type==="text"`——pi-ai 的 union 没有这个类型（真实是 `text_delta.delta`/`text_end.content`）→ 所有助手文本被静默丢掉，工具永远返回裸 "Agent completed"。修 `mapAssistantMessageEvent` + 6 条断言。

### Changed

- README 的 Known Limitations：删掉过时的「Not on npm yet」，补上 0.0.3 的三个部署缺口说明（server 手拉/模板指库/字段名假通过），各标修复落点。
- README 的 Verified agent hosts：CodeBuddy 2.151.0 的状态从 contract-verified 翻正成 **live-verified**（headless P1–P9 探针矩阵全部通过，含 with/without-tool 的 P9 对照）。实测要点：MCP 注册 `anysearch:connected` + 5 个工具全列出来；域内检索 typescriptlang.org 实答 + PostToolUse 索引 +10；OOD 查询全落在 modelcontextprotocol.io（跟 `ans search` 直调一致）；ans_chat 走 v1/chat 上游给出真实回答；recall_memory 10 条跨 3 个 sessionId；hooks 三个事件全命中（SessionStart 卡进 context、Pre/Post exit0、返回包合法）；杀掉 server 后出故障就放行正常；research_web 执行 + query_knowledge 诚实 `adapter=none`；P9 对照——没有工具时错引 `pnpm.io/npmrc#node-linker` → 有工具时实检 `pnpm.io/settings/node-modules`。

## 2026-09-16 — r64: 隔离金案例 TTL 判定收尾（mustHitPaths 页族断言 + evidence 模式 + 10 条全量 promote）

### Added

- `eval-looks.json` schema v1 增加字段：`mustHitPaths`（pathname 子串页族断言，在 mustHitHosts 范围内）/`mustNotHitPaths`（负例写死）/`stability_class`/`failure_class`/`migration`（promote 留记录的载体——promoteEntry 会物理删掉记录条目）/`watch`（promote 之后的观测标记）；根 `schema_version: 1` 哨兵。
- 现场 runner 的 `ANS_EVAL_EVIDENCE=1` 证据模式：隔离条目实跑不跳过（quarantined-but-runnable）、EVIDENCE 四元组落进 `ANS_EVAL_EVIDENCE_LOG`、只有隔离失败时 exit 0 被覆盖（EVIDENCE-ONLY-FAILURES）、连续全红 RETIRE_CANDIDATE 喂给 reviewDue()。
- `eval-looks-live-parity.test.ts`：runner 的隔离分类==isActive()（longterm/expired/retired 组合台账）+ 断言 runner 源码里没有内联判定的副本。
- ship-gate §1n R64 检查点：live mustHitUrls 的持有者≥2 且限 controlled|frozen-spec、mustHitPaths 的持有者≥1、迁移案例的 migration 块存在性机器校验。

### Changed

- runner 的隔离分类合并到 eval 记录 `activeIds()` 单一实现（原来内联判定忽略了 longterm flag——第二次判定漂移被拆掉）。
- eval-looks 的 8 条路径漂移案例（g0001/2/3/4/5/6/9/11）迁到 mustHitPaths 页族层；g0008 降格成单宿主 pnpm.io（locale-clustering-suppressed-cross-host，hops:multi 保留为 dimensions 观察）；g0010 实测恢复 answer 并入路径簇（没有走拒答改判）；3 条 frozen-spec 逐字节检查项（g0001→2026-07-28、g0005→2025-11-25、g0010→2024-11-05 的带日期 MCP spec 快照，复现率 3/3·6/6·3/3 校准）。
- 10 条隔离案例全量 promoteEntry 判定记账（9 轮 evidence 复跑记录在 .scratch/grill-round-64/evidence/；flaky 三条 flip=0；watch:true 标 g0001/4/5/6/9），eval-quarantine.json 的棘轮视野清空，TTL 2026-10-14 提前将近一个月收尾。
- README 的 Known Limitations 页级断言条目改写成页族粒度的现状。

## 2026-09-15 — npm scope 改名 + 0.0.3 重发（修 workspace:* peer 逃逸）

### Fixed

- npm scope 从 @anysearch 改成 @anysearch-cli（org anysearch 被空壳蹲着注册不了；用户建了 anysearch-cli org）。全仓 100 个文件机械替换：包名/import/tsconfig/tsup/ship-gate+install-smoke 断言/workflows/docs。
- 真事故：`npm publish <dir>` 不会对 pnpm 的 workspace:* 做 canonical 改写——0.0.1/0.0.2 的 cli/mcp/plugin manifest 带着 peerDependencies 里的 workspace:* 原文，npm install 报 EUNSUPPORTEDPROTOCOL、装不上（embedding 没有 peer，自己活着）。bin 的 "invalid and removed" 警告其实是 ./ 前缀归一化（bin 实际存在）。修复：发布通道改成 pnpm pack tarball + npm publish <tgz>（tarball 里的 manifest 已经是 canonical 的），ship-gate step5 增加断言——packed manifest 任何 dep 字段残留 workspace: 就 fail。0.0.3 统一重发。

## 2026-09-15 — r63: npm 0.0.1 的打包发布方式和验证面（T2/T3/T5，D-005/D-003）

### Added

- **Apache-2.0 license**：根 LICENSE + 4 个发布包目录各一份副本；4 个包的 manifest 补上 license/repository/publishConfig.access:public。
- 发布流程断言：ship-gate step5 校验打包的 manifest（dependencies 里没有 @anysearch-cli/* 的死声明、peer-optional 在场、license/repo/access）+ dist 里没有裸 require 内部包（embedding 按设计豁免）；隔离集的只减不增检查三条断言（scripts/quarantine-ratchet.mjs + eval-quarantine.baseline.json 基线）。
- peer-optional 双装验证：install-smoke + ship-gate 4c 断言 npm i 双装之后 @anysearch-cli/embedding 落在共享 node_modules 根、从已安装的 cli 里能解析到、doctor 的 vector arm 翻成 present。
- docs/publishing.md 发布步骤文档（含 min-release-age=2 自验的覆盖方式与 72h unpublish 窗）；docs/release-notes/0.0.1.md。

### Changed

- bundled-CLI 的打包发布方式：apps/{cli,mcp,plugin} 里的 @anysearch-cli/{kernel,store,retriever,plugin} 从 dependencies 挪到 devDependencies（已经 bundle 进 dist，如实声明成构建期）；@anysearch-cli/embedding 从全部 optionalDependencies 改成 peerDependencies+peerDependenciesMeta.optional:true（含真正 import 它的 store；npm 自动安装重型 optional runtime 这颗炸弹的回归被拆掉）；embedding 去掉 private 标记（可以发布）+ tsup ESM 构建 + publishConfig.exports 改写（开发时仍然解析 src/index.ts，tarball 指 dist/index.js）。
- install-smoke 改成消费者的真实形态：只装 3 个 app tarball，断言 bundled 的内部包和 optional peer 都不在安装闭包里。
- quarantine-ledger 增加 longterm 判定出口（把永久已知问题转换过去，QUARANTINE_MAX_LONGTERM=1 防止拿续期当漏洞）。

## 2026-09-15 — r63: T1 con_add_then_noop 修复（D-002 Blocker）

### Fixed

- consolidate 去重在 embedding 缺席时曾经整体失效：`decideOp` 只认 cosine>0.90，arm 缺席时（只用 FTS 安装/离线）bestCos 恒为 0，重复记忆一律判 add——`con_add_then_noop` 在没网的环境里必红。现在加了降级分支：没有 cosine 可算时，bestJac>θ_jac（0.80，golden 校准：相异 stub=0.000/同一 rerun=1.000/矛盾对上限=0.714）判 noop。行为变化：没有 embedding 的环境里，几乎一字不差的重复记忆开始判 noop（有损降级，抓不到改写级别的重复），降级决策计入 `ConsolidateReport.embeddingAbsent`（不再沉默）。

## 2026-09-14 — r60: 审计修复（audit F1–F3 + F5，reports/2026-09-14-audit.md）

### Fixed

- 域解析链收尾（F1/F2）：`domainTomlPath` 现在读 `ANS_DOMAINS_DIR`（env → cwd → extras，跟 `defaultDomainsDirs` 链头同序）；`ans chat`/`ans hitl` 走 `domainSearchDirs()` 四链；`ans pref` 改用 `createPersistentEngine`——顺带修掉 `createEngine` 默认 `:memory:` 导致偏好从来不写进文件的存量 bug。
- 覆盖清单的算术（F3）：`source-tier.reference` 3→4、`freshness.stable` 6→5；`crossCheckDocsGolden` 新增 classes 和 entries 的直方校验，`badcase-backfill` 重算时同步 classes。
- `badcase-backfill --new` 不再编造分类：badcase 记录必须自带 intent/questionLang/dimensions（缺了就拒），provenance.type 可以被记录覆盖；三处台账写入改成原子写（tmp+rename）。
- `engine` 的早停阈值按 `normalizeUrl` 算唯一 URL（跟融合去重的标准一致）；`ans domain`/doctor 的域列表改用共享的 `listDomainTomls`；doctor 删掉 `fileURLToPath` 这个没用到的 import。

## 2026-09-14 — r60: graceWindow/deepMode 交付（T6/G1，remove-or-implement → implement）

### Changed

- `RetroaererdEngine.search` 真的接上了早停：融合后的结果池覆盖 `q.maxResults` 个唯一 URL 之后，落后的 provider 再等 `graceWindowMs`（默认 1500）就触发 per-provider AbortController；`deepMode` 等于全部等齐。被取消的进 `metadata.providersCancelled`（之前一直是空的）。
- 哨兵翻正：ship-gate step1c + t6-hostile-cuts 从「待办标记还活着」的断言改成「接线还活着」的断言；CONTEXT.md 里「还没接线」的措辞删掉；ponytail-debt-ledger 移进 Resolved。
- engine.test.ts +5 条断言：grace 取消上报/abort 真的发出、deepMode 不取消且慢 provider 的结果能到、没到阈值时所有 provider 都等。

## 2026-09-14 — r60: doctor 自服务增强（T4/B3）

### Added

- doctor [4] 补充：ANS_DOMAINS_DIR 可见化、持久 DB 路径 mkdir+可写探测。
- doctor [5] 补充：当前领域 sources.enabled 逐 provider key 覆盖检查——没设 key 记 SKIP 并给两个方向的修复路径（设 key 或从 enabled 里移出去）；域不在解析链/链上没有 TOML 时点名具体的修复命令。
- `ans domain` 解析失败时列出可用的域 + ANS_DOMAINS_DIR 修复指引，并明说「静默全同时查多个源」的语义。
- clig.dev 收尾：doctor 的失败摘要走 stderr（exit 0/1 不变）。

## 2026-09-14 — r60: badcase→golden 回灌跑通（T3/B4）

### Added

- `eval-badcases.json`（schema `anysearch/eval-badcases@1`）：真实 badcase 的记录面，种子条目 docs-bc0001 来自安装物的实跑（tokio 域外提问应该拒答，实际回了 10 条不在 allowlist 里的结果）。
- `scripts/badcase-backfill.mjs`：回灌两种模式——`--into` 把同一个问句附加到已有的 golden（回归证据），`--new` 生成下一条 docs-gNNNN 并自动重算覆盖清单；没有 observed/evidence.command 就拒绝回灌（禁止合成的保护措施）。
- eval-docs-golden.test.ts 扩出 badcase 回归段：badcase schema、promotedTo→golden 可解、attach 问句逐字一致、open 态的内容不得已经进集。

## 2026-09-14 — r60: 从装到用的链路 CI（T2/B2）

### Added

- `scripts/install-smoke.mjs`：真实的从安装到使用链路——pack 全部 7 个 workspace 包 → npm 干净前缀安装 → 安装出来的 `ans` bin 走 --version/doctor/domain docs/doctor/search。online 有 key 时硬断言 ≥1 个结果并且命中 docs allowlist 的主机；没有 key 就断言文档化的离线行为（exit 1 / Results: 0），不造假覆盖。
- `.github/workflows/ci.yml` 的 `install-smoke` job（ubuntu+windows 矩阵）：build 之后跑 install-smoke；EXA/TAVILY key 走 secrets，缺了就断言离线路径。

## 2026-09-14 — r60: docs 域走路骨架（T1/B1）

### Added

- `domains/docs.toml`：第一个垂直域（技术文档检索）。语料一手的 allowlist：modelcontextprotocol.io / typescriptlang.org / pnpm.io（D-004 第一批实例化）。
- `eval-looks.json` 顶层 `golden` 集合（schema `anysearch/docs-golden@1`）：第一批 11 条全真源提问（8 条 internal-dogfood + 3 条 external-community），每条都能按来源字段回访；OF 那份记录 looks[] 的语义不变，读写路径保持透传（looks-ledger.ts / eval cli calibrate）。
- `eval-looks.coverage.json`（schema `anysearch/eval-looks-coverage@1`）：八个维度的切片清单，covered×7 + deferred×1（injection，entryTrigger 挂 B4）。
- `packages/store/src/eval/docs-golden.ts`：条目 schema + 八个维度的词表 + 清单/交叉校验器。
- `loadDomainByNameIn` + `defaultDomainsDirs`（domain-loader.ts）：多目录解析链；`createEngine` 新增 `opts.domainsDirs`；`domainTomlPath` 增加可选的附加目录。
- `apps/cli/src/config-env.ts`：config.env 共享读写 + 入口 rehydrate（`ans domain` 的持久化从此对所有命令生效，显式 env/空串不会被覆盖）。
- `apps/cli/src/db.ts` 的 `domainSearchDirs()`：ANS_DOMAINS_DIR → cwd/domains → 包内建 domains → 仓根 domains 的解析链。
- `ans doctor` 新增 `[5] Domains` 段：解析链逐目录发现 + 逐 TOML 校验 + 当前领域五个下游层（sources/skills/hooks/prompts/rag）可见。
- @anysearch-cli/cli 打包 domains/（files + build 期 sync-domains.mjs 从仓根同步）；测试：eval-docs-golden.test.ts（27 条断言）、domain-loader.test.ts 链路用例、e2e doctor [5] 断言。

### Fixed

- 安装后 `ans` 因为 shebang `#!/usr/bin/env tsx` 启动不了（tsx 不是运行依赖）——走路骨架第一次实装时暴露；改成 `#!/usr/bin/env node`。

## 2026-09-02 — r42: implemented the consumed/synthetic switch

### Added

- 状态机 S0-S4 (-D6): a pre-registered readiness trigger (C1-C4 wall clock, k_max=10), SESOI-band reconcile plus a McNemar diagnostic (packages/store/src/eval/switch-machine.ts, pure core), graded rollback with an Inconclusive hold (promote streak 3 > rollback streak 2 hysteresis), integrity lineage fail-closed, and a reversible freeze driven by evidence.
- Pre-registered thresholds stored as data (version + hash): packages/store/fixtures/switch-registration.json; every verdict records registrationHash.
- skip-ledger schema @3: a state block (phase, since, transitionId, evidenceHash) plus an actions log (actions never touch the 3-streak); @1/@2 upcast losslessly; unknown versions fail loudly.
- access_events chain switch events (stage-transition/rollback/freeze) with a sentinel-row foreign key, writing the chain before the ledger; the ledger can be rebuilt from the chain as a fallback.
- `ans switch-state [--verify] [--db PATH] [--out DIR]` read-only query.
- ship-gate step 7 reports the current switch phase (exit semantics unchanged).

### Fixed

- bgnbd/obs-fixtures/switch-run no longer evaluate `fileURLToPath(import.meta.url)` at module init — once @anysearch-cli/store re-exported the switch modules, the CJS CLI bundle crashed every ans command at startup.

## [Unreleased]

### Added

- (T-1 / F-15, round 58): evaluation has two grades. The merge gate (ship-gate step 7) only observes and never spends a pre-registered OF look (ANS_EVAL_NO_LOOK=1); decision grade moved to a new `release` workflow (pre-tag dispatch = the only formal look; post-tag only asserts the recorded verdict is still valid and spends nothing). The OF look ledger moved from the local `.ship-gate/eval-looks.json` to the git-tracked repo-root `eval-looks.json` (`anysearch/eval-looks@2`, append-only, 50-row compaction cap, pre-compaction SHA-256 preserved); a look is written only when ANS_EVAL_LOOKS_WRITE=1, so CI and local runs leave the tracked file untouched. ship-gate.yml Node 24 -> 22 to match ci.yml.
- (T-2 / F-17, round 58): flaky cases are quarantined. When a case is flaky because of the environment, a policy mark quarantines it (`packages/store/eval-quarantine.json`, `anysearch/eval-quarantine@1`) — the golden set and dataset fingerprint stay untouched, so recalibration costs nothing. The gate excludes active quarantined cases from the passRate==1 hard assertion and says so; 30-day TTL, weekly review, at most 2 renewals, promote/retire paths. The eval CLI now names failing cases on gate failure, so a CI log identifies an environment flake without the report artifact.
- (T-5, round 58): the README ADR index is generated. `scripts/gen-adr-index.mjs` (Node stdlib only) owns the `BEGIN/END ADR-INDEX` block derived from `*.md`, and ship-gate step 1b runs it in `--check` mode (regenerate and diff), so the index cannot lag silently. The one-time catch-up replaced the stale range with the real 0001-0059 range and the full 59-row index.
- (T-6, round 58): four adversarial-review fixes. (1) The engine's dead config was fixed **by documentation**: CONTEXT.md no longer claims a grace window is implemented, gains an append-only r58 errata, and ship-gate step 1c asserts the honest engine-debt note survives. (2) `ans doctor` prints the real version via the tsup `__PACKAGE_VERSION__` define instead of reading package.json at runtime (after bundling that resolved to the repo root). (3) Plugin server trust boundary (highest priority): loopback Host whitelist, Origin check (no Origin = native client), auto-generated 256-bit token when ANS_SERVER_TOKEN is unset (persisted 0600 for the hooks), crypto.timingSafeEqual, 1MB body cap, 403 before 401; wildcard CORS removed. (4) api.anysearch.com ownership deferred **with a deadline**: named owner + quarterly review + CT/expiry monitoring in docs/deferred-registry.json and an annotation block in anysearch.ts.

### Removed

- round 59 housekeeping: removed the `t6-hostile-cuts.test.mjs` text-position assertion that `403` comes before `401` — it pinned source order, not behaviour; the behaviour is asserted end-to-end in `apps/plugin/test/plugin-security.test.mjs` (non-loopback Origin without a token -> 403 before 401).
- round 59 housekeeping: the `apps/plugin/src/hooks/preheat.ts` comment no longer says the policy cache guards against a *tampered* drop-in (downgraded to a *damaged* drop-in — the sha256 self-check detects damage, not an attacker), and `canonicalVersion` now names the store implementation as authoritative.
- D-001/R1 (round 57): `.scratch/` is no longer tracked. The local markdown issue tracker and round artifacts were tracked as 16 files while README.md:64 documents them as not committed; all 16 are now untracked (disk copies kept; `.gitignore` gained `.scratch/`). Commits `ykm` (first 8) + `rpz` (remaining 8, audit F-1).

### Fixed

- r110 audit repair round (two-axis review of the r109 implementation; all findings fixed in one round — SP-F-01..03 + SA-F-01..09):
  - SP-F-01/SA-F-05 (severe): the consumed track's AND-gate input was hardcoded to zero and fully disconnected from access_events, and the data-absent classifier only fired when there were no events at all — so a healthy eval always logged gate-not-met and the 3-streak fired spuriously (ship-gate exit 1). Now the runner aggregates real unit-level stats (events/units/fittableUnits/access-time span), and D4 "structural data absence" covers "events exist but nothing is fit-eligible" — both the empty library and the populated-but-immature form record reasonCode=data-absent and never build the streak.
  - SA-F-01: non-finite PSI is fail-closed at the AND-gate (NaN can no longer slip past the >= comparison).
  - SA-F-02: skip-key identity excludes volatile numbers (normalized to '#') — the 3-streak now matches on which gate clauses failed, so identical conditions across runs actually reach escalation.
  - SA-F-03: unknown/corrupt skip-ledgers are never silently cleared; reading fails loudly (SkipLedgerError), and the eval CLI moves the file aside, restarts empty, and says so on stderr.
  - SA-F-04: fixture definitionHash pins generatorVersion + per-file SHA-256s (generator bumped to v2) — a generator contract change flips the fingerprint (the declared flip 5be13f8abcfab1f9 -> re-baselined via --calibrate).
  - SA-F-05: the observational zone carries an explicit dataAbsent boolean; the report zone no longer presents structural absence as an unexplained gate-not-met.
  - SA-F-06: fixtureDefinitionHash is recorded in the observational zone (and in eval-baseline.json after calibration) — fingerprint flips are auditable from the artifact.
  - SA-F-07: the tau-python.yml regeneration guard triggers on day-buckets.ts, and the fixture loader hard-rejects a baselineHistogram whose keys drift from AGE_BUCKETS.
  - SA-F-08: skip-ledger writes are atomic (tmp + rename), so a concurrent or crashed eval cannot leave a half-written ledger.
  - SA-F-09: @2 entry-level validation (tier/track enums; green rows must omit reasonCode, warn/data-absent rows must carry one); @1 upcasts keep green rows reason-free.
  - SP-F-02/03 (nits): the runtime SHA-256-vs-MANIFEST check is now documented as an anti-miswire guard only (CI regenerate-and-diff is the tamper anchor); a missing MANIFEST yields an explicit "no-fixtures" marker plus a stderr warning instead of a silent fingerprint drift.
- r39 deferred items F-07 (staircase automation tests) and F-09 (report subject digest) remain deferred (tracked; r110 does not own them).

### Added

- Observational data feeding (r109 implementation): dual-track loader (consumed = real access_events preferred; synthetic = hash-pinned fixture fallback via `ANS_OBS_FIXTURE`, with the track marker enforced at load so synthetic rows can never pose as consumed data) + a pure-stdlib offline generator `scripts/tau/generate_fixtures.py` (mulberry32, byte-deterministic, `--check` exits 2 on drift) that produces four falsification fixtures (`packages/store/fixtures/obs-feed/`: pass-stable / t1-fail 299 rows / t2-fail PSI>=0.25 / t3-fail 89d window) with a SHA-256 MANIFEST and a definition hash pinned into the eval baseline fingerprint — the initial flip 113be271869dbc54 -> re-baselined is the declared one-time fingerprint flip (definitionHash `f5c6c438f3696995` joined). skip-ledger schema @1 -> @2 (track + reason-code split; data-absent never builds the 3-streak and resets an in-flight gate-not-met run; @1 ledgers upcast losslessly on read, closing r106 F-08; scripts/gain-ledger.mjs resolve accepts @2). Synthetic runs are labelled simulated-observation-window in the report. CI: a regenerate-and-diff guard step in tau-python.yml. New tests: obs-fixtures.test.ts (24 asserts, gate-ok -> ready-to-spawn via node stub) plus the eval-skip.test.ts ledger-semantics block.
- access_events tamper-evidence layer (r102/r103 implementation): `prev_hash` SHA-256 hash chain (six-field canonical contract: fixed key order = RFC 8785 lexicographic for the closed ASCII scalar schema, NULL = JSON null, INTEGER/TEXT/NULL whitelist) + a single-row `access_chain_anchor` sealing legacy history as a one-off digest snapshot (lazy IMMEDIATE constructor bootstrap, one defensive BUSY retry, busy/IO degrade = stderr WARN + telemetry bit) + an independent zero-shared-code verifier `scripts/verify-access-events.mjs` (fork detection, legacy digest recompute, unknown schema_version = explicit error, exit 0/1/2) wired fail-closed into ship-gate step 1 (no DB -> explicit skip + `access-chain-skip-ledger.json`, 3-streak escalation) + an alert-on-silence `eventWriteFailures` counter joined into the eval observational zone + `ans access-chain bootstrap [--dry-run default | --apply]`. Six zero-dependency test files (3+2 golden vectors pinned, 4 tamper classes + seeded legacy, no-DB exit 2, real-spawn dual-process concurrent bootstrap, telemetry/idempotency/legacy byte stability, 100k-row perf smoke report-only + schema forward/back + whitelist negatives). No dataset fingerprint flip — the chain never touches golden cases; baseline fingerprint 113be271869dbc54 verified unchanged (flip rule evaluated, not triggered).
- tau observation layer (r100 implementation round): access_events append-only log joined into eval per-case observation; pre-registered day buckets (0-1/2-7/8-30/31-90/91+, [min,next-min) semantics + dayBucketFingerprint) folded into datasetFingerprint so any bucket change forces recalibration; synthetic tau-scan (seeded mulberry32, kendall@2, shipped as `node scripts/tau/tau-scan.mjs`); BG/NBD out-of-process fit via `scripts/tau/bgnbd_fit.py` on the frozen lifetimes stack (numpy==1.26.4, autograd==1.7.0 pinned below numpy 2 — see r100 amendment) behind a hardened spawn wrapper (timeout SIGKILL; non-JSON/non-converged map to explicit skip); three-tier explicit skip (gate-not-met / offline-deferred / infra-failure) with TAU_FIT_GATE T1+T2+T3 and a skip ledger (anysearch/gain-ledger@1 shape, resolve via gain-warn-resolve.mjs); the eval report observational zone is a ship-gate contract. r99 text errata physically applied (D2 full-sample rule failure is WARN not red; D6 single WARN ships with a ledger entry, three consecutive escalate).
- The relation arm's gain gate is now a three-tier GREEN/WARN/RED verdict — RED only on proven-negative evidence (BCa upper < 0 or harm-side sign-flip p below the look budget); unproven-positive is WARN, never RED. Dual-track holdout: 40-case frozen baseline slice (19 RoR pairs) with a second fingerprint plus a backflow slice family (inputHash dedup vs baseline, cross-slice, payload provenance). Preregistered Lan-DeMets OF alpha spending (0.025 per track, k_max=5, convergence clause past k_max) with a per-fingerprint look ledger (.ship-gate/eval-looks.json). ship-gate enforces the tier: RED hard-fails, GREEN passes, WARN is released but three consecutive WARNs force `node scripts/gain-warn-resolve.mjs`. Graded relevance labels (0-3) on 39 cases feed report-only nDCG@5/10/20 plus a dual-review record (relevance-review.json, kappa/AC1 = 1.0 on 610 label pairs) as the judge-calibration baseline row.
- `ans consolidate` and `ans memory forget --undo` CLI; durable maintenance DB via ANS_DB_PATH (default ~/.anysearch/anysearch.db); semantic_memories sixth RRF arm <!-- machine-local: 用户级 ~ 路径引用（存量合规化） @ 2026-09-22 --> (serve, weight 0.5, conditional activation, fail-closed regression gate); three-protocol LLM endpoint config (ANS_LLM_BASE_URL + ANS_LLM_API=chat|messages|responses + ANS_LLM_API_KEY).

### Removed

- kernel llm-init residual env fallback (OPENAI_/ANTHROPIC_/GOOGLE_API_KEY): the kernel no longer reads provider env (step 7); provider auth stays entirely inside pi-ai. This is r94-deferred cleanup, shipped as its own refactor commit.

### Fixed

- r94 audit (atomcode Spec-1): single-query searchMemory resolved the semantic arm through a byId map that was never populated with semantic hits — the sixth arm was silently dropped on that path (the MCP recall_memory consumer). Fixed + regression test.
- r94 audit (atomcode S1): kernel llm-init read ANS_LLM_API_KEY from the environment, violating its own "no env reads in kernel" contract; callers now pass the key explicitly.
- r94 audit: the applyArchive explicit-ids path now enforces pinned / closed / quarantined exclusions at the force point; LLM summarize moved out of the BEGIN IMMEDIATE write lock (plan/apply split; dry-run exact prediction unchanged); `ans consolidate` rejects unknown flags (exit 2).

## [0.1.0-rc.0] — 2026-08-22

### Fixed

- r90 audit: D5 RoR delta sign convention corrected in the docs and CONTEXT.md (positive = the relation arm pushed the memory earlier; the docs had it inverted while code/tests/baseline used positive=helps — the regression trap is removed).
- r90 audit: the backfill retry counter snapshot now also covers `relatedToWriteOnce`, so a failed batch retry no longer double-counts that telemetry bit; the busy-injection test now holds the foreign lock past busy_timeout (5200ms) so the exponential-backoff branch actually runs (a 150ms hold was absorbed by busy_timeout).

### Added

- ship-gate pipeline: `scripts/ship-gate.mjs` (Node stdlib, single file) as the blocking product smoke check, plus a non-blocking `modelcontextprotocol/conformance` workflow as the protocol heartbeat.

### Added

- 新鲜度权重 [0.3, 1.5] 进 store 排序 — creation-age decay, `last_accessed` recency, and `access_count` frequency fused into one multiplicative band (`freshness_factor()` UDF replaces `time_decay()`). `access_count` added by idempotent migration; every returned recall hit increments it exactly once, on both `searchMemory` and `searchMemoryMulti`.
- kernel `memory-pipeline.ts` now imports `isTimeSensitive`/`isEvergreen` from `@anysearch-cli/store` (inline regex copy deleted; the QDF regex itself no longer carries year literals).

### Removed

- dropped `--write-baseline` from `packages/store eval` (the one-round alias for `--calibrate`).
- retired the `w` interpolation weight (0.25/0.4) and the `1 - w·(1-decay)` fusion form. Ranking is a direct multiplicative scaling band now.

### Infrastructure

- 16 prior ADRs landed across rounds 1–17 (MCP Phase2, Kernel Engine composition, the two-generation SDK bridge (v1+v2), TypeBox source of truth, plugin hooks layer, SessionStart routing, L0/L1 memory pipeline).

### Added

- entity-relation arm (fifth RRF arm, weight 0.5): closed 8-predicate table (`works_on/depends_on/uses/part_of/member_of/located_at/authored_by/related_to`) with EN+CN alias map, rule-first extraction (verb frames + url<->handle bridge + 2-preKnown co-occurrence), single-call LLM seam behind a strict post-filter (JSON degrade parse, never blocks the write path), edges table with partial-unique active index and episode provenance, merge redirects edges inside the combine transaction with snapshot-driven bounded unmerge restore, `pendingEdges` gauge + relationTel counters, golden `relations` group (12 cases: 8 predicate positives including CJK quoted, fail-closed supersede, observational no_edge + 1-hop hit rate), ship-gate 1j static + relation-zone metric assertions.
- `ans relation list` + `ans relation backfill-relations` (dry-run default, keyset pagination, `--reprocess` supersedes stale rules_version rows, exit codes 0/1/2).

[0.1.0-rc.0]: https://github.com/anysearch/anysearch-cli/releases/tag/v0.1.0-rc.0

### Added

- relation-arm gain observance (Phase-1): single-run counterfactual ablation for the relation arm — SqliteSessionStore captures arm provenance per searchMemory call; the eval runner drops the relation list and recomputes RRF, producing paired rank deltas for every expectRankOf golden op. Gate statistics: paired BCa 95% CI (seeded mulberry32 bootstrap + jackknife), one-sided sign-flip permutation p, Sakai sample-size lock (cap 80), chi-square upper sigma_d. Decision rule (BCa lo > 0 AND mean >= minGain AND signFlip p < 0.05) fails closed; under-powered / degenerate / missing-baseline downgrade to WARN. Golden relations group expanded 12 -> 78 (30 EN + 8 CN RoR pairs with a 14-memory distractor corpus, 14 EN + 8 CN alias edges, 6 no_edge negatives); baseline recalibrated over 50 seeded runs (sigmaDU=0.102, lockedN=17). New test eval-relation-gain.test.ts.

### Changed

- (Phase-2): `ans relation backfill-relations --apply` now commits one IMMEDIATE transaction per batch (was one whole-run transaction), retries SQLITE_BUSY with exponential backoff (50ms base, 5s cap, <=8 tries, aligned with busy_timeout=5000), fails fast on SQLITE_BUSY_SNAPSHOT, and runs a passive WAL checkpoint after each committed batch. The dry-run path keeps the single rolled-back transaction, so counters remain exact predictions (r87). The "no concurrent MCP traffic during backfill" constraint is relaxed to recommended, not required; CLI help and wording updated. Regression coverage: per-batch exact parity and live-writer contention in relation-edges.test.ts.
