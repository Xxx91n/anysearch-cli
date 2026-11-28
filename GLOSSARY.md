# GLOSSARY

本仓唯一权威词表，每条一句话说清这东西是什么、实际干什么，代码里的真名写在括号里；实现细节看代码，决策历史看 git log 和 issue。

## 产品与领域

- **垂直领域 agent**:只在一个领域里干活的 agent，站在通用搜索之上做深度研究，自己不做索引（代码里叫 verticalDomain）。
  _Avoid_: Vertical Agent、垂直 Agent

- **当前领域**:当前选中的领域，由一份 TOML 配置决定用哪些信息源、哪些 skill、哪些工具（代码里叫 Active Domain）。
  _Avoid_: 活跃域、激活域

- **信息源**:一个对外的搜索入口，比如 Exa、Tavily 或 anysearch 通道，由领域配置决定开哪几个、各占多少权重（代码里叫 SearchProvider）。
  _Avoid_: Info Source Provider、信息源头供应方、搜索后端、检索后端、搜索源、搜索服务

- **免费额度**:没配 key 时信息源自己给的免费档，照样能发请求，但有次数和速度上限，不像有 key 那样稳。`credentialSources` 里这一臂记 `none`，那只说明没配 key，不说这一臂不干活，也不说它建没建起来（代码里叫 CredentialSourceLabel 的 `"none"`）。用户凭据文件本身坏了的时候这一臂也会记 `none`——那不代表这台机器没配过 key，看同一记录里的 `credentialFileFault`。
  _Avoid_: keyless、匿名调用、匿名层、无 key

- **领域检索适配器**:把企业内部数据接进对话的配置项，接不接、接哪种由领域配置决定（代码里叫 RagAdapterPort）。
  _Avoid_: RAG Adapter、领域专属检索适配器

- **宿主插件**:装进各种 agent 宿主的插件，带钩子、长驻 MCP server 和项目索引（代码里叫 `@anysearch-cli/plugin`）。
  _Avoid_: Anysearch Plugin、插件形态

- **技能安装器**:把本地仓库里带 `SKILL.md` 的目录装进 skills 目录，并记下来源方便以后更新（代码里叫 skill-store）。
  _Avoid_: Skill Installer、最小安装器

## 检索与运行时

- **统一装配入口**:启动时把信息源、存储、运行时拼到一起的入口，CLI、MCP、插件三处共用（代码里叫 createEngine）。
  _Avoid_: Composition Root、组合根

- **检索引擎**:把问题发给多个信息源、合并结果、检查证据够不够、按预算停下来的那套流程（代码里叫 RetroaererdEngine）。
  _Avoid_: Retrieval Engine、检索专精引擎

- **一次检索的结果包**:一次检索返回的全部东西，包括结果、来源、状态和够不够用的判断（代码里叫 FusedEnvelope）。
  _Avoid_: Envelope、检索信封

- **读页**:内部 agent 拿一个本会话的句柄换一页正文；正文整页进资料库，模型当轮只看截到 4000 字以内的副本，没抓到或不让抓都回一句普通工具错误，不中断这一轮（代码里叫 `fetch` 工具 / FetchProvider）。
  _Avoid_: 抓网页、爬页面、下载页面

- **票据**:本会话里允许模型读哪些页的凭据。搜索结果给 `m:<行号>` 票，用户自己贴的网址给用户票，用户明确信任过的域名给 TOFU 票（见下条）；模型自己编的网址、页面正文里的链接、别的会话的句柄都没有票，抓不了（代码里叫 `fetch_tickets` 表）。
  _Avoid_: token、通行证、白名单条目

- **会话内一次信任（TOFU）**:交互式 CLI 里，用户看过完整网址、明确同意后，给一个主机名发的本会话临时票。只对这一个主机生效，不扩到子域。模型自己发不了；headless/MCP 不弹确认，直接拒绝，让用户把链接贴进来。信任的主机名同样过地址门、deny 门和白名单硬上限，越不过 deny；不写 TOML、不跨会话、不占页数和网址数（代码里叫 `tofu` 票）。用户答过的主机（拒绝，或票写不进库）本次运行不会再问，拒绝文案也不再劝模型再试；刚答完的那一次拒绝不计入整批被拒软停（是人做的决定）。一次提问最多问 3 次信任确认，超过就不再问。信任还有自己的一条线：连续两次问出去却谁都没问（额度用完了、这个主机答过了、headless 问不了、或者 `requestTrustFor` 本身写错/主机对不上），这一轮就不再受理 `requestTrustFor`——这个参数会被忽略，不是整次调用被拒，handles 照常走普通放行，手里能读的网址照读。信任路上被地址门、deny、白名单、凭据门拒的主机照常计入整批被拒（那些门本来就在判断这个主机）。
  _Avoid_: 永久信任、自动放行、站点白名单

