# R90 审计报告 — dsh 原生工具面实施轮（独立审计窗口，2026-09-29）

> 审计对象：r90 栈 10 commits（4c581738..a30fc654；but-id puz/qum/vok/yvp/mnt/rqu/xvx/wps/mtt/xmu）+ 交接三件（closeout/轮报/任务书）。
> 审计纪律：不信报告自述——硬验收四腿亲跑 + 每条关键声明仓库实物抽查 + ADR-0091 D1-D6 逐条源码核对 + 双轴评审。
> 职责分离：本窗口只出报告不动手修；发现项全部呈报，无返工项。

## 审计结论

**通过**。四条验收腿全部亲跑复现；关键声明逐条与实物对上；D1-D6 实现证据齐全；双轴评审无硬违规。轻微发现四项（挂下轮顺手件，不构成本轮返工），过程呈报五条。

## 一、硬验收四腿亲跑复现（本窗自证，非转述）

| # | 验收腿 | r90 报告声明 | 本窗亲跑结果 | 结论 |
|---|---|---|---|---|
| 1 | 编译 | pnpm -r check 全包 exit=0 | exit=0（8 包 tsc --noEmit 全 Done）+ pnpm -r build exit=0（turbo stamp dirty=false） | ✅ |
| 2 | 打包 | pack 产 anysearch-cli-dsh-plugin-0.1.0.tgz（lib/index.js 148.7KB+index.d.ts+cordis.patch.yml+AGENTS.md+LICENSE；external=node:* 仅四件） | 本窗 pack 产同包名 tgz（33219B），tar listing 六项与 t7-pack.log 逐项一致；bundle 152251B≈148.7KB、external=node:crypto/fs/module/path 四件、better-sqlite3 零泄漏（t3-bundle-hygiene.log 复核） | ✅ |
| 3 | 启动测活+真链路 | 双进程 /health + 真 execute 链路 hitsCount=5 | 本窗亲跑：ans-mcp :39999 /health 返回 {"status":"ok","server":"anysearch-mcp","version":"0.1.0"}；plugin-server :33333 带 Bearer /health 返回 {"status":"ok"}、无 Bearer 401；mock-ctx apply() 注册五 ans_* 工具；ans_recall_memory("mcp") 真命中 hitsCount=5（本机记忆库真数据）+ ans_search_web 回 canonical JSON；driver exit=0 | ✅ |
| 4 | test 闭环 | dsh-plugin 21/21 + 全仓 test 全绿 + ship-gate --quick 65 legs | 本窗亲跑：dsh-plugin pass 21/fail 0；pnpm -r test exit=0（plugin 10/10、dsh-plugin 21/21、mcp 3/3、cli 3/3；store timeout 自检 exit=124 为预期）；ship-gate --quick exit=0、[pass]=65、[fail]=0 | ✅ |

审计进程卫生：双进程用毕 taskkill、端口归零；全部审计日志落会话临时区（machine-local，不入库）；工作树提交前保持净。

## 二、关键声明 → 证据 → 结论对照表

