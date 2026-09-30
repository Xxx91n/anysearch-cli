# Grill Round 93 — 目标（已定稿）

日期: 2026-09-30 | 账本: decision-ledger.md（D-001~D-003 全 current）| 调研: q1/q2/q3-atomcode.md

## 正题

**L3 修复续轮【换模三跑】**：R91（env 缺）/R92（上游 Qwen3-32B reasoning 形态）两轮 F-bug 后，以已裸探针实证的 moonshotai/Kimi-K2-Instruct-0905 复跑 T2——判词达标则连环解锁 README 双语行对齐（live-verified 图章三轮悬空清偿）+readme-token-pin 机器腿首跑（真标的）+deprecate 再尝试。

## 判据机制（冻结项，跑中不换）

- 宿主 dsh 0.1.7-rc.2 不升不降；新建隔离 profile `r93-kimi`（r92-smoke 冻结为 R92 证据工件零触碰——其 patch 两处硬编 Qwen/Qwen3-32B）
- 注入面=dsh-llm-pi-ai dormant 路由激活：providers.featherless={apiKeyEnv: DEEPSEEK_API_KEY, api: openai-completions, baseURL: https://api.featherless.ai/v1, models:[{id:'moonshotai/Kimi-K2-Instruct-0905', contextWindow:32768}]}+agent-default-model 覆写
- B1 预注册单链 [0905→Kimi-K2-Instruct]：每臂独立 N=3+链级「全灭→F-bug+B 议程」硬顶+换臂 transcript 审计（禁静默降级）
- 诱导句复用 R91/R92 冻结句；contextWindow=32768 托管目录值（preflight 超长探针实证）；N<=3 严格串行（feather_pro_plus 4 units 上限，Kimi-K2=4/req；429=环境违规不计 N）
- R92 签名族三形态计 N：finish_reason=length+空 content / stop+纯文本续写 / 零 tool_calls；length 计 N 前 preflight 先钉 max-tokens 预算判据
- L3c-min 收窄=「ans_* tool_call」（~24% 未声明工具幻觉率，任意 tool_call 不计绿）；>=2 换臂触发 F-bug 复盘闸
- kill criteria：链尽→就地 F-bug 登记+轮内启 T-B 开庭议程（双态记账票：白名单=登记+议程，触发谓词=链尽判词非「未绿」）

## 同域纳编

- r88-candidate sunset 条款立法：R95 前强制开庭+R94 收口批预通知（registry 挂账+owner 点名）
- readme-token-pin 机器腿首跑（README 改=天然标的/未改=shadow+挂账 R94 两态）
- deprecate 双空格（0.0.3~0.0.8 六版）：权限到位执行/未到位纯备准+三型枚举（credential-scope/maintainer/org-owner 各含 fallback 字段）
- 锚定纪律修复（ADR-0092 L162+R91 三文书 sha 病句→落笔时值）+常驻债词汇归一入 T6 分节 commit
- d7 证据效力口径：缺席保守默认=本机门禁证据 advisory 非 blocking+登记下轮复核

## 显式范围外

repin / 垂域复核主体（例外=sunset 写入+T-B 触发的开庭议程）/ web-matrix 主体 / 评测面 / 常驻债清理 / tag·push·publish / pathlint 解冻

## 治理闸

一票一 commit 类型不混；票级熔断 2-LOOP；判词词汇从 t2-verdict 一字不差取；T1 立法先于 T2 行为；T3/T-B 条件票不带立法不现场拟措辞；TC 窗口 T0 一次定死；key 值不入档不落上下文（仅记名/len=67/特许前缀）；失真三向+断言预注册承继