- **多源并发查找**:同时问多个信息源，先回来的先用；最多等到请求总上限（默认 4s；`ans search --deadline` 可改这一次，范围 500–60000ms），还没回来的就不再等（代码里叫 fanout）。

  _Avoid_: 扇出、并行检索

- **证据够不够的检查**:看结果数量、来源数量、分数分布，判断要不要再搜一轮（代码里叫 computeSufficiency）。
  _Avoid_: Sufficiency Gate、充分性门禁

- **专线**:一次检索里指定了垂直领域（哪个域、哪个子域、什么参数）的那条路；结果上标在 `extra.vertical`，只有 anysearch 这一路会写（代码里叫 `vertical`）。它说的是一次请求走的路由，不是干活的 agent（那个叫「垂直领域 agent」）。
  _Avoid_: Vertical Channel、垂直通道、垂直线

- **预算记账**:记录一次运行的调用数、token 和美元用量，调用或 token 额度不够就拦住运行，美元只在跑完后结算（代码里叫 BudgetLedgerPort）。
  _Avoid_: Budget Ledger、预算账本

- **预留**:调用前先占住一块额度，跑完再按真实用量结掉；占住的那块在结之前也算进「已经用了」，所以额度不够时下手就被拒（代码里表现在 reserved_tokens / reserved_usd / reserved_calls）。
  _Avoid_: Reservation、占额

- **预留属主**:这条预留是哪个进程占的，记成机器名加进程号；只有本机确认那个进程已经没了，别人才能把它占的那块放回去（代码里叫 budget_reservations 表）。
  _Avoid_: Owner、持有者

- **无主余量**:账上算着占了额度，但找不到是哪条预留占的，只剩一个数。老版本（v0.1.2 及更早）写下的就是这种。现在有意不清它——清了没法证明老进程真没了，还在跑的老进程就会和新进程一起花同一会话的额度；恢复办法是新建一个会话（见 #279）。
  _Avoid_: Unowned residue、孤儿预留

- **任务**:一次 CLI 命令执行（后面 MCP 每次请求也算）的身份，记下种类、角色、哪个进程跑的、什么时候结束、退出码多少。上下文归会话管，额度归任务管——升级准入靠这张表知道"还有活没干完"（代码里叫 task_records）。
  _Avoid_: Task、任务记录

- **任务预算**:一次执行自己的一份额度账，按任务号记，和会话账分开。主调用、压缩、摘要、重判、迟到结算、这次执行里的搜索，还有独立整理自己的模型调用，全落这条账；搜索和研究的多轮也共用这一份。换个任务就是新账，续聊不吃历史额度。声明了预算却建不起来时，运行直接停，不放行成不计费（代码里叫 task_budgets / TaskBudgetScope）。
  _Avoid_: Task Budget、执行预算

- **进程登记**:进程自己的存活期记录，跟任务分开两张表。常驻 MCP 的整段存活期只是一条进程记录，不是一条永远完不成的任务（代码里叫 process_records）。它和任务历史共用一个保留窗口，同样只由人跑 `ans upgrade prune` 清、删前留快照。已收尾的行跟任务历史一个口径：过了窗口就删。开着的行是「这个入口可能还在跑」的唯一证据，默认不碰；例外只有一种——同一台机器、本机确认那个进程号已经不在了、且过了窗口，这三条同时成立才可清（进程号还被占着就当作还活着：可能被别的进程复用了，宁可留错也别删错）。别的机器记的**开着的**行永远不删：本机证明不了它的进程在不在（代码里叫 processPrunePlan）。
  _Avoid_: Process Record、进程表

- **任务收尾**:一次执行结束的那一刻——本次的迟到结算、后台摘要、观测写入都走完，任务行才写上结束时间和退出码。上游连接一直不关时，那笔补记的用量会在收尾之后才落账，取消的回复里写清楚是哪一种（代码里叫 closeout / McpTaskCloseout）。
  _Avoid_: Closeout、收尾状态、task done

- **后置工作**:一次请求做完之后才该干的活，比如钩子把搜索结果写进项目索引、读网址规则时补一条审计记录。它跟新来的请求不是一回事：可以等原来那次先结束再开始，也算「还有活没干完」（代码里叫 origin='follow-up'，跑在钩子服务里、entry='server'）。
  _Avoid_: 异步尾巴、fire-and-forget、background task

