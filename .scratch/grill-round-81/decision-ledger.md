# Grill Round 81 — Decision Ledger

## D-001 — R81 主题定界（产品吸气轮 + 发布插曲协议）

- **原问题**：R81 主题定界——A 产品吸气轮+发布插曲协议 / B 发布执行轮（按审计序原文）/ C 双轨 / D 最小等待轮。
- **原回答原文**：「A」
- **规范化需求**：
  1. R81=产品吸气轮：主轴=deferred-registry 在册产品形债一条（择货为后续题）。
  2. 发布执行不立轮腿，立为**触发即插的插曲协议**（interrupt protocol）：用户扣任一扳机（手发 @anysearch-cli/dsh-plugin@0.0.7→npmjs TP 四字段+勾 npm publish→推 v0.0.8 tag）→ 轮暂停 → 跑 docs/publishing.md 发布后 checklist（dist.attestations 校验+装跑冒烟+CI run URL 回填+provenance 边界核对）→ 归位续票。
  3. 发布事件优先级高于轮内票序（触发即 preempt），但其等待期不构成空转理由。
- **显式约束/负向需求**：发布执行不单独成轮腿（验收面不共享，违内聚三判据）；不把「等扳机」作为轮内容；产品择货须为 registry 在册可执行项（非新发明项）；dsh 双锚哨戒/#1764 merge-watch/CI flake-watch 续挂为背景义务，不构成主轴。
- **状态**：current

## D-002 — R81 主轴择货（provider-serverside spike，调研修正版）

- **原问题**：R81 主轴择货——A+ provider-serverside spike（硬 timebox+三分支裁决+修复码出域）/ A++ A 主轴+C 并行腿（须 D-001 revised）/ B dsh-native-tools / C web-interactive-matrix / D f17 或另指。
- **原回答原文**：「采纳」
- **规范化需求**：
  1. R81 唯一主轴=`defer-r71-provider-serverside`：诊断 R71 spike 时 provider 检索端点对 live search 返回 HTTP 000 的 server 侧病因（挂 5 轮，deadline 2026-12-31）。
  2. Spike 纪律：硬 timebox（2-3 天量级）；超时未决→转 implementation task 立项下轮，防 Never-Ending Spike 反模式。
  3. DoD=诊断书+**三分支裁决**三选一：(a) 端点复活→live 验证+去种子化（修复码立项 R82）；(b) 死但可修→修复路线裁决；(c) 死且外部不可控→如实降级宣称或换 provider。三出口均核销债或修正宣称，无空轮。
  4. 修复码出本轮域（Lacey 规则：spike 产出的后续工作归下一 sprint）。
- **显式约束/负向需求**：不加并行腿（D-001 单一主轴不破，atomcode「C 并行腿」建议呈报后否决）；`dsh-native-tools` 不立主轴——触发器检查并入 dsh 哨戒义务续挂；`dsh-web-interactive-matrix`/`f17-quarantine-ids` 续债；api.anysearch.com 域名 ownership 未决不构成阻塞（legal/ops 独立债，影响修复路径可达性不影响病因诊断）。
- **状态**：current

## D-003 — Spike 作战方案（A′ 五段式，调研修订版）

