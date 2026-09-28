# R88 Goal — 搜索面卫生轮（search-surface-hygiene）

> Slug: grill-round-88 | 定稿 2026-09-28 | 账本：decision-ledger.md（D-001~D-005 全 current）

## 主题

R88 = 搜索面卫生轮：发布收口后的批次化清债——F-6 probe 脚本 refactor + r83 三票（a03 吞词/a06 三处近重复/a08 死参数）同域纳编，一单 ADR-0029 合规主题。

## 票序（D-004 七票序）

| 票 | 内容 | 覆盖 |
|---|---|---|
| T0 | 哨戒续班（dsh watch+CI）+基线快照（check/test/ship-gate 当前态） | D-004 |
| T1 | a08 删解构+契约拒收测试（search-web.tool.ts maxResults） | D-003 |
| T2 | a03 位置化旗值消费——先补吞词回归测试锁行为再修（characterization-test） | D-001/D-004 |
| T3 | a06 双层归并——前置 golden 断言→buildVerticalSpec→retriever+verticalSpecProps→kernel+三站接线+错形 byte-identical+tsc | D-002/D-005 |
| T4 | F-6 probe 脚本卫生（??/||、sanitize 对称遮、版本字面量护栏、CHANGELOG 归位） | D-001 |
| T5 | 收口件：ADR-0089+CONTEXT 词块+CHANGELOG+registry 四票核销+claims+任务书（单文档 commit） | 全条 |
| T6 | 门禁+审计 LOOP（pnpm -r check/test+ship-gate --quick+惯例复核） | D-004/D-005 |

## 关键判据（预注册）

- a06 归并边界：buildVerticalSpec 归 retriever/contract.ts 返判别联合 {ok,vertical}|{ok:false,reason:短码}；错误通道各 surface 渲染且输出 byte-identical；reason 短码枚举集前置立法入 ADR-0089；schema 面 kernel verticalSpecProps 片段+additionalProperties:false 随片段+tsc --noEmit 验证。
- a08：删解构零行为变化；单测断言 SearchWebInput 拒收 maxResults；ADR 注记暴露=特性决策。
- a03：位置化旗值消费（--flag 位 i+1 为值位），先补吞词回归测试。
- 熔断：单票门禁失败就地修；同票连续 2 轮 LOOP 修复失败→回退该票+挂回 registry+缩轮呈报。
- 新债闸：显式继承 R84 D-007 三向失真判据；发现者无权就地扩票。

## 显式范围外

垂域方向重议（具名触发未达）/广义清债/上游触发债（r86×2/r81/r84）/常驻债×8/0.1.0 钉版动包/任何外发动作（无 tag/publish）/maxResults 契约扩张/refactor+fix 混 commit。

## 遗留呈报项

缩轮事件、归并中新债、错形 byte-identical 豁免情形——均回呈用户裁决。