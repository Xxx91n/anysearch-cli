# atomcode 对这六种续聊情况的做法

拉下来的代码：`atomgit-atomcode/atomcode`，提交 `ec920b64`（2026-11-16），浅克隆在 `D:\Aworker\atomcode`。
下面全部是读源码和仓库里的设计文档得出的，没有编译，也没有跑它的测试。

## 先说它的总规矩

一个会话只有一个权威：它自己的事件日志（ADR 0024，`docs/adr/0024-the-session-log-is-the-authority.md`）。

- 日志放在 `$ATOMCODE_HOME/sessions/<项目哈希>/<会话 id>.events`，一条一条事实：提问、回答、工具调用、撤销、恢复。
- `<id>.index` 是目录索引，写它才算这个会话发布了。
- `<id>.lease` 是 OS 排他锁，一个会话同时只能有一个写者。
- resume 就是拿到租约、重放日志。没有第二份快照可以回退。

这套结构决定了它对下面每种情况的答案。

## 1. 旧会话没有完整对话文件

**它怎么做**：老版本的会话是 `<id>.snapshot`。第一次打开时转一次成事件日志：先写日志和附属文件，最后写索引（索引是提交点）；然后把老版本认得的文件改名成 `.snapshot.migrated`、`.meta.migrated`、`.jsonl.migrated`，不删。转到一半停了，下次接着转。转换只保留快照里有的 6 种事件，**它承认这是有损的**。

只有索引、没有日志文件的会话，resume 直接报错，不会当成空会话接着聊，也不会回退去找别的东西。

**跟 #314 比**：atomcode 的老文件里还有对话本身，所以它能“转”。anysearch 的旧会话没有对话文件，只剩数据库里的消息和记忆，转不出来。它的做法回答不了 A/B，只说明它的倾向：**有内容就转，没内容就停，不让空会话冒充旧会话**。

**证据**：`crates/atomcode-capabilities/src/session/events.rs:1445-1494`（`open_as_events` / `open_for_resume`）、`:1496-1505`（`convert`）、`:1653-1663`（`move_snapshot_files_aside`）；测试 `events.rs:3098`。

## 2. 同一会话，两轮一起收尾

**它怎么做**：租约，一个会话只能有一个写者。第二个进程要打开同一个会话时，`try_lock_exclusive` 失败立刻返回 `SessionInUse`，不等待。

- 交互式 `-c` 撞上：从最后提交的状态 fork 一个独立会话，提示“最近会话（x）正在另一个窗口运行，已从其最后提交状态创建独立分支（y）。”
- 无头 `-p` 撞上：直接报错，不 fork。

两轮根本不会写同一份日志，所以不存在“后结束的覆盖前面完成状态”这种事。

**跟 #314 比**：PR 允许同一个句柄两轮同时跑，靠收尾时 upsert `chat_projects`，后结束的那轮会把 `is_complete` 覆盖掉。atomcode 改的是结构（一个写者），不是把覆盖写得更小心。

**证据**：`crates/atomcode-capabilities/src/session/manager.rs:2316-2338`（`acquire_lease`）、`crates/atomcode-cli/src/main.rs:3300-3337`（撞上就 fork）、`:3407-3416`（`should_fork_busy_continue`）、`:2575-2581`（只有交互式才 fork）；提示文案 `crates/atomcode-i18n/src/product/zh_cn.rs:523`。

## 3. 进程跑到一半被杀

**它怎么做**：事实在提交返回前就已经追加落盘。流式片段不落盘，另外每秒或累计 16 KiB 追加一次 `ReplyCheckpoint`。

下次冷启动拿到租约、重放之前，如果最后一轮没有 `TurnEnd`，就补几条事实：

- 已收到的文本变成一条 `PartialReply`；
- 有调用没结果的工具，补一条“结果未知，别自动重跑”的工具结果；
- 加一条提醒和一条带数量摘要的 Notice；
- 最后补 `TurnEnd(InternalError)`。

不重跑工具，不自动继续下一轮；重复打开不会重复补。

**跟 #314 比**：PR 只把会话记成“未完成”，没有恢复事实；半截回答会不会被当成完整历史，还没验证。

**证据**：`crates/atomcode-capabilities/src/session/recovery.rs:12`（提示原文）、`:22-165`（补哪些事实）、`:171-207`（`recover_interrupted_turn`）、`:248`（用子进程 `process::exit(0)` 模拟被杀的测试）；调用点 `crates/atomcode-coding/src/parts.rs:1167-1202`。

## 4. 会话登记 / 写盘失败

