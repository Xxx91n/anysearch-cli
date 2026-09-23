# Round-80 → next-round 交接

Stack (primary key = GitButler change-ids; SHAs are time-lagged @ 2026-09-23):
`r80-grill` → `xsk`（账本/goal/任务书/CONTEXT 八词/调研存档/round-80 白名单）；`r80-impl`（叠于其上）→ `ykk`（T0：上游哨戒取证 rc.3/alpha.1/alpha.2+#1764）→ `ntl`（T1：E6 实测矩阵 13 格+R78 E6 revised+γ 未触发+裁决(b)）→ `ust`（T2a：dsh-plugin 发布就绪翻转+release.yml 第五包+ship-gate 1s 同构）→ `qpm`（T2b：0.0.8 九包钉+plugin.json+ship-gate pin+CHANGELOG+publishing.md 首发节）→ `nvo`（T3：新鲜度腿 1u+E6 闸断言 1v+closeout-claims 注册面+warn 徽章+dogfood 实录）→ `qyt`（T4：ADR-0081+index 81+registry 更态）。

主题：发布就绪轮——0.0.8 同一 pass/fail 面四腿：dsh-plugin 上架备货 / E6 lockfile 复核腿实证收口 / 派生件新鲜度腿 / 上游哨戒续班。

## 已完成

- **T0 哨戒**（纯证据零代码）：dsh 三版全闸内（≈09-24 05:39/06:04/15:50Z 出闸）；alpha.2 特征锚齐（agent/created 携 source/signal）但稳定锚缺 → action=none；#1764 OPEN 趋僵。evidence/t0-watch{,.json,-rc3-alpha1.md}。
- **T1 E6 收口**（钉版 11.24.0 实证）：上游 verifyLockfileResolutions 腿闭合——frozen/install/fetch/vdbr-install 四路对移植污染 lockfile 全拦 ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION exit 1；R78 E6 五变体放行 revised=lockfile-verified.jsonl 判定缓存污染（宽松写入 warn-pass 沿用）；γ 三条件全未命中→不阻塞；三选一取 (b)，例外降级为 CI 断言依赖声明（ship-gate 1v）。evidence/e6-matrix.md。
- **T2 备货**：dsh-plugin private:false+publishConfig{public,provenance}；release.yml pack+publish 4→5 包；0.0.8 九包钉+ship-gate pin+CHANGELOG 段+publishing.md 预首发四步；pack 拆验+plugin add+dump-config 双态（0.0.7/0.0.8 tarball）复验通过；pnpm install 无脏。
- **T3 新鲜度腿**（nvo）：ship-gate 1u=CHANGELOG rN 断言+no-changelog-entry 豁免+closeout-claims.json 注册面（4 kind fail-closed+narrative warn，r80 注册 8 声明）；1v=E6 三禁项断言。红绿对 4 fixture 全命中（无条目/计数失配/空豁免 fail，合法豁免 pass-exempt）。dogfood 发现三件先记档再修（pathlint marker×2/warn 徽章/栈形）。evidence/freshness-leg-dogfood.md。
- **T4 文书**：ADR-0081（D-001~D-005 全覆盖+γ+例外五要件形+预首发+新鲜度腿设计+三选一+rejected+provenance 边界+声明再推导定级+棘轮表述）；index 81；registry E6 核销+npm-publish 更态+10 债 carried；CONTEXT 词核查过。
- **验收闭环**：turbo check 8/8（26.4s）；turbo test 13/13（3m15s，dsh-plugin 13/13）；ship-gate --skip-matrix 全腿绿（含新腿）；CLI 0.0.8+doctor 23-0-2；MCP initialize v0.0.8；dsh 0.1.5-rc.2 进程测活；WSL Linux 无网络→跨 OS 矩阵交 CI（PENDING）。
- **安全审阅**（release/workflow 变更触发）：semgrep 1.174.0 auto 规则扫 ship-gate.mjs → 3 findings（2 存量 run() 带豁免注释；1 新增 spawnSync claims 命令——claims.json 与门同信任域，已加边界注释）。

## 绿色 run URL

本栈未 push（规则：不 push 不 PR）——**PENDING — stack unpushed**。最近落地绿 run（r76-audit 祖先，承 r79 交接转录）：

- ci: https://github.com/Xxx91n/anysearch-cli/actions/runs/35701346942
- ship-gate: https://github.com/Xxx91n/anysearch-cli/actions/runs/35701346911
- native-smoke: https://github.com/Xxx91n/anysearch-cli/actions/runs/35701346920

## 下一轮候选

- **R81 发布执行轮**（首要）：用户完成预首发四步（手发 dsh-plugin@0.0.7 → npmjs TP 四字段+allowed actions 勾选 → 推 v0.0.8 tag → dist.attestations+装跑冒烟）；CI 矩阵绿回填本交接 run URL。
- **dsh 观测哨续班**：rc.3/alpha.1/alpha.2 ≈2026-09-24 05:39/06:04/15:50Z 出闸——下轮首轮 npm view 复检；双锚同响才进 L2 彩排。
- **narrative warn→fail 升级评审**（ADR-0081 定 r82）：新鲜度腿 narrative 代理稳定一轮后评审升 fail。
- **pathlint 残余盲区**（承继）：多段未知根 POSIX 路径不报、/x 仅单段 info——两轮未扩域。
- **#1764 merge-watch 续哨**（r80-audit O5 补项）：非仅外发面——merge 且发布版携 onnxruntime-common 声明才关 defer-r71-transformers-undeclared-dep；绪僵超一季度→评审降级为低频哨。
- **CI flake-watch 升级线**（r80-audit O5 补项）：1v 新断言+claims 重推导上线后首轮 CI 若抖，flake 观察窗升级评审（频率超阈值即钉死诊断非放行）。
- **外发闸**（用户亲手发）：#1764 评论草稿+gate draft 续挂用户动作项。

## Known risks / deferred

- 落选续债 10 条 + 更态 1 条（口径修正，r80-audit O5；carried_log r80 显式记）：defer-anysearch-domain-ownership / defer-f16-macos-native-crash / defer-f17-quarantine-ids / defer-r71-provider-serverside / defer-r71-transformers-undeclared-dep（#1764 哨）/ defer-r72-dsh-plugin-npm-publish（就绪待扳机）/ defer-r72-dsh-native-tools / defer-r72-dsh-web-interactive-matrix / defer-r73-dsh-event-rename / defer-r74-logo-bitmap-matrix / defer-r75-registerhooks-esm-arm。E6 债已核销（closed_by ADR-0081）。
- E6 残余边界三态如实记档：同机宽松写入沿用（verdict 缓存指纹不含 strict）/ trustLockfile:true opt-out / Already-up-to-date 零作业短路——配置面由 1v 兜底，物理面无上策为已知残余。
- 新鲜度腿仅锚最新轮（历史轮不回溯）；注册面缺席 warn（pre-r80 宽容期）——下轮起新轮缺 closeout-claims.json 仍 warn，r82 评审升级。
- WORKFLOW.md §4.2 缺位第 8 次核销——GitButler skill+全局 but 协议等价覆盖。
- 度量单行：`new-gate-assertions=3families; exceptions=0(γ未触发); release-pkgs=4→5; registry-open=12→11; adr=80→81; claims-registered=8`。

## Suggested skills

- `$implement`（票流）、`$but`（GitButler 全写——新 impl 栈须 `but move --above` 显式叠栈防并行 lane，本轮亲踩）、`$atomcode-research`（串行配额调研）、`$handoff`（收口）；模型可触达 tdd/diagnosing-bugs/code-review。
