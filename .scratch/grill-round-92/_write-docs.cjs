const fs = require('fs');
const path = require('path');
const R = 'D:\\Aworker\\anysearch-cli';
const S = path.join(R, '.scratch', 'grill-round-92');

/* ============ 1) goal.md（定稿） ============ */
fs.writeFileSync(path.join(S, 'goal.md'), `# Grill Round 92 — Goal

**Status**: frozen（定稿，D-001~D-003 全确认）

## 主题：售后收口续轮【完整版】

正题=T2 复跑（featherless 自定义上游 https://api.featherless.ai/v1 + User-scope DEEPSEEK_API_KEY 注入）——把 R91 F-bug（DEEPSEEK_API_KEY 环境缺位，非机制故障）补成真实判词。判词达标启 README verified-hosts 双语行对齐（README.md:227 / README.zh-CN.md:217，现状=过期 0.1.5-rc.2 + MCP bridge 表述）；readme-token 检查器接线（ADR-0092 D4 两拍第二拍，无条件票）；deprecate 双空格执行尝试（外发，EOTP 呈报）。

## 判据与机制（D-002）

- **机制**：pi-ai 自定义路由 + 新建隔离 profile \`r92-smoke\`——patch 层注入 llm-pi-ai.providers.featherless={apiKeyEnv: DEEPSEEK_API_KEY, api: openai-completions, baseURL: https://api.featherless.ai/v1, models:[{id:'Qwen/Qwen3-32B', contextWindow 按官方目录}]} + agent-default-model 覆写 {provider: featherless, model:'Qwen/Qwen3-32B'}；DEEPSEEK_BASE_URL 路径记 rejected（featherless 无 Anthropic Messages 面）。
- **宿主**：dsh 0.1.7-rc.2 不升不降（exact-build claim + 变量唯一化 + ADR-0090 版本轴/消费轴正交）。
- **凭证**：User-scope 读 DEEPSEEK_API_KEY → 子进程注入；值不落盘不落上下文（仅记变量名与存在性）；preflight 直连探针已实证 200；收尾泄漏探针=transcript 全文 grep key 的 SHA-256 前缀。
- **L3b 取证修订**：主判据=载荷显性可见保留；fallback=transcript 现 ≥1 个 ans_* tool_call 事件→established-via-fallback（新词汇预注册进 ADR-0092 D4 词汇表）；fallback 路径 README 措辞收窄；零改动版记拒绝论据。
- **冻结项**：诱导句 + 模型 id + contextWindow 跑前写入 ADR-0093，跑中不换，N≤3。
- **执行序**：归因探针（已跑：/ 200、/v1/models 404 Gone 双态、completions 401、key 直连 200）→ preflight tool_calls 探针 → profile 装册 → 诱导 turns → transcript/verdict 双工件。

## 票序（D-003）

T0 哨戒+基线 → T1 立法（新 ADR-0093）→ T2 复跑执行 → T3【条件票】README 双语行对齐 → T4 readme-token 检查器接线+shadow dry-run → T5 deprecate 执行尝试 → T6 收口件批 → T7 门禁+审计 LOOP；TC=T0 目击 0.2.0 stable→closing probe，未目击不启不留痕。

## 范围外

repin（latest=0.2.0-rc.2 仅哨戒记档不消费升级判词）；垂域死刑复核（r88-candidate，明文排期下轮主轴候选）；defer-r72-dsh-web-interactive-matrix 主体；评测面 defer-f17；常驻债×5（domain-ownership/f16-macos/r71-transformers/r74-logo/r75-registerhooks）；tag/push/publish。

## 治理闸

一票一 commit 类型不混；票级熔断 2-LOOP；判词词汇从 t2-verdict 一字不差取；T3 不携带立法（收窄措辞预注册）；TC 判定窗口 T0 一次定死不复观；pathlint 冻结；key 值不入档不落上下文；规则先于行为；失真三向+断言预注册承继。
`);