- **原问题**：spike 作战方案票序与验收形态——A′ 五段式（调研修订：T1 拆 T1a 侦察+T1b 宣称审计、T2 判别矩阵、T3+T4 合段）/ B 单票突击 / C 先裁决后侦察 / D 另取舍。
- **原回答原文**：「采纳」
- **规范化需求**：
  1. 票序：T0 哨戒续班（骑缝非腿：dsh rc.3/alpha.1/alpha.2 出闸复检+#1764 merge-watch+CI flake-watch+dsh-native-tools 触发器检查）→ **T1a 网络/设施侦察**（端点现状测绘：证书/DNS/路由面/status 子域对照 R58 活体记录；本机 fake-ip 代理环境审计；**CI 日志存档核查** R71 时 CI 是否同 000=全环境 vs 仅本机病理分水岭）∥ **T1b 存量宣称审计**（种子化位置 grep 清单+每条现存宣称逐条 PASS/FAIL/RESHAPE，RESHAPE 带回流票文名——独立 DoD 不埋考古）→ **T2 判别实验矩阵**（每格须区分≥2 假设否则裁；必含预期推翻偏爱假设格；最小充分矩阵=4 列代理+fake-ip/代理+真DNS/直连/CI × 3 行，含 DNS 解析路径维；必测格≈5 探针半天级；fake-ip=环境常量非变量中途不切代理；MCP 镜像对照组结论限写「后端+本机出口面活着」）→ **T3+T4 裁决书+文书收口**（诊断书含已证伪集+三分支推荐→ADR-0082 Options Considered+registry+宣称修正清单+R82 立项项）。
  2. 假设清单为 T1a 书面 exit criteria：≥3 个互斥假设（H1 服务死/路由 404；H2 fake-ip DNS 污染；H3 代理出口地理屏蔽；H4 TLS/证书客户端病理），各带 Supports/Conflicts/Test。
  3. timebox 2.5 天等效分配 .25/.75/1/.5；每段书面 exit criteria；T1 或 T2 超时→**降级收口**（已证伪集+未测假设+阻塞证据入诊断书，剩余假设变下轮 spike 门控票=R68 D-003 形态），非挤压后段。
  4. 产物归属：诊断书落 .scratch/grill-round-81/，裁决归 ADR-0082（spike 只产推荐），票文引用不复制。
- **显式约束/负向需求**：MCP 对照组结论措辞限「后端+本机出口面活着」；探针=最小化（单 curl -v 级，不重演业务流量）；分支裁决权归轮收口 ADR-0082 不归 spike 产物；修复码仍出本轮域（D-002 Lacey 约束不变）。
- **状态**：current

## D-004 — 发布插曲协议细则（分级语义 + 调研四修订）

- **原问题**：发布插曲协议触发后操作面+失败语义分级——A″ 分级协议+R1–R4 修订 / B unpublish-first / C 不立语义当场即兴 / D R1 推迟为 tag 前置条件 / E 另取舍。
- **原回答原文**：「采纳」
- **规范化需求**：
  1. **R1 幂等跳过补丁（插曲就绪小票，轮内落）**：release.yml publish 腿补 skip-already-published——每包 `npm publish` 前 `npm view <pkg>@<version>` 存在则 skip 并记录，或将 E403 "cannot publish over" 视为 skip 非 fail；裸 `set -e` for 循环无此环则 C1 空转。判定属插曲协议域（D-001）非 spike 修复码（D-002 域外约束不冲突）。
  2. **三扳机验收检查**：(a) 手发 0.0.7→`npm view dsh-plugin@0.0.7` 存在性+license；(b) TP 配置→外部不可验（npm 官方：保存时不校验，错误仅发布时暴露；`npm view` packument 不含 TP 字段）→验证三件=用户配置声明+首次 OIDC tag run 绿+该包 `dist.attestations` 非空/包页 Provenance 徽章；旁证=发布确认邮件标 "via OIDC" vs "via token"；(c) 推 tag→盯 run→`npm view` 五包×{version,attestations}→装跑冒烟（`npm i -g cli@0.0.8`+`ans doctor`+`dsh plugin add`）→CI 矩阵绿→run URL 回填交接件。
  3. **失败分级**：C1 零发布失败→修因+`gh run rerun` 同 tag（前提 R1 落地）；C2 部分发布分两支——C2a 基础设施因（TP 字段/瞬断）且已落子集内容正确→修因+复跑补全 0.0.8（skip 生效，失败包版本未落地未烧毁），C2b 已落内容本身坏→0.0.9 patch-forward 全五包、仅子集有害才 deprecate；C3 全发但装跑冒烟败→deprecate+0.0.9；unpublish 仅灾难性事故（恶意内容/许可违规）+数小时内+自保句（第三方依赖可投毒锁死 unpublish→唯一路径回 deprecate+patch-forward）。
  4. **首发观察点**：五包同 tag 首发 run 中 dsh-plugin 是唯一新包——单独盯其 publish 步日志（ENEEDAUTH/E403 第一时间可辨，不等全循环）。
  5. **插曲证据面**：每触发事件一份 `.scratch/grill-round-81/evidence/release-interlude-<n>.md`（时间戳+npm view transcript+attestations JSON+冒烟 transcript+run URL+结论行）；中断点规则=T2 探针中途被扳机打断先把当前探针态写进诊断书再切换；未触发诚实记录=轮收口时扳机未扣则取证段如实记「未触发」非空段。