| # | 声明（出处） | 证据（本窗实测/实物） | 结论 |
|---|---|---|---|
| 1 | dsh-approval npm 404 是包名探测误差非缺口；approval 事件面实物在 dsh-user-approval（轮报·过程呈报） | npm view @deepseek-ai/dsh-approval → E404（t0-dist-tags.json 内嵌同记录）；裸名 dsh-approval 在架但是无关同名包（0.0.1）；npm view @deepseek-ai/dsh-user-approval → 0.1.7-rc.1 在 rc 线（t5-approval-surface.log dist-tags 一致） | ✅ 属实 |
| 2 | WORKFLOW.md §4.2 仓/技能目录均缺位，以任务书+gitbutler skill 代行（轮报·过程呈报） | 仓内与技能目录两域 find 均零命中 | ✅ 属实（挂账合理） |
| 3 | GitButler amend 滚 sha → 收口切 but-id+sha 双锚（轮报·过程呈报） | closeout 票序表 10 行全带 but-id；git log sha 逐一比对一致；registry closed_by 带「restacked; pre-move sha」注记（两处残留见发现项 2/3） | ✅ 属实（执行不彻底处单列） |
| 4 | T0 TC 不触发（next=0.2.0-rc.1 无 stable） | npm view @deepseek-ai/dsh dist-tags → latest=0.1.7-rc.2 / next=0.2.0-rc.1 / alpha=0.1.7-alpha.2，与 t0-dist-tags.json 一致 | ✅ 未触发成立 |
| 5 | 钉版未动/无外发（范围外承诺） | catalog 0.1.7-rc.1 全族维持（pnpm-workspace.yaml）；git tag 无新签（最新 v0.1.0 旧签）；but status 无 pushed 标记 | ✅ |
| 6 | 一票一 commit + type 纪律（跨票闸） | 10 commits ↔ T0-T7+收口+轮报 1:1；type=chore/docs/test/fix/refactor/docs/docs/chore/docs/docs 全对表 | ✅ |
| 7 | T2 expected-RED 15p/6f | t2-expected-red.log：pass 15/fail 6，红腿=native execute 六断言 | ✅ |
| 8 | T3 21/21 绿 | t3-green.log pass 21/fail 0；本窗复跑同值 | ✅ |
| 9 | T4 桥退役+引用面清零+gate 断言翻转 | cordis.patch.yml 仅注释级提及；ship-gate.mjs 桥行断言翻转+revert 对称注记（:511-515）；活动面 grep 零命中 | ✅ |
| 10 | T5 拆票+matrix 收窄 | registry 新条目 defer-r72-dsh-approval-channel（evidence 指 t5 log）；matrix 收窄 patchReload:live+browser-turn；t5 log 键面复验 approval/policy+invariant+types+asked+decided+request 在架 | ✅ |
| 11 | T6 收口件批 | ADR-0091 在架 + adr/index 0091 行 + CONTEXT 六词（:1622-1637）+两词块（:1640-1643）+ closeout-claims 8 项 + CHANGELOG r90 段 + 任务书终态戳 | ✅（终态戳 sha 残留见发现项 2） |
| 12 | T7 门禁证据 | evidence 11 件全在；t7-ship-gate.log [pass]=65/[fail]=0 与报告一致；本窗复跑同值 | ✅ |
| 13 | T3 题注正例声明（D-001 附件①） | git log 1bc7b84d 全文第 5 行在：「本票消费现钉 @deepseek-ai/dsh-* 0.1.7-rc.1 在架 API…零 repin 依赖」 | ✅ |
| 14 | T1 ADR-0090 pending-repin 第四行+正交措辞 | docs/adr/0090（:49-54）Addendum 全文在架 | ✅ |
| 15 | cli e2e 一次 flake（单跑 22/22 绿，观察项非缺陷） | 自报记录；本窗 -r 全仓复跑 exit=0 未复现 | ✅ 观察项成立 |

## 三、D-xxx（ADR-0091 D1-D6）逐条实现证据

| 决策 | 实现证据（file:line） | 判定 |
|---|---|---|
| D1 裸 ToolDefinition | apps/dsh-plugin/src/index.ts:26-32 import type（纯类型导入）；:206-216 循环字面量构造+ctx.tools.register；dependencies={}；bundle external 仅 node:*（无 @deepseek-ai 运行时导入泄漏） | ✅（字面偏离已立法记档） |
| D2 叶导出 SSOT | packages/kernel/package.json exports["./tool-json-schemas"]；tool-json-schemas.ts:40 re-export KernelToolDescriptions、:43 KernelJsonSchemas；apps/mcp 五 .tool.ts 全消费；dsh-plugin index.ts:35 子路径叶导入 | ✅ |
| D3 握手缓存传输面 | index.ts:127 mcpBaseUrl（ANS_MCP_URL 缺省 127.0.0.1:3001）；:125-131 channels Map 键 base+tok；:138-146 initialize+notifications/initialized；:188 session 错 -32001/-32600 重握手一次 | ✅ |
| D4 fail-open+isError | index.ts:181-185 transport 失败返回空 content；:194-197 isError 物化 throw；:118-122 超时五档；AbortSignal.any 前向在共享 callServer（apps/plugin/src/hooks/core.ts:81） | ✅ |
| D5 独票+revert 对称 | T3 1bc7b84d（fix）与 T4 b41469e1（refactor）分票；ship-gate step-1s 翻转断言+rollback=revert T4 | ✅ |
| D6 拆票 | registry 三态：native-tools→closed（closed_by 双锚）、approval-channel 新条目、matrix 收窄 | ✅ |

## 四、双轴评审（code-review skill）

子代理通道两次尝试均平台故障（max_tokens 配置错误，用户确认先不用子代理）——双轴由主窗口串行代行；两轴结论未合并排序，符合技能的轴分离要求。

### Standards

