# T0 ride-along 取证 — @deepseek-ai/dsh-* @ 0.1.7-alpha.2（alpha 线最新）

Date: 2026-09-23. 观测窗口截至 2026-09-23T03:21Z（快照 captured_at=2026-09-23T03:15:04.203Z，L1 探针 03:21:26Z）。Method: L0=`npm view @deepseek-ai/dsh-agent time version dist-tags --json`（快照 `t0-l0-watch.json`）；L1=`npm pack` 6 个 Events-augmenting 包→解包 .d.ts 提取 `interface Events` 合并块（闸内合法探针——npm pack 不过 pnpm resolver，不归 minimumReleaseAge 管辖，ADR-0079 D3）；dep-closure=peerDependencies/dependencies 递归 + 全族 23 名 `npm view <name>@0.1.7-alpha.2 version` 发版面枚举。tarball 留机器临时目录不提交。
<!-- machine-local: probe tarballs unpacked under %TEMP%/r79-dsh2-qi4ysE @ 2026-09-23 -->

## L0 元数据哨（dsh-agent）

- versions=28（npm time 键数）；dist-tags: latest=`0.1.0-rc.6`, next=`0.1.5-rc.3`, alpha=`0.1.7-alpha.2`
- 发布时间：0.1.7-alpha.2=`2026-09-22T15:50:04.145Z`（与任务书快照一致）；0.1.5-rc.3=`2026-09-22T05:39:36.425Z`；0.1.7-alpha.1=`2026-09-22T06:04:55.999Z`

## L1 Events 键面（vs pin rc.2，同 6 包集）

- union 键数 27 ≡ 0.1.7-alpha.1（alpha 线内零增量）
- removed=[`agent/session-start`]，added=[]（cordis `internal/*` 9 键不参与本次 diff：cordis 走 ~4.0.x 线未随 alpha 发版，探针面与 R77 同 6 包集）
- `agent/created` payload（alpha.2 起改方法签名式声明）：`'agent/created'(this: Scoped<Agent>, payload: { agent: Agent; source: SessionStartSource; signal?: AbortSignal; }): undefined | Promise<undefined>`
- 消费面三事件 tools/pre-execute、tools/post-execute、tools/result 键在位 ≡ rc.2/alpha.1

## 家族规模

- 发版面：23 名全族枚举 21 published @0.1.7-alpha.2；缺席=dsh-code-runtime（alpha 线已退出，R77 账本已记）+cordis（~4.0.4 线不同步 alpha）。dsh-* 在位 21 ≡ R77 alpha.1 录数（21 dsh-*+cordis）。
- dep-graph closure（dsh-agent peerDeps 递归）：16 dsh-* + cordis(~4.0.4) + 4 个 @deepseek-ai 基建库（cosmokit/cordis-plugin-loader/cordis-plugin-include/schemastery）。采纳时 pnpm-workspace overrides 枚举仍须按新锁文件重推导——现行 15 名清单缺口 6 名且 code-runtime 应退出。

## rc.3/alpha.1 出闸态顺带复核

- 2880min 龄期闸实测对表：rc.3 出闸 ≈2026-09-24T05:39Z、alpha.1 ≈2026-09-24T06:04Z、alpha.2 ≈2026-09-24T15:50Z——观测窗口内三者皆在闸内未到期，与任务书 ≈09-24 05:39/06:04Z 预期一致。
- 特征锚复核：rc 线 rc.3 无特征锚（R77 已裁，本轮 L0 无新 rc 发布）；alpha.* 线非 rc/stable → 稳定锚不响。

## 结论行

L0/L1 watch @ 2026-09-23T03:21Z: versions=28, feature-anchor=present, line=alpha → not L2 candidate (stability anchor fails), action=none required

原始数据：`t0-l0-watch.json`（L0 快照 28 版本+dist-tags+time map）、`t0-l1-alpha2-raw.json`（L1 键面/载荷/dep-closure/发版面全量）。
