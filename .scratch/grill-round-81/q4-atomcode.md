# R81 Q4 — 发布插曲协议分级语义 atomcode 调研存档

Question 原文：.scratch/grill-round-81/q4-prompt.txt
Date: 2026-09-24 · atomcode（官方文档+一手 issue 双验，Confidence 高）

## 1) 执行摘要

提案 A 分级骨架（C1 复跑/C2 deprecate+patch-forward/unpublish 仅灾难）与 npm 官方政策和业界惯例高度对齐，**推荐采纳，需四处修订**：
- R1：C1「同 tag 复跑」成立前提是 publish 腿补**幂等跳过**（已发版本重发被 cannot publish over 拒，set -e for 循环会二次失败）——lerna/changesets 皆有官方答案而裸循环缺此环；
- R2：C2 deprecate 已落地但内容正确的子集是**可选非必做**，patch-forward 才是核心；
- R3：TP 配置外部不可验已被 npm 官方明文证实（保存不校验发布才暴露），npm view packument 不含 TP 字段——「用户声明+首次 OIDC run 成功+provenance」即业界验证惯例本身；
- R4：72h unpublish 窗有隐性失效（第三方空包 * 依赖可投毒锁死）→unpublish 更不可作安全网。

## 2) 对比矩阵：三个回滚工具的正确使用面

| 项 | unpublish | deprecate | patch-forward |
|---|---|---|---|
| registry 语义 | 删条目；version 名永久烧毁（unpublish 后也不可用） | 保留可下载装时警告；整包 deprecate 掉出搜索 | 正常新版本 |
| 准入 | <72h 且无依赖者；>72h 需无依赖+周下载<300+单 owner 同满足 | 无条件 | 无条件 |
| 可逆性 | 不可逆；整包全撤后 24h 禁发新版 | 可逆（deprecate pkg "" 撤销） | 不可逆但无害 |
| 官方立场 | 「因为事故会发生才允许」不推荐 | strongly recommend over unpublish | 推荐（deprecate 消息指向新版） |
| 正确使用面 | 仅灾难性事故（恶意内容/许可违规）+数小时内 | 默认工具 | version burned 后标准恢复路径 |

## 3) 分点结论

**Q1 分级心智**：npm unpublish 政策——registry 不可变，package@version 一经使用永不可复用；<72h 无依赖者可撤；>72h 需无依赖+周下载<300+单 owner 三条同满足；不满足官方 recommend deprecating。deprecate 文档 strongly recommend deprecating instead of unpublishing——deprecate=默认工具，unpublish=例外通道，分界线划对。72h 窗真实约束更脆：社区判词实录三年前空包 * 依赖引用新包名→发布后数分钟内都无法 unpublish（依赖检查不看依赖发布时间戳）→走 36h DMCA。「unpublish 窗口内也不是可靠可用的」→不能当回滚安全网设计。version-burned 下 patch-forward=标准答案（官方 must publish a new version even if you unpublished + deprecate 消息惯例指向新版）。

**Q2 原子性**：业界无真原子性只有两种补偿——①幂等跳过重试（lerna FAQ 已读原文：retry 同令自动 skip 已发包；lerna publish from-git 同 tag 复发同版=C1 直接惯例依据）；②预跳过（changesets publish 前逐包 npm info 检查已发即 skip）。裸 for 循环两者皆无。npm publish --dry-run 不是真发前验证：npm/cli#4927 实测 dry-run 不做认证/版本冲突校验，对已发版照样成功——只验 pack 文件清单验不了 OIDC/版本/TP（与本仓「OIDC 握手只能真发验」互证升级官方背书）。失败先例：lerna#4349（tag 已推发布未完→复跑因 tag 卡死，官方建议删 tag 重来）、semantic-release#2328（tag 挡复跑长期痛点）、changesets/action#579（诉求：部分成功打 per-package tag+提前预判失败全量不发——未实现）。结论：CI 复跑同 tag 可行且是惯例（from-git 模式），前提是 publish 脚本自带 skip-already-published。

**Q3 TP 特殊失败**：TP 文档明文 npm does not verify your trusted publisher configuration when you save it…errors will only appear when you attempt to publish——「用户声明+tag run 结果」不是妥协是唯一惯例。业界验收=「配 TP 后发一个 release，到包页确认走 Trusted Publishing 且有 provenance」。npm view 查不到 TP 配置（packument 只含 versions/dist/attestations；TP 在账户侧 registry API 仅写端点）——查不到也不用查，验证面=run 结果+provenance。ENEEDAUTH 排障：workflow 文件名逐字符（含 .yml 大小写）+id-token:write+GitHub-hosted runner+repository.url 精确匹配；allowed-actions 漏勾=2026-09-03 新默认下只许 stage publish。首发 fail-fast 惯例=「包必须先存在」+最小验证集（npm/cli#8910 官方：先发布才能配 TP；bootstrap-publish.yml 一手：事前 npm view 探测包已存在则拒+事后拆脚手架）——本仓预首发设计同构顺序正确。首发五包同 tag 时 dsh-plugin 是唯一新包——TP 字段错则前四包照发 dsh-plugin 败=C2；务实做法=单独盯 dsh-plugin 的 publish 步日志（ENEEDAUTH/E403 第一时间可辨）不等全循环。

