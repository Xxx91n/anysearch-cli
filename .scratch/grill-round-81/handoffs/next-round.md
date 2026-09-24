# Round-81 任务书 — 「产品吸气轮」provider-serverside spike 实施

Date: 2026-09-24. 账本 `.scratch/grill-round-81/decision-ledger.md`（D-001~D-005 全 current，唯一权威数据源——任何实测与账本冲突→标 revised 呈报用户，禁止静默改向）；调研存档 `q2-atomcode.md`（择货/spike 纪律/三分支谱系）、`q3-atomcode.md`（判别矩阵/假设清单/fake-ip 常量/MCP 措辞限）、`q4-atomcode.md`（插曲分级语义/幂等跳过/TP 验证三件）、`q5-atomcode.md`（收口判据/决策-推荐分离/降级 Test 随票）。Stack 约定：`r81-grill`（本文档+账本+调研存档）← 实施栈叠其上（GitButler 分支，与其他栈并行互不写）。

## 状态快照（接手即知）

- **基线**：common base `3ab8ccdb`（R80 审计签收已并入），工作区干净；全仓 9 包钉 0.0.7，公开集 5 包（含 dsh-plugin）。
- **主轴标的**：`defer-r71-provider-serverside`（deadline 2026-12-31）——R71 spike 时 provider live search 返 HTTP 000，改直接种子 memory 行绕验，server 侧病因未查。provider 端点=`https://api.anysearch.com/v1/search`（`packages/retriever/src/providers/anysearch.ts`），融合三臂之一（exa/tavily/anysearch）fail-open 臂死不伤信封；`ANYSEARCH_ENDPOINT` override 在案（install-smoke 用）。
- **实测先验**（R81  grill 期现场观测）：本机 `api.anysearch.com` 解析至 `198.18.0.34`=fake-ip 段（Clash/mihomo RFC2544）；`GET /v1/search?q=test` 返 **HTTP 404**（TLS 握手 ~2.1s 成功）——服务活着但文档化 REST 路由不响应；对照基线=R58 实录（CloudFront CNAME+Amazon wildcard cert+status 子域 cert 至 2026-12-03）。
- **对照仪器**：1MCP `anysearch` server（search/get_sub_domains/batch_search/extract）=同后端 MCP 镜像对照组——结论措辞限「后端+本机出口面活着」。
- **发布面**：`.github/workflows/release.yml` publish 腿=裸 `set -euo pipefail` 顺序五连发（embedding→cli→mcp→plugin→dsh-plugin）无幂等跳过；`docs/publishing.md` 失败语义仅「72h unpublish 窗口」一句——分级语义本轮立法。
- **哨戒面**：dsh `0.1.5-rc.3`/`0.1.7-alpha.1`/`0.1.7-alpha.2` 出闸窗口复核义务；transformers `#1764` OPEN；kernel `llm-init.test.ts` SSE stub flake watch；`dsh-native-tools` 触发器检查（dsh-tools/dsh-mcp-client 有无稳定注册 API 面）。
- **用户扳机链**（外部前提非票内）：手发 `@anysearch-cli/dsh-plugin@0.0.7`→npmjs TP 四字段（owner/repo/workflow/environment 空+勾 `npm publish`）→推 `v0.0.8` tag。

## T0 — 哨戒续班（覆盖 D-001 背景义务+D-003 T0+D-005(i)；纯证据零代码）｜0.25d

1. **dsh 出闸复检**：`npm view @deepseek-ai/dsh-agent time version dist-tags --json`（+`dsh-tools`/`dsh-mcp-client` 同查）快照落档，rc.3/alpha.1/alpha.2 对表复核；
2. **#1764 哨**：`gh pr view 1764 --repo huggingface/transformers.js --json state,mergedAt,updatedAt`——网络不通如实记「未验」；
3. **flake-watch**：kernel `llm-init.test.ts` SSE stub 并行竞态观测延续——复现即升级非静默；
4. **dsh-native-tools 触发器检查**：`dsh-tools`/`dsh-mcp-client` 有无稳定工具注册 API 面，或 bridge 对 `ans_chat`/`research_web` 显不足证据→如实记触发器状态（若已响→呈报用户裁 D-002 是否 revised）；
5. **格式化结论行**（零发现也须显式+观测窗口截至戳）→`evidence/t0-watch-<date>.md`。
- **验收**：四线结论行+transcript+截至戳三件套齐；依赖面零脏。

