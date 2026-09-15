# atomcode 调研 — Q5: npm 发布形态（2026-09-15, grill-round-63）

## 1) 执行摘要
**推荐 A（全发7包+peer-optional）为主方案，置信度高（机制层）/中（代价层）；同时挖出候选清单逻辑缺口——第三路 A′**：把已 bundle 的 @anysearch/* 死声明从 dependencies 移到 devDependencies（源码内改动），registry 面缩到 3 包且零漂移。真正的选项空间=**A（发全部）vs A′（bundle-CLI 模式）vs D（不发）**——B/C 是同一错误答案的两个变体（任何含 @anysearch/* 普通 deps 的发布包，出路只有“那些包也在 npm 上”=A 或“发布期删声明”=B 机器；C 想发单包就必须走剥离，机制上退化为 B）。

## 2) 分点结论
### 问题1：monorepo 发 bundled CLI 的三模型
- 模型一 publish-everything（Vue/Next/MUI/Prisma/Vite）：前提是内部包有独立消费者价值+需 changesets 版本机器；kernel/store/retriever 0.0.1 的 API 形状大概率还动→存疑。
- 模型二 bundled-CLI（LaunchDarkly highlight.run 一手先例：“要发布但不想发布内部 client 包”，bundler 吞私有包；tsup#1251 高频诉求；jlevy 判断表：CLI 适合 bundle、library 不该 bundle）——与现状（tsup noExternal+11MB dist）最对齐。
- 模型三拆独立仓库：7 包强耦合不适用。
- **现状=“模型二 bundle 产物 + 模型一声明残留”混合态——死声明的根源**。
### 问题2：optionalDependencies vs peer-optional（最硬事实面）
- optionalDependencies=默认安装，仅失败时降级 warning；正确定位=平台分发 native 二进制（nx-darwin-arm64 模式）。
- peerDependencies+peerDependenciesMeta.optional=npm 不自动装、缺席无 warning（npm RFC 0030 implemented）；正确定位=宿主可选增强。
- embedding（重 native+fail-open 可选能力）语义上是可选能力增强→**peer-optional 才是机制正确**；现状 optionalDep 指向 private 包是机制错用（每次安装拉一个注定 404 的声明产生噪音；且未来 embedding 一旦上 npm，optionalDep 瞬间变回自动安装→炸弹回归）。
- 新验证义务：peer-optional 下 npm i -g cli && npm i -g embedding 同落 global node_modules 根、Node 解析可达——须进 ADR-0020 pack+install 验证步。
### 问题3：workspace 处理与 manifest 漂移先例
- pnpm 官方：pack/publish 时 workspace:* → 实版本，工具内建、确定性、语义保持；npm publish 不改写（pnpm#6941 出路=@pnpm/exportable-manifest 脚本=自建机器）。
- **getlang 反例（changesets#1389，原文）**：非 pnpm 通道发布、workspace: 前缀留在发布 manifest→pnpm add 对所有用户直接安装失败（ERR_PNPM_WORKSPACE_PKG_NOT_FOUND）——错误发布 manifest=“用户第一次 npm i 就炸”级故障。
- **治理灰点须裁决**：A 的 tarball manifest 也≠仓库 manifest（workspace:*→版本号），豁免判据建议写进 ADR——“改写必须由包管理器 canonical 语义覆盖，禁止自建 transformer”，同时永久封死 B 类。
### 问题4：npm 首发实务
- scoped 默认 restricted→首发须 --access public 或 publishConfig.access（后者进源码 manifest，更稳）。
- 2FA：人号 auth-and-writes；CI 用 GAT+bypass-2FA 或 staged publishing（CI 免 2FA 提交、人审批准需 2FA——0.0.1 合理）。
- provenance：需 id-token:write+--provenance；前置阻塞=repository 字段须与 npm trusted publisher 配置一致（当前缺）；trusted publishing 需逐包在 npmjs.com 配置且包须先存在（与“首发即 provenance”顺序耦合）。
- 门序：ship-gate（pack+tarball 离线装验证）→pre-tag 评测门（release.yml）→tag→publish。
### 问题5：内部包上公共 registry 的代价
- 代价：npm 发布基本不可撤销、名字烧毁不可再注册（0.0.1 内部包 API 形状=永久承诺）；公共包=issue 磁铁+token 被盗推送面；**缺 LICENSE/license 字段=法律上保留所有权利，用户无合法使用授权——共享 Blocker 级前置清障**。
- 收益：@anysearch scope 空闲——先注册占名是零成本防 dependency-confusion（微软 2026-05 记录 33 个攻击包），无论 go/no-go 都建议做；embedding 发布后 peer-optional 的显式加装通道才有 npm 侧实体。

## 3) 对比矩阵（要点）
A：零手术但 registry 7 包、内部包 API 承诺化；A′：bundle-CLI 正确心智、3-4 包、源码改动全可见 review、唯一新增义务=ship-gate 断言 dist 无裸 @anysearch/* require；B：自建改写机器=漂移面本体+getlang 破包先例；C：退化为 B；D：不答 D-001。

## 4) 冲突声明
- A 与 D-001 无冲突；embedding 改 peer-optional 应作为 D-002 关联项显式记录（Install Closure 的机制化落地，防误读为发版顺手改）。
- A 灰点：pnpm rewrite 的豁免判据须写 ADR，否则滑坡。
- B 违反治理（自建改写=漂移面；若选 B 按 LYING-Class 不得宣称 manifest 零手术）。
- LICENSE/license/repository 缺失=所有 npm 选项共享 Blocker。
- min-release-age=2 与首发自验的交互进 ship-gate 文档。

## 5) 来源清单
pnpm.io/workspaces（原文）· npm package.json 官方文档（原文）· npm scoped public packages（原文）· npm threats-and-mitigations · LaunchDarkly publishing-private-pnpm-monorepo 教程（原文）· Turborepo publishing-libraries（原文）· changesets#1389 getlang 破包（原文）· pnpm#6941 · dev.to usapop 双篇（原文）· philna.sh trusted-publishing（原文，2026-01）· GitHub changelog trusted publishing GA 2025-07-31 · npm RFC 0030 · inedo scoping 安全 · tsup#1251 · jlevy pnpm-monorepo-patterns

## 6) 信息缺口
- npm unpublish 政策精确时限未读原文（摘要级信源）。
- pnpm deploy 全文未展开。
- peer-optional 下 pnpm workspace 开发期是否自动 link embedding（auto-install-peers 行为）——票内实测项。
