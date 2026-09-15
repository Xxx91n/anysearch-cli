# atomcode 调研 — Q8: 0.0.1 首发收口判据设计（2026-09-15, grill-round-63）

## 1) 执行摘要
**推荐 A（Closure evidence 四部结构），Confidence 高**——它是业界“证据锚定收口文档”（evidence-anchored release record）标准形态：每条判据携带可解析外部证据锚点而非勾选框，与 D-009 已确立模式同构。**B（self-witness）判死刑**：CI 为自己发布作证是逻辑环（裁决者与被裁决物同源），且 D-006 手动发布使 CI 根本不在发布事件现场=盲证。**C 判否**：违反 Evidence Anchor Resolvability（“policy not codified = doesn't exist in auditor's eyes”）。新发现：**手动首发天然无 npm provenance**（provenance 强制要求 cloud-hosted runner CI），必须写进裁决书防未来误读为缺陷。

## 2) 分点结论
### 2.1 收口文档心智模型（A 四部件全有业界原型）
- 三位一体：判据+证据锚点+可复验（ones.com 审计就绪清单原文：“证据应数秒可产出，不散落在聊天线程”）；未 codified 的判据审计语义=不存在→C 死刑。
- 证据新鲜度：go/no-go 须 backed by live data（TestCollab）——A(i) 要 main tip 绿 run 而非历史绿，正对应。
- 裁决书三态出口（bettersheepdog 30年 PM 实践原文）：判据先于会议确立；每条带 RAGB+签核证据；证据会前锁定；出口=GO/NO-GO/**GO WITH CAVEATS**（带病项 minuted、定时关闭、关闭判定权可显式委托 PM 无需重开终审）。
- Google SRE ch8（原文）：发布源自特定源码版本（main tip+tag 锚定）、过程幂等强制、每步结果落日志。LaunchDarkly 五阶段模型 post-release 单列（retrospective 更新清单）。
### 2.2 self-witness vs 外部见证
- B=逻辑环+缺席见证双重缺陷；其产出物（绿 run URL）可作 A(i) 的**输入证据**被引用，但须如实标注 self-witness 层、依赖 hosted runner 隔离+可解析性，不宣称密码学级。
- **D-009 模式准确定位：“可解析的自证”**——比裸自证强（任何人可开 URL 独立核对、hosted runner=SLSA Hosted L1-L2 隔离）但非密码学外部见证，位于 Hardened 与 Anchored 之间；如实写进 Closure evidence 是诚实，宣称“充分见证”是不诚实。
### 2.3 发布后验证（A(iii) 三段全有业界支撑）
- registry manifest 复核：npm unpublish 政策原文——registry 不可变事实源，“版本不可改、名字烧毁不可再注册”；npm view 输出=最强证据锚点（复核 versions/dist-tags.latest/access/repository 字段一致性）；有 provenance 时 npm audit signatures 复核。
- 净机安装：发布后验证**必须从 registry 拉取**——发布前验证测“pack 产物正确”，发布后测“registry 端到端分发正确”，两者是不同事实。本仓 install-smoke 15 项断言已是成熟实现，A(iii) 直接复用其日志。
- 本项目特有坑须写执行注意：①min-release-age=2 自拦（净机自验须 npm CLI 直装指定版本或临时关 pin，否则把自己门误判“发坏了”）；②冒烟须覆盖全部声明支持配置——D-002 教训：FTS-only 降级若属受支持配置，净机冒烟必须含该路径，否则冒烟通过≠所有声明配置可用。
- post-release 是独立阶段：发布成功≠发布正确，需不同证据。
### 2.4 no-go 反悬置（A(iv) 正是业界形态）
- no-go 必须 minuted 差距清单+复评机制（scheduled re-meeting）——缺此二条=永久悬置。
- GO WITH CAVEATS：留痕项带 owner+期限+关闭判据+关闭判定权显式委托（不必每次重开终审）；Chromium/GO_NO_GO.md Conditional Go 同构（KNOWN_LIMITATIONS.md 带 owner+due date）。
- 复评触发=事件驱动（“Blocker 修复+main tip 双绿 run”可观测事件），辅日历兜底（如 30 天未触发强制复评防静默搁置）。
- Go 后回滚出口有界：npm unpublish 72h 内且无依赖者可撤；超窗降级 npm deprecate——**A(iii) 净机自验须在 72h 窗口内完成**（回滚安全网有效期的硬约束）。

## 3) 推荐（三处强化）+ 冲突声明
1. A(iii) 显式记录 provenance 缺位：“0.0.1 手动首发无 provenance/attestation，系 D-006 已知后果而非缺陷；CI trusted publishing 落地时补齐升级证据层级”——防 LYING 漂移条款。
2. A(iii) 净机自验两硬约束：72h unpublish 窗口内完成；冒烟覆盖全部声明支持配置（含 FTS-only）；绕开 min-release-age=2。
3. A(iv) 复评触发事件驱动+日历兜底；带病项逐条 owner+due+关闭判据。
冲突：B 与 Gate-of-the-Gate 直接冲突（且缺席见证）；C 与 Evidence Anchor Resolvability 直接冲突；A 与 D-001~D-007、D-009 无冲突；canonical-rewrite 豁免判据须成文不默认豁免（防滑坡）。

## 4) 来源清单
npm provenance/trusted-publishers/unpublish 官方文档（原文）· OSSF npm Best Practices · SLSA 证明/验证分离 · Google SRE Book ch8 Release Engineering（原文）· ones.com audit-ready release management（原文）· TestCollab release-readiness · bettersheepdog Go/No-Go 30 年 PM 实践（原文）· Chromium GO_NO_GO.md · inventive.ai/nTask no-go 复评 · assay 信任阶梯（self-witness 分层）· LaunchDarkly 五阶段（知识库在档）· 知识库：本仓 install-smoke 15 断言、前轮调研

## 5) 信息缺口
- npm unpublish 精确时限已补读官方原文（72h+条件）。
- staged publishing 的细节机制（CI 提交/人审批衡）本轮未逐字核验——D-006 已定手动首发，不阻塞。
- “净机自验”在 Windows 本机与干净沙箱的等价性（本机已登录 npm、缓存等污染面）未在调研范围——票内执行注意项。