## TI — 插曲就绪件：R1 幂等跳过补丁（覆盖 D-004 §1+D-005(ii)；release.yml 唯一改动票，可与 T1a/T1b 并行）

1. publish 腿补 skip-already-published：每包 `npm publish` 前 `npm view <pkg>@<version>` 存在→skip 并记录（或将 E403 "cannot publish over" 视为 skip 非 fail——实现粒度票内自决；npm 官方无内建开关 rfcs#387，precondition-check 是唯一通行解）；
2. **双格验收实测**：(a) 对已发包（如 `@anysearch-cli/embedding@0.0.7` 已在 registry）跑 check→skip 记录；(b) 对未发包（不存在版本号）`npm view` 非零退出→不误判、publish 路径继续；
3. `turbo check`/`turbo test` 绿+ship-gate 全绿（1u 新鲜度承袭：新增可机验声明须注册 closeout-claims）。
- **验收**：skip 分支对已发包实测通过+未发包不误伤+全程绿；**不模拟 registry、不以 `--dry-run` 充当验证**（官方实测不验认证/版本）。
- **红线**：不动包内容/不动 tag 语义/不顺手改发布清单。

## 插曲协议常驻规程（覆盖 D-001 §2-3+D-004 §2-5；触发即执行非排期票）

- **扳机①**（手发 0.0.7）：`npm view @anysearch-cli/dsh-plugin@0.0.7` 存在性+license；
- **扳机②**（TP 配置）：外部不可验——验证三件=用户配置声明+首次 OIDC tag run 绿+该包 `dist.attestations` 非空/包页 Provenance 徽章；旁证=发布确认邮件 "via OIDC" vs "via token"；
- **扳机③**（推 tag）：盯 run（**独盯 dsh-plugin publish 步**——唯一新包，ENEEDAUTH/E403 第一时间可辨）→`npm view` 五包×{version,attestations}→装跑冒烟（`npm i -g @anysearch-cli/cli@0.0.8`+`ans doctor`+`dsh plugin add`）→CI 矩阵绿→run URL 回填交接件；
- **失败分级**：C1 零发布→修因+`gh run rerun` 同 tag（前提 TI 落地）；C2a 基础设施因+已落子集内容正确→修因+复跑补全 0.0.8；C2b 已落内容坏→0.0.9 patch-forward 全五包+仅有害才 deprecate 子集；C3 全发冒烟败→deprecate+0.0.9；**unpublish 仅灾难性事故+数小时内+自保句**（第三方依赖可投毒锁死→回 deprecate+patch-forward）；
- **证据面**：每事件 `evidence/release-interlude-<n>.md`（时间戳+npm view transcript+attestations JSON+冒烟 transcript+run URL+结论行）；T2 探针中途被打断→先把当前探针态写进诊断书再切换；收口时未触发→如实记「未触发」。

## T1a — 网络/设施侦察（覆盖 D-003 §1-2；exit criteria=假设清单书面化）｜与 T1b 合并 0.75d

1. **端点测绘**：`GET /v1/search` 现状+证书链+DNS 解析链+路由/CDN 面+status 子域——逐面对照 R58 活体记录；
2. **fake-ip 审计**：记录常量值（当前=198.18.0.34）+代理解析路径（fake-ip vs DoH 真 A 记录对照）；
3. **CI 存档核查**：R71 时 CI 日志是否同 000=全环境 vs 仅本机病理分水岭；
4. **假设清单书面化**（≥3 互斥各带 Supports/Conflicts/Test）：H1 服务死/路由级失败、H2 fake-ip DNS 污染、H3 代理出口地理屏蔽、H4 TLS/证书客户端病理。
- **验收**：测绘实录+常量值+CI 核查结论+假设清单四件套落 `evidence/`。

## T1b — 存量宣称审计（覆盖 D-003 §1；独立 DoD 不埋考古）