/* ============ 2) CONTEXT.md R92 词块 ============ */
const ctxPath = path.join(R, 'CONTEXT.md');
const ctx = fs.readFileSync(ctxPath, 'utf8');
const block = `

## Grill Round 92 — Terms (ADR-0093)

### Dormant-Route Activation（dormant 路由激活）
dsh 上游注入的官方面形态：dsh-base 把 dsh-llm-pi-ai dormant 挂载——profile patch 层供 config.providers.<name>={apiKeyEnv, api, baseURL, models[]} 即注册活路由；apiKeyEnv 经 credential seam 按名解析，凭证值不落配置文件。_Avoid_: 改 deepseek-official 的 DEEPSEEK_BASE_URL env 覆写端点（该路由锁 Messages 协议，OpenAI-completions 面上游不可达且全局污染默认路由）。来源：dsh-llm-pi-ai README 实测+atomcode R92-Q2+R92 D-002。

### Established-Via-Fallback（fallback 通道证绿）
判词降格档位（ADR-0092 D1 revised-in-part）：L3b 主判据=model-request tools 载荷显性可见保留；载荷不可见但 transcript 现 ≥1 个 ans_* tool_call 事件（实名+arguments）→记 established-via-fallback——枚举发生的充分不必要条件，README claim 措辞相应收窄。_Avoid_: 载荷不可见时把枚举直判绿；通道缺失永久惩罚机制本身；fallback 措辞现场拟（须 T1 预注册）。来源：atomcode R92-Q2+R92 D-002+ADR-0093。

### Mechanism-Unavailable Branch（机制不可用分支）
预注册判词分支：patch 层 providers 覆写在目标宿主上若无支持（dump-config 无自定义路由痕迹）→判词直落 F-bug 分支记 not-established: [L3a]——机制不可达是证据不是 LOOP 借口，防现场发明分支与熔断失控。_Avoid_: 机制未验通就反复重试消耗票级熔断；把「覆写不支持」归因为上游凭证失败。来源：atomcode R92-Q3 隐藏依赖#1+R92 D-003。

### Dual-Wording Preregistration（双版措辞预注册）
条件票文案纪律的强化形态：README 行措辞的 established 版与 established-via-fallback 收窄版两版文案在立法票（T1 ADR-0093）内预注册，条件票（T3）只做选择与誊抄——条件票携带立法即触 Conditional-Ticket Purity 红线。_Avoid_: 判词落地后现场拟对外声明措辞；把「怎么写」的裁量留给条件票执行者。来源：atomcode R92-Q3 隐藏依赖#2+R92 D-003。

### User-Scope Credential Lift（User-scope 凭证提升）
Windows 凭证注入模式：进程 env 是启动快照，后置的用户级变量不回流——持久层经 User-scope 读取（[Environment]::GetEnvironmentVariable(name,'User')）注入子进程 launch env，值不落盘不落上下文不落 transcript（收尾以 SHA-256 前缀 grep 验泄漏）。_Avoid_: 在已运行进程内找新设 env 变量；把 key 值写进 profile patch/日志/判词。来源：R92 实测（DEEPSEEK_API_KEY User-scope len=67 实证 200）+atomcode R92-Q2+R92 D-002。

### Leak Probe（泄漏探针）
凭证卫生闭环的检查器形态：T2 收尾对 transcript/工件全文 grep key 的 SHA-256 前缀（非 key 本体），确认「值不落盘不落上下文」承诺无破口；env 凭证的经典风险=崩溃转储/日志整环境外泄，探针以最小成本闭环。_Avoid_: 只立法不验证；在探针里打印 key 值本身取证。来源：atomcode R92-Q2（SO env-secrets 批评面）+R92 D-002。

### Shadow Dry-Run（影子干跑）
检测器接线票的取证形态：新检查器合入 ship-gate 时票内跑一次非阻塞 dry-run（只读、输出归档 evidence、不入判词、不阻塞门禁），evidence 写明 shadow 性质——防「什么都没跑」的静默接线把脚本 bug 潜伏到下一轮；同时防止 dry-run 被审计误读为「跑了专属机器腿」破两拍节奏。_Avoid_: 纯静默接线；把 shadow run 当正式首跑计入判词。来源：atomcode R92-Q3（CircleCI/Harness shadow 惯例）+R92 D-003。
`;
if (!ctx.includes('Grill Round 92')) {
  fs.writeFileSync(ctxPath, ctx.replace(/\s*$/, '') + block);
}
console.log('goal.md + CONTEXT R92 block written');
console.log('CONTEXT tail check:', fs.readFileSync(ctxPath, 'utf8').includes('Shadow Dry-Run'));
