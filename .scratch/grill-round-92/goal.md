# Grill Round 92 — Goal

**Status**: frozen（定稿，D-001~D-003 全确认）

## 主题：售后收口续轮【完整版】

正题=T2 复跑（featherless 自定义上游 https://api.featherless.ai/v1 + User-scope DEEPSEEK_API_KEY 注入）——把 R91 F-bug（DEEPSEEK_API_KEY 环境缺位，非机制故障）补成真实判词。判词达标启 README verified-hosts 双语行对齐（README.md:227 / README.zh-CN.md:217，现状=过期 0.1.5-rc.2 + MCP bridge 表述）；readme-token 检查器接线（ADR-0092 D4 两拍第二拍，无条件票）；deprecate 双空格执行尝试（外发，EOTP 呈报）。

## 判据与机制（D-002）

- **机制**：pi-ai 自定义路由 + 新建隔离 profile `r92-smoke`——patch 层注入 llm-pi-ai.providers.featherless={apiKeyEnv: DEEPSEEK_API_KEY, api: openai-completions, baseURL: https://api.featherless.ai/v1, models:[{id:'Qwen/Qwen3-32B', contextWindow 按官方目录}]} + agent-default-model 覆写 {provider: featherless, model:'Qwen/Qwen3-32B'}；DEEPSEEK_BASE_URL 路径记 rejected（featherless 无 Anthropic Messages 面）。
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