**它怎么做**：写失败即停。第一次追加失败就把这个会话标成 broken，之后什么都不写；当前回合取消，运行时按“提交不确定”报错。

- 委派出去的成员写失败只停它自己，不拖垮 lead。
- 建不起日志的 agent 直接不运行。

**跟 #314 比**：anysearch 新对话写不进去还会照常回答（fail-open），只有明确续聊才停。差别在定位：atomcode 认为日志就是会话，写不进去就等于没有这段会话；anysearch 还有数据库和记忆，回答不是非日志不可。

**证据**：`crates/atomcode-coding/src/session_store.rs:14-18`（模块说明）、`:154-206`（`append_delegated` / `append_now`）、`crates/atomcode-capabilities/src/session/events.rs:200-277`（一次写入、文件锁、大小上限、错误上抛）。

## 5. 对话文件被改名，而且读不出来

**它怎么做**：身份查两道。

- 目录扫描只读 `<id>.index`，还要求文件名等于 `meta.id`，不等就跳过。
- 打开 `<id>.events` 要求头里的 id 等于请求的 id，不等就报 `Corrupt`。
- 新建会话时也要求头、索引、租约三者 id 一致。

结果：把文件改成别人的名字，那个“别人”打不开（头对不上），原主也找不到（文件名不对）。不会张冠李戴，也不会在原句柄下悄悄新建空会话。

**跟 #314 比**：anysearch 按文件头认句柄、不看文件名，所以单纯改名没事；改名加上读不出时，这个文件对原句柄等于不存在，也是停下。两边都不认错人；atomcode 多查了一道文件名和索引的一致性。

**证据**：`crates/atomcode-capabilities/src/session/events.rs:157`（新建时三者一致）、`:973-978`（读时头与请求 id 一致）；`crates/atomcode-capabilities/src/session/manager.rs:4008-4038`（`every_meta` 要求文件名等于 `meta.id`）。

## 6. 文件开头好好的，后面坏了

**它怎么做**：逐行严格解析。

- 完整的一行坏了：`Corrupt`，报错，不跳过。
- 最后一行没有换行（写到一半被杀）：不算事实，读的时候忽略，下次追加前切掉。
- 序号不递增、缺头、头的 id 不对：`Corrupt`。
- 头版本比本版新，或者出现不认识的事件种类：`FutureSchema`。目录里照常列出，拒绝打开，不猜。

**跟 #314 比**：anysearch 只读文件第一行。后面坏没坏，它不知道，也不会报。这是最值得借的一条。

**证据**：`crates/atomcode-capabilities/src/session/events.rs:1073-1134`（严格逐行读、不完整尾行处理）、`:979-1004`（版本与序号检查）、`:1629-1650`（`refuse_newer`）；测试 `:3000-3035`（未来版本、未知事件种类被拒）。

## 顺带：`--continue` 的项目范围

- `-c` 只在当前项目桶里找最近的会话，找不到再扫同项目的其他桶；**不去全局找**。
- 交互式恢复一个别的项目的会话：直接拒绝（`Cannot resume a session from another project.`）。
- 显式 `--resume ID`：可以在所有项目里找，找到以后切到那个会话自己的目录并提示；按会话自己的目录认，不按今天的目录猜。

跟 #314 的形状一样：默认新对话、`-c` 按项目、显式句柄跨目录、旧会话不猜归属。

**证据**：`crates/atomcode-cli/src/main.rs:2502-2528`（`--continue`）、`:2461-2499`（显式 ID 跨项目并切换目录）；`crates/atomcode-cli/src/host.rs:2140-2155`（跨项目恢复拒绝）。

## 对 A/B 这个决定的影响

atomcode 的旧会话还有内容，所以它的做法不是 A 也不是 B。能借的是三条原则：

1. **日志是权威：没有完整记录就不假装有完整对话。** 这条偏向 B。
2. 如果选 A，要把“续记忆”和“续对话”分开叫，界面和数据都别把这一轮标成完整历史。atomcode 的读时转换也是这个态度：能转多少说多少，转完把旧文件挪开留着。
3. 不管选 A 还是 B，有三件事值得单独做：单写者租约（或至少让完成标记做 compare-and-set）、崩溃后的恢复事实、读日志时校验不止第一行。

不建议照搬：整套事件日志架构，以及“撞车就 fork”的交互；对 anysearch 来说都太重。

## 怎么验证的

- 读的是上面列出的源码和 `docs/adr/0024`、`docs/plans/2026-10-27-resume-project-scope.md`。
- 没有编译 atomcode，也没有跑它的测试。文里引用的测试源码在仓库里，但执行结果未知。