- **后置工作的归属**:每条后置工作记着自己是从哪次任务来的。那个任务是真存在的一行就记上链接；找不到（别的机器、库被清过、传错了）就记成「不知道」，不硬凑一个指向空气的号（代码里叫 parent_task_id，读出来看 parentLink）。
  _Avoid_: parent id、父任务字段、归属关系

- **升级准入**:现在还不收新活的那个开关。关着的时候，新的一次干活/付费请求当场被拒（退出 4 或 `errorKind: upgrade-in-progress`），不排队、不事后重放；管理类命令（`ans upgrade`、doctor 这类）和已经接下的请求的尾巴照常放行。它是一行记在持久库里的记录，不是某个模块里的标志，所以每个入口看的是同一个开关（代码里叫 upgrade_gate / AdmissionClosedError）。
  _Avoid_: 封门、admission gate、暂停开关

- **升级预检**:换程序之前先问一句「现在行不行」，只读不改：谁还开着活、哪些进程本机确认不了、准入开没开、装的是哪一版、谁还在旧版上（`ans upgrade status`）。它在准入关着的时候也能跑，这正是它有用的地方。
  _Avoid_: preflight、升级检查

- **磁盘版本**:包根下 `dist/build-info.json` 记着的那一版，也就是下次启动会用到的那份代码。它不等于正在跑的进程用的那一版——换文件不会让已经在跑的进程跟着换。
  _Avoid_: 已安装版本、installed version

- **执行版本**:一个进程启动时自己记下的那一版（进程记录里的 build 列，形如 `0.2.0+cbefccab`），写一次不改。它和磁盘版本不一样，就说明这个入口还跑着旧代码（代码里叫 process_records.build）。
  _Avoid_: 运行版本、running version

- **待重连**:磁盘已经换成新版、但某个入口进程还在执行旧版的状态。按 D1 靠重启或重连换版，不承诺透明热换；报告把「跑的是旧版」和「没记是哪一版」分开列，不把后者当旧版（`ans upgrade status` 的 `[重连]` 段，`--json` 里的 `stale`）。
  _Avoid_: 待升级、pending restart

- **暂停记录**:`ans upgrade wait` 等干净以后写下的一份「等干净的时候磁盘上是哪一版」（`~/.ans/.upgrade-pause.json`）。`ans upgrade finish` 拿它当基准：磁盘上还是同一版就拒绝报完成。写在数据根而不是程序目录，因为换版会把程序目录整份换掉。
  _Avoid_: 升级状态文件、lockfile

- **换版历史**:过去几次「从哪版到哪版、什么时候、哪几个入口还要重连」的记录，留最近 20 条（`~/.ans/.upgrade-history.json`）。`ans upgrade status` 报最新那一条；「还在旧版」和「没记是哪一版」在记录里也是分开的两栏。
  _Avoid_: 升级日志、changelog

- **旧布局**:0.2.0 以前那种「三个全局包各装一次」的安装形态（`@anysearch-cli/cli`、`@anysearch-cli/mcp`、`@anysearch-cli/plugin`）。三个包往同一个全局 bin 目录写命令，名字被两边同时声明时谁最后装谁赢，于是「装的是哪个版本」和「命令实际指向哪个包」可以不一致。`ans upgrade install` 只看不删，`--apply` 才卸掉真的在抢命令名的那些包。
  _Avoid_: 多包安装、legacy install

- **安装判定**:`ans upgrade install` 对一个 npm 全局前缀给出的四种结论之一：`clean`（只有一个完整产品，命令都指向它）、`legacy`（旧包还在或命令还指着旧包，可按方案换）、`blocked`（有命令认不出归属，一个包都别动）、`absent`（这里没装过）。`blocked` 时连安装建议都不给——那会覆盖别人的命令。
  _Avoid_: 安装状态、install status

- **放弃收尾**:一条收不了尾的任务行，由人明说「这条没人管了」并写明理由，之后不再算升级阻塞。它不写成「任务已完成」——结束时间还是空的，只多一条谁、什么时候、为什么（代码里叫 dismissed_at / dismissed_reason，`ans upgrade dismiss`）。
  _Avoid_: 清理、扫尾、dismiss

- **任务历史**:已经收尾的那些任务行，是用来查「上个月都跑了什么」的账。开着的行不算历史，它是阻塞判据，永远不清。历史留 30 天，删要人显式喊一声（`ans upgrade prune`），删前先留一份能核对的快照（代码里叫 HISTORY_RETENTION_DAYS / pruneFinishedTasks / snapshotBeforeDestructiveOp；这个窗口进程登记也用同一份）。
  _Avoid_: 日志清理、归档、retention