**Q4 插曲协议对应物**：oncall runbook+事件证据保全（NIST SP 800-61r3）：证据先于处置（打断先写诊断书=正确）+自动化幂等全程留痕+复盘回灌。checkpoint/resume 同构（OpenExpertise oe resume 从 checkpoint 回放已完成不重跑）。每事件一份 transcript（时间戳+npm view+attestations JSON+冒烟+run URL+结论行=post-mortem one-pager）——无业界异议直接采纳。

## 4) 对提案 A 的修订意见与推荐

采纳 A 带四修订；B（unpublish-first）违官方强烈建议且依赖可投毒锁死窗口否；C 不立语义违 fail-closed 风格否。

| # | 修订 | 依据 |
|---|---|---|
| R1 | C1 复跑同 tag 前置条件=publish 腿补幂等跳过：每包 publish 前 npm view <pkg>@<version> 存在则 skip 记录；或容忍 E403 cannot publish over 视为 skip 非 fail。否则 gh run rerun 在首个已落包二次失败，C1 空转。lerna FAQ+changesets pre-skip 共同惯例，本轮唯一需动 release.yml 机械形态的修订 | lerna FAQ；changesets#2164/#2099；semantic-release#2328 |
| R2 | C2 deprecate 降可选：已落子集内容正确（失败仅在后续包）→默认不 deprecate 直接 0.0.9 patch-forward 全五包；仅当已落子集本身内容错（产物/manifest 错）才 deprecate 该子集（deprecate 定位=警告勿用非标记未完成；lerna 部分成功不 deprecate 已发包） | npm deprecate 文档+lerna 先例（推导惯例非成文） |
| R3 | TP 验证条款写实：三件=用户配置声明（四字段截图/transcript）+首次 OIDC tag run 绿+该包 dist.attestations 非空/包页 Provenance 徽章；注明 npm view 查不到 TP 配置；加信号=发布确认邮件标 via OIDC vs via token 作旁证 | docs.npmjs.com/trusted-publishers；json-type-extractor publishing.md；npmdigest |
| R4 | unpublish 边界自保句：72h 窗内若第三方包依赖已发子集（哪怕空包 * 引用）unpublish 被 registry 拒→唯一路径回 deprecate+patch-forward。防插曲现场误判「窗内必可撤」 | npm unpublish 政策附社区判词 |

其余维持 A 原案：三扳机验收清单、C3 全发冒烟败→deprecate+0.0.9、插曲证据面 transcript、中断点先写诊断书、未触发诚实记录——双源支撑不需改。

## 5) 完整来源清单

| 标题 | URL | 角度 | 贡献 |
|---|---|---|---|
| npm Unpublish Policy | docs.npmjs.com/policies/unpublish/ | Official | 72h 窗、version-burned、deprecate 建议、24h 锁、投毒锁死判词 |
| Deprecating and undeprecating | docs.npmjs.com/deprecating-and-undeprecating-packages-or-package-versions/ | Official | strongly recommend deprecate、可逆 |
| Trusted publishing for npm | docs.npmjs.com/trusted-publishers/ | Official/Currency | 保存不校验、ENEEDAUTH 排障、repository.url 匹配、allowed-actions 新默认 |
| npm/cli#4927 | github.com/npm/cli/issues/4927 | Criticism | dry-run 不验认证/版本冲突一手实测 |
| semantic-release#2328 | github.com/semantic-release/semantic-release/issues/2328 | Community | tag 挡复跑痛点 |
| Lerna FAQ publish 重试 | github.com/lerna/lerna | Official | 同 tag 复跑+skip-already-published 惯例 |
| changesets/action#579 | github.com/changesets/action/issues/579 | Criticism/Currency | TP 语境部分发布之痛、预判失败诉求未实现 |
| changesets#2099/#2164 | github.com/changesets/changesets/issues/2099 | Criticism | pre-skip 机制；OIDC 下 npm info 404 误判 |
| npmdigest TP 指南 | npmdigest.com/guides/npm-trusted-publishing | Comparative/Currency | bootstrap gap、每包配 TP、via OIDC/token 邮件信号 |
| bootstrap-publish.yml | github.com/pauldeng/node-red-contrib-dapr-http/.../bootstrap-publish.yml | Official 一手 | 预首发 fail-fast 全套（事前探测+事后拆脚手架） |
| json-type-extractor publishing.md | github.com/ll1r1k-1337/json-type-extractor/.../publishing.md | Community | ENEEDAUTH/E403/E404 语义表、发 release 验 TP+provenance 惯例 |
| npm/cli#8910 | github.com/npm/cli/issues/8910 | Community | 包必须先存在才能配 TP 官方确认 |
| NIST SP 800-61r3 playbook 映射 | github.com/KM-it-ops/incident-response-playbooks/.../nist-800-61-playbook.md | Official | 证据先于处置、幂等留痕、复盘回灌 |

## 6) 信息缺口

- npm 官方未公布「同 tag workflow rerun 时 OIDC token 重新签发」机制文档——rerun=新 run id+provenance 重生成，无已知阻塞（低风险推断）。
- pnpm -r publish 失败语义未单独深挖（本仓 npm 直发不构成依赖；changesets#2184 侧写差异）。
- 「deprecate 已落正确子集 vs 保留」无直接判例文献——R2 是从工具语义+lerna 先例推导的惯例非成文规则。
