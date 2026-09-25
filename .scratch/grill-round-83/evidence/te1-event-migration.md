# TE1 事件迁移实录 — 2026-09-25

## 论证边界三条件（预注册判据）

1. **双锚判据成立** —— 见 `evidence/t0-watch.md`（特征锚+稳定锚+changelog 审面三样齐）。
2. **时间盒 ≤ 主轴 20%** —— TE1 实际占用：repin 枚举重推导+迁移+测试+L2 彩排 ≈1.5h，主轴 T1 当日容量 >7h 等比，占比 <20% ✅。
3. **闸开当日消费** —— rc.1 出闸点 ~09-25T13:25Z；消费落地 09-25 同日 ✅。

## 落地内容（commit on branch r83-te1）

- `pnpm-workspace.yaml` catalog + overrides 枚举重推导 21 名：`@deepseek-ai/*` 全族 0.1.5-rc.2 → 0.1.7-rc.1（peer 闭包实测推导）；新增 `dsh-workspace`/`dsh-storage`/`dsh-storage-domain`/`dsh-session-persistence`/`dsh-sandbox`/`dsh-sandbox-policy`/`dsh-ptc-runtime`；退役 `dsh-code-runtime`（上游 0.1.7 无此包，最高仅 0.1.5-rc.3）与 `dsh-util-crypto`；cordis 4.0.2 → 4.0.4（rc.1 各包 peer 要求 ~4.0.4，npm 实证该版本已发布 09-22）。
- `apps/dsh-plugin/src/index.ts`：`ctx.on('agent/session-start')` → `ctx.on('agent/created')`；guard `source === 'startup'` 才注入 routing card（resume/clear/compact 不重注入）；listener 回调显式返 `undefined`（rc.1 签名收 `Promise<undefined>|undefined`，不收 void）；`contextMessage` 适配新契约（randomUUID → MessageId brand cast；自有 `anysearch-plugin` MessageSourceMap 增扩替代旧 kind）。
- `apps/dsh-plugin/test/dsh-plugin.test.ts`：事件名断言迁移；新增 startup 注入 + resume/clear/compact 不注入用例；provenance 断言更新为 `source.kind === 'anysearch-plugin'`。

## 验证

- `tsc --noEmit`（apps/dsh-plugin）：绿。
- 聚焦测试：`node --import tsx --test "test/**/*.test.ts"` → **14/14 pass**。
- build：esbuild → `lib/index.js` 25.4KB + `lib/index.d.ts`。
- `pnpm pack` → `anysearch-cli-dsh-plugin-0.0.8.tgz`（~12.4KB；内容=AGENTS.md/cordis.patch.yml/lib/LICENSE/package.json）。
- L2 彩排：`dsh plugin --profile headless add <tgz>` → `+ @anysearch-cli/dsh-plugin file:...tgz` 安装成功；`dsh --profile headless --dump-config` → bundle 层 `# == @anysearch-cli/dsh-plugin` 出插件行 + `mcp-anysearch` 行在位；同 tarball 再 add → `Already up to date` 幂等。

## 残留备注（如实）

- 本机宿主 dsh CLI=0.1.5-rc.2（global），rc.1 行为面（`source` 值域消费）在 ≥0.1.7 宿主生效；旧宿主下 `agent/created` payload 无 source → guard 自然不注入=静默降级（非崩坏）。
- 真宿主 0.1.7 进程内行为面复跑（注入进 routing card 的 live transcript）依赖用户侧升级 dsh 至 ≥0.1.7——标注 unverified-at-host，非本轮声明完成项。