- **快照**:删数据之前用 SQLite 自带的在线备份给整个库留的一份文件，删之前必须有，恢复只能手动做（代码里叫 snapshotBeforeDestructiveOp，落盘为 `<库名>.prune-<时间戳>.db` 加同名 `.json` 记录）。和「迁移前备份」的区别：那个只在旧库还没改结构时拍一次，库已经是新的就永远不重拍；快照是每删一次就新拍一份，名字带时间戳，不覆盖旧的。`ans upgrade status` 里说的「现场快照」是读出来的内存视图，不是这份文件。
  _Avoid_: 存档点、恢复点、restore point

- **恢复存档点**:检索算完后可能写一条状态记录，重开时读它给模型一份检索摘要，不会自动重跑检索（代码里叫 ResumeAnchorsPort）。
  _Avoid_: Anchor、锚点、恢复锚

- **会话记录**:PI 自己维护的一份只追加的 JSONL 文件，一个会话一个文件，存完整对话和工具记录，续聊和重启恢复都读它（代码里叫 SessionManager）。
  _Avoid_: Session File、会话文件

- **记录判决**:打开一段会话之前，把会话记录整份读一遍给出的结论：好的、尾行断在第 N 行、第 N 行坏了、格式比本版新、身份对不上。只看不改（代码里叫 judgePiSessionRecord）。
  _Avoid_: 校验结果、validation

- **断尾**:会话记录最后一行没写完的那一截，通常是写到一半被杀留下的。它不算事实，读的时候忽略，下一次追加前切掉（代码里叫 tornTail）。
  _Avoid_: 半行、截断行

- **格式版本**:会话记录文件头里写的数字，表示这份记录是哪一版格式写的。比本程序新就拒绝打开，不猜（代码里叫 PI_SESSION_FORMAT_VERSION）。
  _Avoid_: schema 版本、文件版本

- **上下文压缩**:上下文快满时 PI 把较早的内容压成一段摘要，近期内容原样保留，原始记录仍在会话记录里可查（代码里叫 compaction）。
  _Avoid_: Compaction、压缩摘要

- **摘要来源**:一条调研摘要当时到底读了哪些资料和知识、各自是第几版，按 id 记下来，不看会话也不看文字像不像（代码里叫 summary_sources）。
  _Avoid_: 来源依赖、provenance、摘要血缘

- **摘要暂停**:摘要里的事实被纠正之后，这条摘要就不再当当前结论喂给模型，原文和来源都留着，只是先退出注入（代码里叫 summary_suspensions）。
  _Avoid_: 摘要失效、invalidate summary、吊起

- **摘要重建**:把暂停的摘要用当前有效的资料来源重写一遍，同时把用户自己说过的话原样带上，成功后才解除暂停；缺料或缺原始要求就明说不完整（代码里叫 planSummaryRebuild / writeRebuiltSummaryAnchor）。
  _Avoid_: 刷新摘要、regenerate、重新总结

- **一次运行的用量**:一次对话花了多少调用、token、缓存读写和钱，并写清楚这个钱数是服务端给的、按价格估的、两者混着还是完全不知道（代码里叫 RunUsage）。
  _Avoid_: Usage、用量统计

- **上下文占用**:此刻这次对话占了窗口多少，由 PI 自己算，回给调用方就是为了核对外面配的窗口是不是真的生效了（代码里叫 RunContextUsage）。
  _Avoid_: Context Usage、上下文用量

## 记忆与检索

- **三层记忆**:分会话临时记忆、对话中的记忆注入、本地长期库三层（代码里叫 L0/L1/L2）。
  _Avoid_: Memory Tier、记忆三层架构

- **记忆处理流程**:管记忆的读、写、注入、整理，独立于 agent 循环（代码里叫 MemoryPipeline）。
  _Avoid_: 记忆管线、深模块

- **调研资料库**:本地 FTS5 库里存的历史调研结果，包括网页内容、结论和私有数据（代码里叫 retrieval_results）。
  _Avoid_: Research Memory、调研记忆层

- **迁移前备份**:改数据库结构之前，用 SQLite 自带的一致快照给整个库留一份可恢复的备份，恢复只能手动做（代码里叫 pre-migration backup，落盘为 `<库名>.pre-migration.db`）。
  _Avoid_: 数据库镜像、自动回滚点

- **库布局标记**:库里一行记录，说明这个库的结构已被哪个版本线装配过；带会话表又缺这行的库，下次打开会先做迁移前备份（代码里叫 store_layout）。
  _Avoid_: schema 版本号、迁移水位线

