# R91 Goal — dsh 售后验收轮（L3 实机冒烟 + 已发布物真实性收口）

## 痛点
构建信息专精 Agent CLI，遵循 AnySearch 垂直领域理念。

## 本轮主题（D-001~D-003 已裁）
外部锐评（第九轮）核心指控：0.1.0 已发布的 dsh-plugin 招牌功能（原生五工具）在真实宿主上执行次数为零，而 README verified-hosts 表 dsh 行仍记三代前架构（0.1.5-rc.2/MCP bridge/Cordis bundle）。本轮=售后验收轮：让已发布声明追上证据。

## 正题
dsh 原生工具面 **L3 实机冒烟**：宿主升 0.1.7-rc.2（测=记=钉三版收敛）→pnpm pack→plugin add→--dump-config→诱导 turns→stream-json transcript 取证。
门判据三腿（D-002 预注册）：L3a 装册绿/L3b 枚举绿（transcript model-request tools 载荷）/L3c-min 执行绿（≥1 ans_* 真实调起完成 /mcp 往返，诱导措辞定死+N=3）。增强：L3c-full 五工具矩阵（定 claim 宽窄）。非判据：L3d fail-open 顺验/L3e hooks 免测。判词三分支：全绿解锁改行/仅 a+b 降格措辞+established/not-established 清单/a 或 b 败→F-bug 立项。

## 同域纳编（T4 批）
ship-gate 正则 s*→s* fix；弃用文案双空格 deprecate（外发，R87 D4 记账）；approval-channel 可行性探测（evidence-only）；WORKFLOW.md 终审 ADR 判死（supersede 语义+审计封口）。

## 收口件（T5）
ADR-0092 完成体+CONTEXT 词块+registry 更态+readme-token claims 立法（无条件票，机检首跑登记 R92）+closeout-claims+报告+任务书+CHANGELOG。

## 范围外
repin（0.2.0-rc.2 仅 T0 哨戒记档）；垂域死刑复核（明文排期下轮主轴候选）；web-matrix 主体；评测面/上游债/常驻债；tag/push/publish；pathlint 冻结。

## 治理闸
一票一 commit 类型不混；票级熔断 2-LOOP；失真三向+断言预注册；规则先于行为（判据立法先于探针）；条件票未启不留痕+不携带无条件内容；TC=T0 目击 0.2.0 stable→closing probe，T2 启动后不复观 dist-tags。