- 硬违规：0。
- 轻微/判定项：
  1. [轻微·代码] scripts/ship-gate.mjs:514 桥行断言第二分支正则 /^\s*id:s*mcp-anysearch/ 疑似反斜杠丢失——「id: mcp-anysearch」带空格无破折号形态不被命中（列表形态由第一分支 trimStart+startsWith 覆盖）。当前 patch.yml 行态为 - id: 列表项，无实害；建议改 \s* 归下轮（gate 代码→复核行/清障轮，不扩本轮票）。
  2. [判定·非违规] tool-schemas.ts 同载 schema+description——注释自释「model-facing tool copy 两半」，内聚成立，不构成 Divergent Change。
  3. [判定·非违规] ans_ans_chat 双前缀观感——ans_ 命名契约+工具本名 ans_chat 所致，契约内，非 Mysterious Name。
  4. smell 基线过堂：五定义循环生成（无 Duplicated Code）；callServer 三槽位均被消费（无 Speculative Generality）；callAnsTool 纯传输是 D3 设计（非 Middle Man）。
- repo standards 对照：apps/dsh-plugin/AGENTS.md 不变式逐条满足（deps={} 类型化 devDep、ESM bundle external 仅 node:*、patch.yml 插件行独存、钩子逻辑不重实现、mock-Cordis 测试口径）；path-lint 507 docs clean（ADR-0072）。

### Spec

- 缺失/部分：0。T0-T7+TC 对表全命中；三立法附件①（T3 题注）②（ADR-0090 Addendum）③（ADR-0091 D5+closeout 挂账）全落地。
- scope creep：1 处相邻延展——KernelToolDescriptions 描述文案 SSOT（任务书 T3 字面只点名 parameters 单源投影）。已由 ADR-0091 D2 立法+五 .tool.ts 同步消费，判定为合规演化非偷跑。
- 字面偏离（已自报）：defineTool→裸 ToolDefinition。任务书/goal 字面 vs ADR-0091 D1+CONTEXT 词块+源码注释三层记档，判定为授权内实物裁决（零依赖不变式凌驾 DSL 字面），非隐瞒跑偏。
- 文档漂移（轻微）：next-round.md 终态戳滞留 pre-restack sha（6b2bd509/b255bf64/67b42dad/dba410b6/32ea8763/c56e1d34，无 but-id）；registry native-tools 条目 carried_log R90 行裸用旧 sha（closed_by 已双锚注记）。见发现项 2/3。

## 五、轻微发现（挂下轮顺手件，不构成本轮返工）

1. ship-gate.mjs:514 正则 s* 应为 \s*（见 Standards 1）。
2. next-round.md 终态戳 sha 未随 restack 更新、无 but-id 双锚（docs 微件，以 closeout 双锚为准）。
3. registry defer-r72-dsh-native-tools carried_log R90 行旧 sha 未加 restack 注记（closed_by 已注记，同条目内不一致）。
4. WORKFLOW.md §4.2 缺位挂账维持（外部件，非本仓代码）。

## 六、过程呈报（审计窗口自报，不代追认）

1. 子代理通道平台故障：Agent 工具 Explore/general-purpose 两型均报 max_tokens 配置错误，双轴评审改主窗口串行代行（用户已确认）；轴分离保持。
2. 本窗按任务指示本地重跑编译/打包/启动测活/测试/ship-gate——与 2026-09-04 CI-only mandate 字面冲突；按任务即时指令优先+R89 审计本地亲跑先例执行；构建产物均在 gitignore 面（dist/.turbo），未入库；未 push/未 publish/未 tag。
3. 审计临时件（check/build/r-test/shipgate 日志+链路 driver）全部落会话临时区，工作树净；测试进程用毕回收（taskkill 两枚，端口归零）。
4. 上轮 %TEMP% 交接件路径反斜杠转义损坏（\n \r \a 被转义吞成控制符）——仓内件不受影响；本窗 handoff 以 node 直写+正斜杠路径规避同坑。
5. r90 轮报对 cli e2e flake 的自报与观察项定性，本窗复核认可（复跑未复现）。

## 七、裁决建议

- 无返工项：四腿全绿、声明全对上、D1-D6 证据齐全。
- 下轮 grill 方向：维持 closeout 三候选（approval-channel 交互面前置 / 0.2.0 stable 晋升目击→TC 收口探针 / dsh 实机 L3 冒烟）；发现项 1-3 作 ride-along 并入下轮 T0/复核行。