- **配置根**:用户级一个 `~/.ans`，项目级一个 `<项目>/.ans`，所有配置、数据、缓存、技能、日志都住在这两个目录里；位置只在 `packages/store/src/ans-paths.ts` 定义一次（代码里叫 ansHomeDir / ansProjectDir；发布脚本和嵌入包的默认值两处例外，见 `docs/ans-layout.md`）。
  _Avoid_: 数据目录、配置目录、`.anysearch`、`.anysearch-cli`

- **目录搬迁记录**:用户级目录从旧名字搬到 `~/.ans` 之后留下的那份记录，写明搬了什么、从哪来、用什么方式、哪些没搬成和为什么；项目级不记，因为项目级要搬的都是纯改名，可以每次重试（代码里叫 AnsLayoutRecord，落盘为 `~/.ans/.layout.json`）。
  _Avoid_: 迁移日志、布局清单

- **整理**:把选定的调研材料归纳成长期知识，加进去、合并重复、或更新旧结论；只读你选的范围里的材料；这次整理自己的模型调用记在它自己的任务预算上，材料来自几段聊天都一样（代码里叫 consolidate，MCP 入口是 `operation=consolidate`）。
  _Avoid_: Consolidation、知识固化

- **跨范围更新**:整理时可能撞上别的会话留下的旧结论并把它替换掉。这是允许的——新材料够可靠就该纠正共享知识——但报告里会列出被替换的知识和范围外的材料，不偷偷改。
  _Avoid_: Cross-scope Update、越界更新

- **单证据纠正**:一条足够可靠的新材料，不满批量门槛也能纠正已有的旧知识；只能纠正、不能新增长期结论。判断不过（对象对不上、证据不可靠、说不清）就把旧内容、候选、来源、理由和该补什么交回调用方，材料保留（代码里叫 allowSingleEvidence）。
  _Avoid_: Single-Evidence Correction、单例修正

- **替代关系**:知识或材料被纠正后，旧行不删，只记下被哪条新知识替代。旧版本和来源还能查，但不再出现在当前事实的检索里（代码里叫 superseded_by）。
  _Avoid_: Supersede Relation、覆盖链

- **并发冲突**:两个会话同时纠正同一条知识，后到的一方在写入前发现目标已被换过；处理规则是重读、最多重判一次、按最新版本重新合并，落不了地就带着双方证据报冲突，谁先写不算谁对（代码里叫 conflicts/conflictDetails 与 resolvedCollisions）。
  _Avoid_: 写入竞态、乐观并发、并发更正

- **重判**:发生并发冲突后，后到的一方重读当前生效的知识并重新判断一次自己的更正；这是唯一一次额外判断，之后不再重试（代码里叫 resolvedCollisions）。
  _Avoid_: 重试判定、自适应重试、反复重试

- **跨语言对应**:同一个对象的中文名和拉丁字母名被认成同一个，比如「甲公司」和 Acme。字符相似度对这种配对永远是 0，所以只认证据，不看像不像：人工或配置写下来的、材料自己写出来的（`Acme（甲公司）`）、或者模型判断后人工确认的（代码里叫 entity-alias）。
  _Avoid_: Cross-lingual Alias、跨语言实体链接、多语言实体

- **别名来源**:每条跨语言对应都记着是怎么来的——人工声明、材料自己写的、还是模型判断。能查得到，也能撤销，撤销后回到之前的样子（代码里在 entity_merge_log 的 kind 与 detail.evidence）。
  _Avoid_: Alias Provenance、别名溯源

- **对象未确定**:不知道该归到哪个对象时的明确结论，不是"没找到"。这时宁可不给答案，也不随便挑一条（代码里叫 entity_unresolved，复用检索结果上的隔离标记，默认不参与召回）。
  _Avoid_: Ambiguous Entity、实体歧义、对象不明

- **整理范围**:整理时明确选定要读哪些材料，要么给一串材料 id，要么给一个会话 id；不给就报错，不会整理全库（代码里叫 consolidate scope）。
  _Avoid_: Consolidate Scope、整理域

- **费用口径**:一次模型调用花的钱是哪来的——没调用、不知道、按价目表估算、服务端返回，或者几种混在一起，分开说清楚，不知道就不写 0（代码里叫 costBasis）。
  _Avoid_: Cost Basis、计费来源

- **项目索引**:钩子把 MCP 工具的输出存进本地库，读写都带上明确项目；默认只看本项目，只有明确给出多个项目才跨项目查（代码里叫 ProjectIndexStore）。
  _Avoid_: Project Index、项目级索引

