# Round-81 → next-round 交接

Stack (primary key = GitButler change-ids; SHAs are time-lagged @ 2026-09-24):
`r81-grill` → `rml`（账本 D-001~D-005+任务书+CONTEXT 词块+调研存档）；`r81-impl`（叠于其上）→ `sro`（T0 哨戒+插曲1取证）→ `nop`（TI：release.yml R1 幂等跳过）→ `vts`（CHANGELOG r81 条目+claims 注册面）→ `vtl`（T1a/T1b/T2/T3 spike 取证+诊断书）→ `rtt`（anysearch.ts live-annotation 宣称修正）→ `lwl`（T4 文书：ADR-0082+registry 双 closed+publishing 分级+R82 票序）→ `nqp`（ADR index 82 入册）。

主题：产品吸气轮——`defer-r71-provider-serverside` spike 诊断（三分支裁决=分支 b：REST /v1/search 路由死但 POST /mcp MCP Streamable HTTP 全活）+ 发布插曲协议立法（三扳机+C1/C2a/C2b/C3 分级）+ R1 幂等跳过落地。

## 已完成

- **T0 哨戒续班**：dsh 0.1.7-rc.1（特征锚 `agent/created` 携 source/signal 已入 rc 线——双锚其一到位，龄期闸 09-25T13:25Z 未出闸+changelog 未审 → 非 L2 合格候选，action=none）；dsh-tools/mcp-client rc.2≡rc.1 零漂移→native-tools 触发器未响；llm-init.test.ts 单跑 21/21 绿（本窗未复现）；#1764 OPEN 趋僵 21d。evidence/t0-watch-2026-09-24.md。
- **插曲事件 1（已触发，回溯取证）**：v0.0.8 三扳机全扣——手发 dsh-plugin@0.0.7 落（17:02:41Z,Apache-2.0）；tag run 35894640525 success（五包 0.0.8+SLSA attestations+无 ENEEDAUTH/E403，独盯 dsh-plugin publish 步 +pkg@0.0.8 终点行）；装跑冒烟 npm i-g cli@0.0.8+ans doctor 全 OK+dsh plugin add @0.0.8（隔离 DSH_HOME）+dump-config 层核对全绿；CI 矩阵全 success（唯一红=macos-spillover-probe EXPERIMENT non-blocking 已知面）。evidence/release-interlude-1.md。
- **TI R1 幂等跳过**：release.yml publish 腿 spec_of/publish_one——npm view precondition skip+E403/EPUBLISHCONFLICT/already-published 容错；双格实测：已发包 0.0.7/0.0.8→skip（真 registry tarball+本仓 pack），改造版 99.99.99→publish 分支不误伤，npm view 99.99.99→E404 非零；bash -n 语法绿；turbo check 8/8+test 13/13+ship-gate 全绿（含 memory-eval 126/126+MCP initialize v0.0.8+fail-open boot）。
- **T1a 侦察**：端点测绘全表（DoH 双源 CNAME=CloudFront d385xkl1xbzdb4/真 A 3.173.238.x；新 cert 2026-09-22→2027-04-07 Amazon M04；TLS 握手健康；/v1/search 404+root 404+/health 200+status/apex 200）；fake-ip 常量 198.18.0.34 复核；CI 存档核查=**无 provider live-search 探针面**（分水岭列缺席如实记）；H1-H5 假设清单书面化。evidence/t1a-recon-2026-09-24.md。
- **T1b 宣称审计**：种子化位置穷举 8 处（eval runner seed op/test seedRw/ship-gate T0 smoke/chain-gate fixture/正路 saveResults/MCP search-web 落库/kernel stub/R71 spike 运行时直写未入库）；宣称 14 条判定 PASS=9/FAIL=0/RESHAPE=4（REST 契约三件套→fix-r82-anysearch-rest-contract；live-annotation+registry evidence→本轮已落地）。evidence/t1b-claims-audit.md。
- **T2 判别矩阵**：5 探针×4 环境列（E1 fake-ip/E2-E3 真 IP 收敛列/E4 CI 缺席）——P-A 双列 404 证伪 H2/H3；P-B env 继承 fetch→200 错形 JSON（OmniRoute provider 枚举面，静默零结果新发现）；P-C dead-port→connection refused=000 形态本机精确复现（H5 正证）；P-D TLS 健康证伪 H4；P-E MCP 对照组 10 结果 858ms（措辞限：后端+本机出口面活着）。每格区分≥2 假设自检过。evidence/t2-matrix.md。
- **T3 诊断书**：已证伪集 4+1；剩余 H1'（路由级 404 事实）+H5（000 真因候选）；**决定性新证据=POST /mcp 全链路活**（initialize→anysearch-mcp-server v1.0.0；tools/list 四工具；tools/call search 10 结果 867ms）；三分支推荐=分支 b（死但可修：迁 MCP-over-HTTP）。t3-diagnosis.md。
- **T4 文书**：ADR-0082（D1-D5+三分支裁决+失败分级+rejected 五件）；registry：defer-r71-provider-serverside/defer-r72-dsh-plugin-npm-publish 双 closed，新增 defer-r81-provider-shape-validation+defer-r81-anysearch-rest-route-removed，9 open 债 carried_log r81；publishing.md 失败分级节；anysearch.ts 注释修正（验证面限定+cert 新值+404+/mcp 注记）；closeout-claims 11 声明；ADR index 82 入册；handoffs/next-round-r82.md R82 票序。
- **验收闭环**：turbo check 8/8；turbo test 13/13（3m44s）；ship-gate 全腿绿 EXIT=0；CLI 0.0.8 装跑+doctor 全 OK；dsh 0.1.5-rc.2 宿主 plugin add 实测。