1. **种子化位置 grep 清单**：R71 直接种子 memory 行的所有位置（断言绕验点全枚举）；
2. **逐条判定表**：现存宣称每条 PASS/FAIL/RESHAPE；RESHAPE 必带回流票文名。
- **验收**：判定表齐+RESHAPE 各带具名票文名→`evidence/t1b-claims-audit.md`。

## T2 — 判别实验矩阵（覆盖 D-003 §1）｜1d

1. **~5 必测探针**（curl -v 级最小化，不重演业务流量）：每格须区分≥2 假设否则裁；**必含预期推翻偏爱假设的格子**；
2. **环境维**：代理+fake-ip / 代理+真 DNS(DoH) / 直连 / CI runner 四列；**DNS 解析路径维**分 H2/H3；
3. **MCP 镜像对照组**：结论限写「后端+本机出口面活着」；若 MCP 也 000→假设坍缩为服务死/全出口断，更快收敛；
4. **fake-ip=环境常量**：先测值再恒定，中途不切代理。
- **验收**：探针 transcript 全归档 `evidence/t2-matrix.md`+每格判定归属假设集。

## T3 — 诊断书（覆盖 D-002 §3+D-003 §1+D-005 §4）｜与 T4 合并 0.5d

1. **诊断书**=已证伪集+剩余假设+证据索引+**三分支推荐**（复活→live 验证+去种子化立项 R82 / 死但可修→修复路线 / 死且外部不可控→如实降级宣称或换 provider）；落 `.scratch/grill-round-81/`；
2. **推荐非裁决**：裁决权归 ADR-0082（用户拍板）；Options Considered 必须引用诊断书三分支不另立未验证选项；
3. **降级收口形态**（超时触发）：已证伪集+未测假设+阻塞证据→具名门控票携带原 H#+Test 字段随票转移。
- **验收**：三分支完备+证据链可溯；与账本冲突→revised 呈报禁静默。

## T4 — 文书收口（覆盖 D-003 §4+D-005 §3-5；docs-only）

1. **ADR-0082**：产品吸气轮主题+插曲协议立法+spike 三分支裁决+R1 幂等跳过+失败分级（C1/C2a/C2b/C3+unpublish 边界）+决策/推荐分离判据+**rejected alternatives**（并行腿/unpublish-first/最小收口/staged publishing/dry-run 验证）；
2. **registry**：`defer-r71-provider-serverside`→closed 或 reshaped（canonical normalize 全程）+其余 open 债 carried_log r81；
3. **宣称修正落实**：每 RESHAPE→具名票（票文名+验收面非描述行）；
4. **文书**：CONTEXT 新词回填（若有新词）+`handoffs/next-round.md`（R82 具名立项项：修复码/宣称修正执行/剩余假设门控票带 H#+Test）+**判据↔证据映射表**+度量单行；
5. **publishing.md** 补失败分级节（C1/C2a/C2b/C3+unpublish 边界——ADR 裁决的操作化落点）；
6. but 干净收尾。
- **兜底**：不可达验收项→如实记「未验」非豁免；timebox 超时→降级收口书面决定（续投/转窄/接受不确定性三选一），禁挤压后段。

## 红线

- 实测与账本冲突→对应 D-xxx 标 revised+新 D 呈报用户拍板，禁静默改向；
- spike 只产推荐不裁决；修复码不动（R82 域，Lacey 规则）；
- T2 中途不切代理（环境常量纪律）；探针最小化不重演业务流量；
- MCP 对照结论措辞限「后端+本机出口面活着」；
- unpublish 非默认工具（deprecate/patch-forward 优先）；用户三扳机不代扣；
- 票间禁跨改（TI 不动 spike 面/spike 票不动发布面）；
- gh/npm/CI 外部实况不可达→记「未验」非静默跳过；
- timebox 超时→降级收口书面决定，「Never deciding」为反模式。

## Suggested skills

`$implement`（票流驱动）· `$but`（版本控制）· `$atomcode-research`（诊断死角补查预备）· `$handoff`（收口）· diagnosing-bugs（假设判别纪律，model-invoked）· writing-for-agents（诊断书/ADR-0082/publishing.md 分级节文体）。
