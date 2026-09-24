# 插曲事件 1 — v0.0.8 五包发布（三扳机全扣，已于本轮开始前完成）

取证戳：2026-09-24T07:22:48.872Z。事件发生于 2026-09-23（R81 开工前一日），本文件为回溯取证非实时盯 run。

## 扳机① 手发 dsh-plugin@0.0.7

`npm view @anysearch-cli/dsh-plugin versions time --json` →
`created: 2026-09-23T17:02:41.169Z`, `0.0.7: 2026-09-23T17:02:41.495Z`, `0.0.8: 2026-09-23T17:21:22.878Z`。
`npm view @anysearch-cli/dsh-plugin@0.0.7 version license` → `0.0.7` + `Apache-2.0`。
**判定：已扣**（包创建于 17:02Z 即 0.0.7 首发，license 正确）。

## 扳机② npmjs TP 四字段配置（外部不可验面 → 物证三件）

- 首次 OIDC tag run 绿：run 35894640525 `success`（2026-09-23T17:17:59Z 起 1m52s，tag push v0.0.8）。
- 五包 `dist.attestations` 全非空：`npm view @anysearch-cli/{embedding,cli,mcp,plugin,dsh-plugin}@0.0.8 dist.attestations` → 各含 `provenance.predicateType=https://slsa.dev/provenance/v1` + attestations URL。
- publish 步日志含 `Signed provenance statement ... from GitHub Actions` + sigstore transparency logIndex（embedding=2923261403 / cli=2923262149 / mcp=2923262634 / plugin=2923262972 / dsh-plugin=末段同形）。
- 用户配置声明件：用户侧文件，代理不代验；物证三件已满足（无 TP 则 OIDC publish 步必 ENEEDAUTH 败——实测全绿即 TP 生效）。
**判定：已扣（物证推断），TP 四字段内容本身留用户确认。**

## 扳机③ 推 v0.0.8 tag → 盯 run → 五包×{version,attestations} → 冒烟 → CI 矩阵

- tag→sha：`git rev-parse v0.0.8` = 954c119f（tag object），run head_sha = `3ab8ccdb`（=R80 栈顶审计签收 commit）。
- 独盯 dsh-plugin publish 步（唯一新包）：日志序列 `==> npm publish .release/pack/anysearch-cli-dsh-plugin-0.0.8.tgz` @17:19:42.640Z → `npm notice 📦 @anysearch-cli/dsh-plugin@0.0.8` @17:19:42.9Z → `+ @anysearch-cli/dsh-plugin@0.0.8` @17:19:46.788Z。**无 ENEEDAUTH/E403**。五连发顺序 embedding→cli→mcp→plugin→dsh-plugin 全 `+ pkg@0.0.8`。
- CI 矩阵（3ab8ccdb check-runs）：release gate/publish/ship-gate(ubuntu+windows)/memory-eval/native smoke×3(ubuntu,ubuntu-24.04-arm,windows,macos)/check-build×2/install-smoke×2/test:online 全 `success`；唯一 `failure` = `macos-spillover-probe (EXPERIMENT, non-blocking — R62 D-007)` 名义非阻塞已知面。
- 装跑冒烟（本机实测 2026-09-24T07:22:48Z）：
  - `npm i -g @anysearch-cli/cli@0.0.8` → 安装成功（install-scripts 2 包未过 allowScripts=warn 非阻断）；
  - `ans doctor` → 全 [OK]：SessionStore/FTS5/vector arm/Domain TOML/env/durable DB/domains(docs active, tavily+anysearch key set, exa unset→SKIP)；
  - `npm i -g @deepseek-ai/dsh@0.1.5-rc.2`（宿主，仓内钉住版）→ `dsh --version`=0.1.5-rc.2；隔离 `DSH_HOME` `dsh plugin add --profile headless @anysearch-cli/dsh-plugin@0.0.8` → registry 拉取 `+ @anysearch-cli/dsh-plugin 0.0.8` Done in 4.8s（dsh 内部 pnpm 对 <48h 新包自动写 minimumReleaseAgeExclude，隔离 HOME 内行为不污仓）；`dsh --profile headless --dump-config` → `# == @anysearch-cli/dsh-plugin` 层（id:anysearch-dsh-plugin）+ `mcp-anysearch` 行（serverName:anysearch/stdio/ans-mcp/60000ms/failOnStartupError:false/reconnect）就位。

## run URL

https://github.com/Xxx91n/anysearch-cli/actions/runs/35894640525

## 结论行

`interlude-1 @ 2026-09-24T07:22:48.872Z: trigger1=LANDED(0.0.7@17:02:41Z,Apache-2.0), trigger2=EVIDENCED(5/5 attestations SLSA-v1+run-green,user-declaration-pending), trigger3=LANDED(run35894640525-success,5/5@0.0.8+attestations,CI-green(except non-blocking macos-probe),smoke=npm-i-g+doctor+dsh-plugin-add ALL-PASS), grading=N/A(no-failure), action=registry-entry-update-required(defer-r72-dsh-plugin-npm-publish→closed/landed)`