- **两套数据库**:项目索引和内部记忆分两个库，先查内部，不够再查项目索引；项目索引是一个用户级库，靠 project_path 列分项目（代码里叫 SessionStore 和 ProjectIndexStore）。
  _Avoid_: Dual DB、Two-Stage Recall

- **来源标记**:给结果贴两个标签，一个说明可不可信，一个说明是哪次检索来的（代码里叫 SourceTraceLabel）。
  _Avoid_: Source Label、Provenance、来源标签

- **时间衰减**:旧记忆按半衰期慢慢降权，过时的记录标成失效（代码里叫 time-decay）。
  _Avoid_: Time Edge Effect、时间边缘效应

## 域过滤与安全

- **领域约束**:当前领域到底有没有按它配的那样在跑，只有三种答案——没指定领域（合法，全量扇出、不做网址过滤）、已经建起来（白名单、信息源、工具名单按它的来）、没建起来。第三种要分两件事看：文件根本不在（missing），只有有人点名了才算故障，没人点名就是合法退回全量扇出；文件在但读不出来（broken），不管有没有人点名都算故障，因为那说明声明的规则坏了。故障一律报错停下，不会悄悄变成"全网、不过滤"（代码里叫 resolveDomainConstraint，三种状态是 undeclared / established / failed，失败里带 fault 和 fatal）。
  _Avoid_: Domain State、领域状态机、配置健康度

- **网址策略**:工具真正跑之前，钩子把这次调用会碰到的网址拿去跟项目的白名单、黑名单比一遍——黑名单命中就拒绝，不在白名单就问，规则拿不到也问（代码里叫 `makePreToolUseDecision` 的 URL 分支，取网址靠 `toolInputCandidates`）。它只看会把文本送出去的字段，所以 `recall_memory`、`query_knowledge` 的查询不在其列；跟「域过滤」不是一回事：那条管的是拿回来的结果。
- **域过滤**:白名单非空时只留名单里的网址，黑名单永远优先，信息源支持就先让它筛，引擎再本地筛一遍；名单为空时这条域过滤不启用（代码里叫 shouldAllowUrl）。
  _Avoid_: Dual-Gate Domain Filtering、双闸域过滤

- **拒答**:域白名单开着、零条结果，而且说得出理由——要么闸门真筛掉过东西，要么问过的每一家都答完、一家没失败——才明确说“没有可答的”，这不是报错；信息源全挂了算故障，有信息源被掐断算被取消，都不算拒答（代码里叫 abstain）。
  _Avoid_: 弃答、第一类拒答、First-Class Abstain

- **内容信任边界**:所有不是用户写的文字，包括搜索结果、工具输出、记忆，都当不可信内容处理（代码里叫 content-trust）。
  _Avoid_: Content Trust Boundary、不可信内容管线

- **净化**:把不可见字符、双向覆盖符这类藏起来的东西去掉，再检查内容形状（代码里叫 sanitizeText 和 sanitizeRetrieved）。
  _Avoid_: Sanitization Pipeline、净化管道

- **出故障就放行**:某一层坏了也照常往下走，不拖垮主流程，坏在哪要记下来（代码里叫 fail-open）。
  _Avoid_: Fail-Open、放行策略

- **默认拒绝**:拿不准就拒绝，记忆写入、网址消费、LLM 判断输入这三处默认不放行（代码里叫 fail-closed）。
  _Avoid_: Fail-Closed、失败关闭

## 宿主集成

- **钩子层**:各宿主共用的钩子逻辑加每个平台自己的适配层，钩子只做轻量判断，重活交给长驻 server（代码里叫 hooks/core）。
  _Avoid_: Hook Layer、HOOKS 层

- **安装令牌**:同一安装、同一用户共用的服务令牌，放在配置根；长驻 server 和所有项目的钩子读同一个文件，不再每个目录各生成一份（代码里叫 server-token）。
  _Avoid_: Server Token、服务密钥

- **用户凭据文件**:用户把某家的 API key 存一次的地方，放在配置根，本机同一账户的所有入口都读它，包括没有 shell 环境的 GUI 宿主。内容明文，文件自己写明不是加密、也不是系统钥匙串；每条绑定到具体 provider，模型的 key 还绑定到录入时的端点，换了目标就不发出去。写之前按平台自己的口径建访问保护并核对（代码里叫 credentials.json）。文件读不出来、不是 JSON、或结构不对时，它是「坏了」而不是「没配」：记录里另有一个故障说明坏在哪（代码里叫 CredentialFileFault / CredentialFileNotice，记录里的键是 `credentialFileFault`），别把各臂的 `none` 读成这台机器从没配过 key。`ans_chat`（MCP 那个）不解析搜索臂，也没有 `credentialSources` 可挂，同一个 `credentialFileFault` 就放在它的 `structuredContent` 顶层；正文里也有同一句 `notice`，成功回答放最前，错误回答排在原因后面。读和写都拒绝动一个坏文件；唯一的例外是 `ans auth repair`，它只丢读不了的那几条，其余原样留下。`ans auth` 用 BROKEN 标出这一档。
  _Avoid_: 密钥库、钥匙串、加密存储