## 绿色 run URL

本栈未 push（规则：不 push 不 PR）——**PENDING — stack unpushed**。本轮历史相关 run（v0.0.8 tag 发布=插曲事件 1 本体）：

- release（tag v0.0.8 push）: https://github.com/Xxx91n/anysearch-cli/actions/runs/35894640525 —— success，五包 0.0.8+SLSA attestations 全落

承继落地绿 run（r80 栈基 3ab8ccdb，check-runs 全绿）：ci/ship-gate/native-smoke/install-smoke/test:online 见该 sha check_runs 面。

## 下一轮候选（详见 handoffs/next-round-r82.md）

- **R82 推荐主轴：provider MCP 迁移轮**——fix-r82-anysearch-mcp-migration（REST→MCP-over-HTTP 实施）+fix-r82-anysearch-rest-contract（宣称修正执行）+fix-r82-provider-shape-validation（错形校验）+R2/R3/R4 残余假设 gate 票。
- **dsh 哨戒续班**：0.1.7-rc.1 ≈09-25T13:25Z 出闸后双锚复核→L2 合格即 E1 消费票候选辅轴。
- **narrative warn→fail 升级评审**（ADR-0081 定 r82，承继）。
- **#1764 merge-watch 续哨**（绪僵已 21d+）。
- **OmniRoute env 语义**：ANYSEARCH_ENDPOINT=127.0.0.1:20128 是否用户有意路由——R4 票内询，agent 不代改。

## Known risks / deferred

- anysearch REST 臂当前实际不可用（fail-open 兜底，search_web 的 anysearch 臂静默缺席）——R82 迁移票前维持此态。
- OmniRoute 错形静默面（200-非协议 JSON→静默零结果 envelope）——defer-r81-provider-shape-validation 挂账，R82 票收口。
- R71 000 的直接归因（当时 20128 监听态）不可回溯——H5+dead-port 复现为收敛解释，如实记不追。
- /mcp anonymous 凭据面/限流/transport 细节未全验——R2/R3 携入 R82 票（原 H#+Test 保留）。
- 落选续债 9 条（carried_log r81）：defer-anysearch-domain-ownership/defer-f16/defer-f17/defer-r71-transformers-undeclared-dep/defer-r72-dsh-native-tools/defer-r72-dsh-web-interactive-matrix/defer-r73-dsh-event-rename/defer-r74-logo-bitmap-matrix/defer-r75-registerhooks-esm-arm。