- **显式约束/负向需求**：unpublish-first 否决（官方 strongly recommend deprecate over unpublish+窗口可被第三方依赖投毒锁死）；不立语义当场即兴否决（违 fail-closed 风格）；`npm publish --dry-run` 不构成认证/版本/TP 验证（npm/cli#4927 实测只验 pack 清单）；deprecate 已落正确子集非必做（deprecate 定位=警告勿用非标记未完成）；`gh run rerun` 同 tag 复跑仅在 R1 落地后有效；发布执行仍不升级为轮腿（D-001 维持）；R1 补丁实现粒度（npm view 前置检查 vs E403 容错）为票内实施细节。
- **状态**：current

## D-005 — R81 收口判据（三段收口 + 两补项，调研修订版）

- **原问题**：R81 收口判据——A+ 三段收口+两补项（决策/推荐分离判据行+降级 Test 随票） / B 最小收口 / C 另取舍。
- **原回答原文**：「采纳」
- **规范化需求**：
  1. **取证段**：T0 哨戒实录四线结论行（dsh rc.3/alpha.1/alpha.2 出闸复检+#1764 merge-watch+CI flake-watch+dsh-native-tools 触发器检查结论）+插曲证据（触发→release-interlude transcript 齐；未触发→如实记「未触发」）+T1a 实录（假设清单 H1–H4 书面化+端点测绘 vs R58 活体记录+fake-ip 常量值+CI 存档核查结论）+T1b 宣称逐条 PASS/FAIL/RESHAPE 判定表+T2 探针 transcript（~5 必测格含预期推翻格实测结果）+T3 诊断书（已证伪集+剩余假设+三分支推荐）。
  2. **就绪段**：R1 skip 补丁落地+**双格验收**（对已发包如 embedding@0.0.7 实测 check→skip 记录；对未发包 npm view 非零退出→不误判、正常 publish 继续）+turbo check/test 绿+ship-gate 全绿（1u 新鲜度承袭——诊断轮新增可推导声明如种子化 grep 命中数须注册 closeout-claims）+install 无脏。
  3. **文书段**：ADR-0082+registry 核销/更态（defer-r71-provider-serverside→closed 或 reshaped）+宣称修正落实（**每 RESHAPE→具名票**带票文名+验收面，非一条描述）+CONTEXT 新词（若有，如「已证伪集」正式化）+handoffs/next-round.md（R82 具名立项项：修复码/宣称修正执行/剩余假设门控票）+判据↔证据映射表+but 提交干净。
  4. **判据行+（决策/推荐分离显式化）**：ADR-0082 持有裁决（Decision），诊断书只含推荐（Recommendation）；ADR-0082 的 Options Considered 必须引用诊断书三分支，不得另立未经验证的选项。
  5. **兜底**：timebox 超时→降级收口（已证伪集+未测假设+阻塞证据→**具名门控票携带原 H# 编号+Test 字段随票转移**，下轮可无损续接）；不可达验收项→如实记「未验」非豁免；降级本身是书面化决定（续投/转票/放弃三选一），非默认拖延。
- **显式约束/负向需求**：B 最小收口否决（findings 未捕获=业界实测头号失败形态）；模拟 registry 与 `npm publish --dry-run` 均不构成 R1 验收（npm/cli#4927+rfcs#387 官方证：无内建幂等开关、dry-run 不验认证/版本）；staged publishing 不采用（npm 11.15+ 且不支持新包首发）；「Never deciding」反模式禁——timebox 结束必须书面决定；收口判据属本轮文书域，spike 产物仍只产推荐（D-003 约束升格为显式判据行）。
- **状态**：current