- **探针的 keySource**:手工探针输出里那格「这一跑用的 key 从哪来」，三档 `env`（环境变量）、`user`（用户凭据文件）、`none`（这一跑没发 key：两处都没有，或者传了 `--nokey`）。它说的是这一跑，不是这台机器配了什么；产品侧的 `credentialSources` 是另一回事。
  _Avoid_: keyPresent、key 状态、key: set/unset

- **服务地址登记**:长驻 server 启动后把自己真正监听的地址写进配置根，钩子读这条记录来连；默认端口被占就换空闲端口，读的人不用猜（代码里叫 server.json 和 resolveServerEndpoint）。
  _Avoid_: Port Registry、端口表

- **路由卡**:会话开始时塞给 agent 的一小段说明，讲插件能干什么、有哪几个工具、什么时候用（代码里叫 routing-card）。
  _Avoid_: Routing Card

- **技能启用名单**:当前领域在 `[skills].active` 里声明的技能键名，只在领域同时配了 `toolRequires` 时拿来筛进模型的运行时工具，不是 `skills/synced/` 的自动加载开关（代码里叫 skills.active）。
  _Avoid_: Skill Active List

- **技能所需工具映射**:领域配置里保留的可选「技能名 → 所需工具名列表」，配了才按 `hooks.toolWhitelist ∩ (∪ toolRequires[active] ∪ {search})` 筛工具；没配时只看 `hooks.toolWhitelist`（代码里叫 skills.toolRequires）。
  _Avoid_: Tool Requires、技能工具绑定

- **项目身份**:本次明确项目的真实根路径及识别来源，不能确定就记为未知，不借其他项目的状态（代码里叫 ProjectContext）。

- **会话身份**:观测和钩子用来归组记录的 id（代码里叫 session_id）。
  _Avoid_: Session Identity

- **显式会话句柄**:`ans_chat` 和 `ans chat` 返回的会话 id，用来明确选择要继续的对话和记忆（代码里叫 sessionId）。
  _Avoid_: Explicit Session Handle

- **审批通道**:宿主在放行一个拿不准的工具调用前，先把“要不要放行”问给用户，再把用户的选择传回工具那一层的整条路（代码里叫 approval channel；上游 dsh 叫 `approval/request`）。
  _Avoid_: Approval Channel、审批 waterfall、审批瀑布

- **审批结果**:审批通道问完之后只有四种回答——放行一次、拒绝、撤回、没人应答；除了放行一次，其余三种都不执行工具（代码里叫 ApprovalOutcome）。
  _Avoid_: ApprovalOutcome、审批裁决

- **宿主接线**:把本工具的条目（MCP 注册和钩子）写进用户选定宿主的配置文件；预览、接入、修复、移除一套流程，密钥全程不看，配置写入不等于宿主已生效（代码里叫 ans host / host-wiring）。
  _Avoid_: Host Wiring、宿主集成命令、Host Onboarding

- **保留式编辑**:改宿主配置文件时只在原文上动归属本工具的那一段文字，别人的键、其他工具的条目、注释、换行一个字符都不碰；语法解析不过就明确拒绝、一个字节不写（代码里叫 jsonc-edit / toml-edit）。
  _Avoid_: Preserving Editor、格式保留编辑器、非破坏性编辑

- **写入单元**:宿主配置里「归属本工具」的一块内容，比如 mcpServers 下的 anysearch 键、一个钩子条目或一段 TOML 表；接入/修复/移除都按单元算差异和验证（代码里叫 UnitDef）。
  _Avoid_: Config Unit、配置单元、接线条目

- **归属判定**:认出配置里哪块内容是本工具写的——键名在本工具命名空间、command 认得出本工具的 bin 或包路径；修复和移除只碰有归属的东西，手写的同名条目也按归属处理但会说清楚（代码里叫 ownership.ts / ANS_COMMAND_RE）。
  _Avoid_: Ownership Detection、条目识别

- **接线操作日志**:每次接线操作先记计划再动手的流水账，附写前备份；中断了能查到停在哪个文件，修复接着收尾，全靠这份记录（代码里叫 journal.jsonl / journal.ts）。
  _Avoid_: Journal、接线日志、操作流水账

