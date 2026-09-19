# dsh 上游升级账本（upgrade-ledger）— R73

> 维护规则：每次上游发版先跑预演（catalog 指新版→install→tsc），预期 RED 当作兼容性警报；
> 只有满足下方采纳触发器才进入实施。预演 ≠ 采纳。

## 当前钉版基线

- 全族 15 个 @deepseek-ai/dsh-* = `0.1.5-rc.2`，@deepseek-ai/cordis = `4.0.2`（pnpm-workspace.yaml catalog 单点 + overrides 逐名枚举）。

## 事件改名映射（0.1.5 → 0.1.6）

| 旧（rc.2，现役） | 新（0.1.6，未来） |
|---|---|
| `agent/session-start` | `agent/created` |

## 预期 RED 清单（预演已实证）

- `src/index.ts:87` TS2345：`'agent/session-start'` 不在 `keyof Events`（上游把该键移出 Events 映射）。
- 混版树附带错误（R72 实录，仅当新旧版本混存时出现）：`UserMessage`/`MessageId` branded-type 不可互赋——T1 全族 override 收敛后此级联消失。

## Payload diff（agent/session-start → agent/created）

- 旧载荷：`{ agent }`（session 启动即注入路由卡）。
- 新载荷：约 `{ agent, source: SessionStartSource, signal? }`，`source ∈ fresh | resume | clear | compaction`。
- 语义差异：新事件在 resume/clear/compaction 也会触发——**无条件注入会把路由卡重复写进会话**。

## 采纳期 source-guard 伪码

```ts
ctx.on('agent/created', ({ agent, source }) => {
  if (source !== 'fresh') return;           // resume/clear/compaction 不重注
  const card = await routingCard();          // 走 server IPC（fail-open）
  if (card) agent.inject({ role: 'user', content: card, durable: true });
});
```

## 采纳触发器（任一满足才进实施轮）

1. 上游发布 `0.1.6-rc.1`（或更高稳定线）且 changelog 经审阅；
2. 出现功能桥接缺口（新事件面提供 rc.2 无法表达的钩子能力）；
3. 上游宣布 rc.2 废弃/迁移窗口。

## 过期/失效条款

- 0.1.6-rc.1 出现后：先读上游 changelog 再审本账本——若 Events/payload 又有变化，本文件按新实测重写，不得照搬。
- 采纳时 override 枚举须按新锁文件重推导：alpha.2 预演实测 dsh 家族扩到 **17 包**（新增 dsh-ptc-runtime / dsh-sandbox / dsh-sandbox-policy），15 名清单已不足覆盖。

## 预演记录

- R72 审计轮：rc.2→alpha.1（直接依赖 repin 后传递漂 alpha）→ 多错 RED；alpha.2 被 minimumReleaseAge 拦截。transcript：`.scratch/grill-round-72/evidence/audit-r72-upgrade-diff.log`。
- R73 T2：catalog 单点→alpha.2 全族齐装 → 单错 RED（仅事件键）。transcript：`.scratch/grill-round-73/evidence/t2-alpha2-rehearsal.log`。
