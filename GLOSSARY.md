# GLOSSARY

本仓唯一权威词表，每条一句话说清这东西是什么、实际干什么，代码里的真名写在括号里；实现细节看代码，决策历史看 git log 和 issue。

## 产品与领域

- **垂直领域 agent**:只在一个领域里干活的 agent，站在通用搜索之上做深度研究，自己不做索引（代码里叫 verticalDomain）。
  _Avoid_: Vertical Agent、垂直 Agent

- **当前领域**:当前选中的领域，由一份 TOML 配置决定用哪些信息源、哪些 skill、哪些工具（代码里叫 Active Domain）。
  _Avoid_: 活跃域、激活域

- **信息源**:一个对外的搜索入口，比如 Exa、Tavily 或 anysearch 通道，由领域配置决定开哪几个、各占多少权重（代码里叫 SearchProvider）。
  _Avoid_: Info Source Provider、信息源头供应方、搜索后端、检索后端、搜索源、搜索服务

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

- **多源并发查找**:同时问多个信息源，先回来的先用，不用等最慢的（代码里叫 fanout）。
  _Avoid_: 扇出、并行检索

- **证据够不够的检查**:看结果数量、来源数量、分数分布，判断要不要再搜一轮（代码里叫 computeSufficiency）。
  _Avoid_: Sufficiency Gate、充分性门禁

- **预算记账**:记录一次运行的调用数、token 和美元用量，调用或 token 额度不够就拦住运行，美元只在跑完后结算（代码里叫 BudgetLedgerPort）。
  _Avoid_: Budget Ledger、预算账本

- **预留**:调用前先占住一块额度，跑完再按真实用量结掉；占住的那块在结之前也算进「已经用了」，所以额度不够时下手就被拒（代码里表现在 reserved_tokens / reserved_usd / reserved_calls）。
  _Avoid_: Reservation、占额

- **预留属主**:这条预留是哪个进程占的，记成机器名加进程号；只有本机确认那个进程已经没了，别人才能把它占的那块放回去（代码里叫 budget_reservations 表）。
  _Avoid_: Owner、持有者

- **无主余量**:账上算着占了额度，但找不到是哪条预留占的，只剩一个数。老版本（v0.1.2 及更早）写下的就是这种。现在有意不清它——清了没法证明老进程真没了，还在跑的老进程就会和新进程一起花同一会话的额度；恢复办法是新建一个会话（见 #279）。
  _Avoid_: Unowned residue、孤儿预留

- **恢复存档点**:检索算完后可能写一条状态记录，重开时读它给模型一份检索摘要，不会自动重跑检索（代码里叫 ResumeAnchorsPort）。
  _Avoid_: Anchor、锚点、恢复锚

- **会话记录**:PI 自己维护的一份只追加的 JSONL 文件，一个会话一个文件，存完整对话和工具记录，续聊和重启恢复都读它（代码里叫 SessionManager）。
  _Avoid_: Session File、会话文件

- **上下文压缩**:上下文快满时 PI 把较早的内容压成一段摘要，近期内容原样保留，原始记录仍在会话记录里可查（代码里叫 compaction）。
  _Avoid_: Compaction、压缩摘要

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

- **整理**:把选定的调研材料归纳成长期知识，加进去、合并重复、或更新旧结论；只读你选的范围里的材料（代码里叫 consolidate，MCP 入口是 `operation=consolidate`）。
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

- **整理范围**:整理时明确选定要读哪些材料，要么给一串材料 id，要么给一个会话 id；不给就报错，不会整理全库（代码里叫 consolidate scope）。
  _Avoid_: Consolidate Scope、整理域

- **费用口径**:一次模型调用花的钱是哪来的——没调用、不知道、按价目表估算、服务端返回，或者几种混在一起，分开说清楚，不知道就不写 0（代码里叫 costBasis）。
  _Avoid_: Cost Basis、计费来源

- **项目索引**:钩子把 MCP 工具的输出存进本地库，按项目共享，跨会话可查（代码里叫 ProjectIndexStore）。
  _Avoid_: Project Index、项目级索引

- **两套数据库**:项目索引和内部记忆分两个库，先查内部，不够再查项目索引（代码里叫 SessionStore 和 ProjectIndexStore）。
  _Avoid_: Dual DB、Two-Stage Recall

- **来源标记**:给结果贴两个标签，一个说明可不可信，一个说明是哪次检索来的（代码里叫 SourceTraceLabel）。
  _Avoid_: Source Label、Provenance、来源标签

- **时间衰减**:旧记忆按半衰期慢慢降权，过时的记录标成失效（代码里叫 time-decay）。
  _Avoid_: Time Edge Effect、时间边缘效应

## 域过滤与安全

- **域过滤**:白名单非空时只留名单里的网址，黑名单永远优先，信息源支持就先让它筛，引擎再本地筛一遍；名单为空时这条域过滤不启用（代码里叫 shouldAllowUrl）。
  _Avoid_: Dual-Gate Domain Filtering、双闸域过滤

- **拒答**:过滤后一个结果都没有时，明确说“没有可答的”，这不是报错（代码里叫 abstain）。
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

- **路由卡**:会话开始时塞给 agent 的一小段说明，讲插件能干什么、有哪几个工具、什么时候用（代码里叫 routing-card）。
  _Avoid_: Routing Card

- **技能启用名单**:当前领域激活哪些 skill，只有激活的才进模型（代码里叫 skills.active）。
  _Avoid_: Skill Active List

- **会话身份**:CLI 用来标识会话并恢复记忆的 id，钩子会带着它传下去（代码里叫 session_id）。
  _Avoid_: Session Identity

- **显式会话句柄**:`ans_chat` 返回的会话 id，客户端传回它才能接上同一段记忆（代码里叫 sessionId）。
  _Avoid_: Explicit Session Handle

- **审批通道**:宿主在放行一个拿不准的工具调用前，先把“要不要放行”问给用户，再把用户的选择传回工具那一层的整条路（代码里叫 approval channel；上游 dsh 叫 `approval/request`）。
  _Avoid_: Approval Channel、审批 waterfall、审批瀑布

- **审批结果**:审批通道问完之后只有四种回答——放行一次、拒绝、撤回、没人应答；除了放行一次，其余三种都不执行工具（代码里叫 ApprovalOutcome）。
  _Avoid_: ApprovalOutcome、审批裁决

## 评测与发布

- **评测台**:用固定数据集量记忆能力，指标和判定线预先定好，换数据集必须重新校准（代码里叫 eval）。
  _Avoid_: Memory Eval Harness、记忆评测台

- **发布冒烟检查**:发布前从检查、构建、打包到真安装和实际启动全跑一遍（代码里叫 ship-gate）。
  _Avoid_: Ship Gate、Product Smoke Gate、产品冒烟闸门

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
