# Q2 atomcode 调研存档——TE1 辅轴执行序（闸开先行 vs 主轴后承袭）

Date: 2026-09-25. 原题见 q2-prompt.txt；调研经 ctx_batch_execute 自动索引（source: atomcode-r83-q2）。

## 裁定：A=闸开先行（Confidence：高）

TE1 是可精确预判的 Fixed-Date 小票，打断成本确定可测（~0.5–1 天）；B 案把同样成本变成主轴中段的不确定打断——文献一致表明打断成本随上下文规模与不可预期性放大，钉在轮次边界最便宜。B 案唯一优势=机制语义整洁（一次性收益），拿确定小成本赌不确定大成本不划算。

## 分点结论

1. **打断时机：边界打断≪中段打断**。Gloria Mark 2008 实证：打断后平均 23min15s 恢复原任务；ACM ICSSP 2017：跨项目打断吃掉 17% 工时且上下文越大越难恢复；Leroy 2009（OBHDP）：未完成任务产生 attention residue 拖低新任务表现，**紧时间压力下的收尾反而促脱钩——TE1 自带 ≤20% 时间盒正是这个结构**。A 案切换在轮次边界、residue 单向；B 案把打断埋进多日主轴中段=文献 worst case。
2. **WIP 限流下 sequencing 惯例**：Businessmap 四类 service（Expedite/Fixed Delivery Date/Standard/Intangible）把 date-driven 单列 lane；cosmiclearn 2026 WIP 指南 n+1 策略预留 slot 给 transition/emergency。成熟惯例=「低 WIP+小体积例外+唯一在途」非「辅轴永不先于主轴」；例外项要求 one-at-a-time full devotion——对应 A 案「闸开当日集中消费完毕即回」，而非 B 案「悬置多日等主轴」（反 expedite 立即处理精神）。
3. **Expiring option/Fixed-date 消费时机**：Reinertsen CoD 框架——Fixed Delivery Date 类 CoD 在窗口关闭后不衰减而跳变；错过窗口成本=漏斗空转一轮+rc.2 出闸前整段空窗+中段插入真打断。B 案下两害必取其一=结构性缺陷。
4. **先例侵蚀有界非滑坡**：失败模式是滥用（expedite flow 吞掉 standard flow）非例外本身；失败条件=「无法预判+无纪律+常态化」，本案=「可预判+有护栏+一次性」。**滑坡条件=次次闸开就先打辅轴——频度熔断护栏即防此**。更准确护栏=账本写明论证边界，下次须重新过判据不援引自动成立。
5. **B 案真实代价**：主轴期间 TE1 合格悬置=漏斗空转；拖到冻结点=错过窗口+预注册沉没；中段插入=最贵打断形态（大上下文+不可预期+残留）；语义整洁收益一次性而代价逐日累计。B 唯一成立的世界=主轴恰好顺利+窗口恰好等到=赌运气非 sequencing 规则。
6. **A 案真实代价**：主轴产能让渡 0.5–1 天在 ≤20% 预算内（Reinertsen 教科书答案=临期选项优先消费）；先例侵蚀有界；Lead Time 增量=TE1 时长（序列插入非并行竞争），B 案给主轴的增量反而不确定且可能更大。

## 推荐附带两条账本动作

1. 精确表述：「双锚齐当日，先消费 TE1 主体至出闸或时间盒耗尽（以先到者为准），完毕即刻全力进主轴」——「闸开当日」防无限期前置，「以先到者为准」保证产能让渡硬上限。
2. 论证边界入档：本例成立条件=①双锚判据成立②时间盒≤20%③闸开当日消费；三者缺一规则回到「主轴落地后」默认序——不援引本例自动成立（对滑坡的制度性回应）。

## 对比矩阵

| 项 | A 闸开先行 | B 主轴后承袭 |
|---|---|---|
| 主轴 Lead Time 增量 | 确定 +0.5–1 天 | 不确定（0 或中段打断恢复成本） |
| TE1 窗口风险 | 零 | 拖到冻结点→错过窗口+沉没 |
| Attention residue | 单向边界上 | 主轴中段插入→双向残留 |
| 机制语义 | 须账本写明边界 | 跨轮稳定 |
| 先例侵蚀 | 有界 | 无 |

## Sufficiency Gate

searches: 9 | angles: Official(ACM/RePEc/WorkingBackwards)+Comparative(WIP/小任务先行/expedite)+Criticism(expedite 弃用论/attention residue)+Currency(2026 WIP 指南)+Community | full reads: 9 | gaps: Tavily 尽（Exa+AnySearch 双引擎双源覆盖）；先例侵蚀滑坡无直接文献（类比推导已标注）；Small Victories 付费墙（摘要+WSJ 引文）。

## 来源清单（节选）

1. Gloria Mark et al. 2008 UC Irvine（ics.uci.edu）23min15s 恢复基线
2. FastCompany 报道链+rock.so 2026 综述（23min+residue+每日打断税）
3. Leroy 2009 OBHDP（attention residue+时间压力收尾脱钩）
4. ACM ICSSP 2017（跨项目打断 17% 工时）
5. Leroy & Glomb 2018 ORM
6. Businessmap Kanban Swimlanes（四类 service+Fixed Delivery Date lane）
7. cosmiclearn 2026 WIP 指南（Little's Law+n+1 slot+40% 切换损耗）
8. getnave《Deprecate Your Expedite Swimlane》（滥用批评）
9. Black Swan Farming / WorkingBackwards / Small Victories 等
