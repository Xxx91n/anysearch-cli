# Round-61 审计交接（2026-09-14）→ 下一轮

## 本窗口做了什么

审计窗口（只出报告不动手）。对 grill-round-61 交付（栈 grill-61-docs → r61-t1..t5 → r61-closeout，基点 e592cb6）做了不信自述的亲跑复核：全量 ship-gate 9/9 重跑（日志 audit-r61-shipgate.log）、HTTP/stdio MCP 测活、五个测试文件独立重跑、observability_spans 库直查 e2e 证据、Standards+Spec 双轴子代理评审、D-001..D-005 逐条对账。

## 裁决

**通过（带呈报项）**——详见 reports/2026-09-14-audit.md（声明→证据→结论对照表 + F1-F7 + 过程违规清单）。核心交付全部亲跑复现；两处需用户裁决：

- **F1（高）**：CLI abstain 退出码间歇被 libuv UV_HANDLE_CLOSING teardown 崩溃改写成 0xC0000409（Windows Node+sqlite 句柄怪癖，pre-existing）。报告遗留项"exit code 不受影响"被实测证伪——abstain.test.ts live arm 连跑两次各挂一条。选项：(a) 修复窗口立项 teardown 根因票；(b) 立缺陷票+改正报告与 README Known Limitations 措辞。修后必须重跑同一套验收（ship-gate 全量 + abstain live arm 连跑 ≥5 次）。
- **F2（中）**：判据5（ADR-0062 明文 mandatory）四臂 SKIPPED 待 TAVILY_API_KEY。SDK 透传已源码级证实（@tavily/core 0.7.7 objRest→body 尾部展开），live 验证仍缺。key 到位后跑 `TAVILY_API_KEY=tvly-... node scripts/probe-tavily-domains.mjs`（D 臂加 PROBE_TAVILY_RESEARCH=1）回填 tavily-probe-ledger。

## 下一 grill 方向指示（按优先级）

1. **F1 处置裁决**：teardown 崩溃根因票（better-sqlite3 句柄在 Windows 进程退出期的关闭序）或正式缺陷挂账——它间歇击穿 abstain exit 契约，不能继续以"exit code 不受影响"记述。
2. **判据5 回填**：TAVILY_API_KEY 到位即跑探针，驱动 capability 表终审（filter 硬模式是否真不泄漏）。
3. **F3**：pi-runtime/ans_chat 面补 span 注入，让双审计事件覆盖第三检索面（packages/kernel/src/pi-runtime.ts:88）。
4. **F5**：docs-g0013 加 stub-arm scope 标记（verdict=abstain 仅 stub 臂成立；live 回放 answer），为 F4 golden 执行器落地扫雷。
5. **npm 0.0.1 发布评估**：abstain 缺口实物已闭合；F1/F2 裁决后 D-001 前置条件是否算达成，显式拍板。
6. 低危修正包（可并入任一票）：ship-gate 1n 重标号、CONTEXT.md 三术语补 _Avoid_、search.ts 查询词误删边界（--* 全剥+a!==mode）、--fail-on-abstain 入 --help、outcome 维度表述收敛、报告 hash 以 but-id 为主键。

## 工作约束沿用

GitButler 每票一分支、中文带票号、不 push/PR 除非明令；.scratch 快照先行（本审计产物已按 round-60 惯例提交至 r61-audit 分支）；验收证据必须可独立复跑；唯一事实源 = ADR-0062 + decision-ledger.md，新发现呈报不静默改向。

## suggested skills

- 裁决/起票：`grill-with-docs`（F1/F2 定级与下一轮主题）；`ask-matt` 路由不定项。
- 实现期：`tdd`（F1 先写 flaky 复现测试）；atomcode 深调研（新问题丢 .codex-tmp/）。
- 收口期：`code-review` 双轴 + 本审计同款验收清单（命令序列见 audit-r61-shipgate.log 与审计报告 §1）。
- 交接/版本：`$handoff` / `$but`。