- **冲突基线**:操作日志里记下的「上次我们写入的单元内容」；用户后来改过就跟基线对不上——保留现场报冲突，绝不拿旧备份硬盖（代码里叫 journal entry 的 units 字段）。
  _Avoid_: Conflict Baseline、基线快照、写入基线

## 评测与发布

- **评测台**:用固定数据集量记忆能力，指标和判定线预先定好，换数据集必须重新校准（代码里叫 eval）。
  _Avoid_: Memory Eval Harness、记忆评测台

- **截断（删失）**:预算到点被掐断的样本——只知道它「至少等满了预算」，不知道它本来要多久才回来。所以既不能记成 0 条结果，也不能记成失败，只能记成「到点被掐」并把当时用的预算一起记下来。
  _Avoid_: Censored、超时失败、timeout

- **发布冒烟检查**:发布前从检查、构建、打包到真安装和实际启动全跑一遍（代码里叫 ship-gate）。
  _Avoid_: Ship Gate、Product Smoke Gate、产品冒烟闸门

- **分层诊断**:`ans doctor` 把「这台机器上到底能用什么」拆成四层分别回答——安装、能力、宿主、数据。每条结果只落在四种状态之一：可用（查过，是好的）、未配置（还没配，或者本来就不需要配，合法的空）、未检查（没能查或没查，不算通过）、失败（查过，确实坏了）。每条还标着是离线检查还是真实调用：离线通过不等于真实调用通过。退出码只看失败；`--strict` 才把未检查也算没通过（代码里叫 doctor / DiagReport）。
  _Avoid_: 健康检查、smoke test、doctor 自检

- **每层文件状态**:用户级和项目级各一份 `config.toml` 单独记一档，六种之一——`missing`（没有文件）、`empty`（文件在但空白）、`no-llm`（能解析但没有可用的 `[llm]`，含 `[llm]` 不是表）、`half`（有 `[llm]` 表但 provider 和 model 没齐，空表也算）、`ok`（provider 和 model 都在）、`broken`（读不出来或 TOML 坏）。说的是文件本身，不是最终用哪套模型（代码里叫 LlmConfigFileStatus，解析结果里的字段是 `configFiles`）。
  _Avoid_: 配置健康度、config health

- **诊断 kind**:一条结构化诊断只说自己属于哪一类，不带路径、值、endpoint、provider 值或解析原文。文件级诊断挂在某层文件记录上（记录说明哪一层），键级诊断再带一个清洗过的键名；值级诊断挂在解析结果的 `valueDiagnostics` 上，带层，需要时再带一个非密名字（例如 `env_key` 的变量名），说明「哪一层、哪一类」，不判生死。文件读不出或 TOML 坏时，文件记录另带一个安全的故障位置（错误码或行列号），仍然不带原文。给人看的句子仍由 `warn` 出（代码里叫 LlmFileDiagnosticKind / LlmFileDiagnostic / LlmValueDiagnosticKind / LlmValueDiagnostic）。
  _Avoid_: 错误码、diagnostic code

- **待信任**:宿主已经写好了配置，但宿主自己还要人点一下「信任这个项目/插件」才会真正执行。这不是失败，也不是配置没写——是等人去点，所以单独列一条，不并进「配置在位」里（`ans doctor` 宿主层的 `待信任` 行）。
  _Avoid_: 待授权、pending trust

## 技术名

- **FTS5**:SQLite 自带的全文本搜索，本地记忆和项目索引都靠它（代码里叫 fts5）。
  _Avoid_: 全文检索扩展

- **RRF（合并排序）**:把多路排名按名次倒数加权合成一个总排名（代码里叫 rrfRank）。
  _Avoid_: Reciprocal Rank Fusion、融合排序

- **MCP**:Model Context Protocol，给 agent 提供工具和上下文的协议（代码里叫 MCP server）。
  _Avoid_: 模型上下文协议

- **TOML**:领域配置文件用的格式（代码里叫 smol-toml）。
  _Avoid_: 领域配置格式

- **SQLite**:本地存数据的数据库（代码里叫 better-sqlite3）。
  _Avoid_: 本地数据库引擎

- **BM25**:FTS5 用的相关度打分方法（代码里叫 bm25）。
  _Avoid_: Best Matching 25

- **租约**:一次尝试独占会话的凭据，从开始记账到结果落库一直持有，释放前另一尝试不能改这段会话的完成状态（代码里叫 session lease）。

- **一次尝试**:拿租约、运行这一轮并在租约内记下开始和结果、最后交还租约的完整流程，CLI 和 MCP 共用（代码里叫 runChatAttempt）。

