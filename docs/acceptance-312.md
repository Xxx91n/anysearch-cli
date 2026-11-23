# #312 验收记录：分层诊断

这张票只做一件事：让 `ans doctor` 把"装好了没有 / 能力在不在 / 宿主接没接 / 数据能不能开"分开说，并且把"没检查"和"检查过没问题"分开说。这份文件写这次真跑出来的结果，以及还没跑的部分。没跑的就是没跑，不写成通过。

## 一、以前的问题

`ans doctor` 原来把所有检查塞进一张单子，只有 `[OK]` / `[FAIL]` / `[SKIP]` 三种记号，退出码只有 0 和 1。读的人分不清三件事：

- 装好了没有、能力在不在、宿主接没接、数据能不能开，全混在一张单子里；
- 没检查的项和检查过没问题的项，看起来一样；
- 离线就能验的（构造对象、看文件、解析 TOML）和真联网/真起宿主才作数的，混在一起。

## 二、现在怎么说话

四层，一条结果只归一层：

| 层 | 管什么 |
|---|---|
| 安装 | 版本、安装位置、运行时 Node、完整产品的 bin 在不在 PATH |
| 能力 | provider 能不能构造、内存会话、领域 TOML、当前领域、领域文件、user credential |
| 宿主 | 每个宿主的配置在不在、待信任、实际连接 |
| 数据 | durable DB 路径、库布局、迁移前备份 |

每条结果只取四种状态之一：

| 状态 | 意思 |
|---|---|
| `[OK]` | 检查过，没问题 |
| `[未配置]` | 本来就没有，或者还没接 —— 不算失败 |
| `[未检查]` | 没检查，或者离线检查不了 —— 不算通过 |
| `[FAIL]` | 检查过，真的坏了 |

每条还标来源：`离线`（构造对象、看文件、解析 TOML）或 `实测`（真联网、真起宿主）。需要真实调用的检查只能是 `[未检查]`，doctor 不启动宿主、不联网。

> **事后注记（2026-11-24，#507）**：上面那句「doctor 不联网」说的是默认模式。后来 #442 加了 `ans doctor --live`，它是唯一会联网的开关：只打三家信息源的免费面（Tavily `/usage`、Exa 空体 `/search`、AnySearch 的 `initialize` + `tools/list` + 空参数 `tools/call`），给每把 key 一个 auth 结论，一次真搜索都不跑、不花额度，模型也不验。不带 `--live` 时仍是一个字都不联网，行为和上面写的一样。这条注记只补范围，不改当时跑出来的结论。

退出码：有 `[FAIL]` → 1；`--strict` 且有 `[未检查]` → 5；否则 0。`[未配置]` 不抬退出码。

`--json` 输出同一份结构，逐条带 `layer` / `state` / `mode` / `detail`，外加四态计数。

## 三、验收项逐条对照

| 验收项 | 现在拿到的 | 状态 |
|---|---|---|
| 安装 / 能力 / 宿主 / 数据分别报告 | 四层分开；`--json` 里每层是独立数组 | 做了，源码上验过 |
| 离线与真实分开 | 每条带 `mode`；宿主实际连接、真实模型调用、真实检索都只能是 `[未检查]` | 做了，源码上验过 |
| 跳过不伪报通过 | `[未检查]` 单独计数；`--strict` 时它把退出码顶到 5 | 做了，源码上验过 |
| 不泄露密钥 | 凭据只报位置和"有没有"，不打印值；新测试里塞了一个假密钥，断言它不出现在输出里 | 做了，源码上验过 |
| 真实宿主记录版本 / OS / 日期 | `scripts/dsh-approval-acceptance.mjs` 开头加了一段"验收对象：产品版本 / 系统 / 时间" | 加了，**没跑** |
| 假端点只证明接线与记账 | 脚本头部原话保留；模型是本地假端点 | 原有说明，没改 |
| 原型强杀不等于真实 Ctrl+C | Windows 上 `child.kill` 模拟不了终端 Ctrl-C，脚本直接 `SKIP` 并写明原因 | 原有行为，没改 |
| 核对调用方后再动旧的输出格式 | 调用方只有 `apps/cli/test/e2e.test.ts` 和 `scripts/install-smoke.mjs`，都改到新格式；旧 `check` / `skip` 计数器和「跳过也退 0」那条绕过路径已删掉，换成四态；保护断言一条没删。旧库布局照样认（legacy / absent / memory / current），迁移记录和手动恢复指引保留 | 做了 |
| 完整工作区 + 发布门禁 + 安装车道 + 宿主合同 + 平台检查 | 全量工作区套件在本地 pre-commit 门禁上跑过（13 个任务全绿，宿主合同逐条点名）；安装车道、发布门禁、真宿主还要等 CI | **部分跑了**，见第五节 |
| 不替别的票还债 | #307 的两笔欠账单独列在第四节 | 如实列了 |

补一条第一版漏掉的东西：provider 构造这一条原来不分青红皂白，构造不出来就记 `[失败]`。干净环境里没有 `EXA_API_KEY`，`new ExaProvider()` 直接抛错，于是 `ans doctor` 在没配 key 的机器上退出 1——把"还没配"说成了"坏了"，正好是这张票要修的反面。现在改成：没配 key 的源记 `[未配置]`，配了 key 还构造不出来才记 `[失败]`。这条是 e2e 在装出来的 dist 上撞出来的，不是源码里看出来的。

## 四、这次真跑出来的

都在本机、跑在源码上（`node --import tsx`），没有编译产物：

| 命令 | 结果 |
|---|---|
| `pnpm -C apps/cli check`（`tsc --noEmit`） | 退出码 0 |
| `node --import tsx --test apps/cli/test/doctor.test.ts` | 7 个用例全过 |
| 真跑一轮 `ans doctor`（源码） | 退出码 0，四层都打出来，`[未检查]` 逐条点名 |
| 临时目录里 `ans host connect claude` 后再跑 `ans doctor` | 多出 `[未检查] 宿主 claude 待信任` 和 `[未检查] 宿主 claude 实际连接` |
| 同一场景加 `--strict` | 退出码 5 |

`doctor.test.ts` 钉的是这几件事：四层都在、状态只有四种、需要实测的项只能是 `[未检查]`、`--strict` 把 `[未检查]` 顶成 5、`[未配置]` 不抬退出码、假密钥不出现在输出里。

## 五、本地门禁跑过一遍，CI 还没跑

### 5.1 本地全量工作区套件（pre-commit 钩子）

提交时仓库自带的 `pre-commit` 钩子跑了 `turbo run test`，13 个任务全绿。这是本机结果，不是 CI：

| 包 | 结果 |
|---|---|
| `@anysearch-cli/cli` | 279 条：277 通过、0 失败、2 跳过 |
| `@anysearch-cli/plugin` | 39 条：39 通过、0 失败、0 跳过 |
| `@anysearch-cli/mcp` | 全绿 |
| `@anysearch-cli/kernel` | 211 条：211 通过、0 失败、0 跳过 |
| `@anysearch-cli/store` / `retriever` / `embedding` / `dsh-plugin` | 全绿 |

`cli` 那 2 条跳过是 Windows 平台限制，逐条点名：

- `a source path with control characters is rejected before publication` —— Windows 文件名带不了控制字符；
- `a lock with a foreign machine identity and a different boot is never reclaimed` —— 这台机器拿不到 machineId。

`ans doctor` 自己的 9 条用例（`apps/cli/test/doctor.test.ts`）全过；返修时补的那 2 条分别钉「`--strict` 下汇总那句必须是 5 的写法」和「key 只在 `~/.ans/credentials.json` 里时 provider 不能算失败」；`e2e.test.ts` 35 条全过，其中 `doctor runs layered diagnosis and exits 0` 在装出来的 dist 上跑通。

### 5.2 宿主合同用例逐条点名（#307 欠账 1）

`@anysearch-cli/plugin` 的 39 条里，宿主合同这几条各自的结果：

| 用例文件 | 结果 |
|---|---|
| `antigravity-contract.test.ts` | 15 条通过（配置 schema 2 + 适配器 13），0 失败 |
| `claude-contract.test.ts` | 10 条通过，0 失败 |
| `codebuddy-contract.test.ts` | 18 条通过，0 失败 |
| `codex-contract.test.ts` | 11 条通过，0 失败 |
| `golden.test.ts` | 8 条通过，0 失败 |
| `hooks.test.ts` | 10 条通过，0 失败 |
| `plugin.test.ts` | 通过 |
| `plugin-security.test.mjs` | 12 条通过，0 失败 |

`codebuddy-contract.test.ts` 和 `hooks.test.ts` 在 dist 已构建时跑的是真断言，不是 SKIP——这次 `plugin` 的 `skipped` 是 0。

上面这张表是本机 pre-commit 门禁那一轮的。CI 上也点名了（`check-build` 的 ubuntu 与 windows 两条腿，日志里逐文件有 ✔ 行）：

| 用例文件 | CI 结果 |
|---|---|
| `antigravity-contract.test.ts` | ✔ 有这一行，无 ✖ |
| `claude-contract.test.ts` | ✔ 有这一行，无 ✖ |
| `codebuddy-contract.test.ts` | ✔ 有这一行，无 ✖（不是 SKIP） |
| `codex-contract.test.ts` | ✔ 有这一行，无 ✖ |
| `golden.test.ts` | ✔ 有这一行，无 ✖ |
| `hooks.test.ts` | ✔ 有这一行，无 ✖（不是 SKIP） |
| `plugin.test.ts` | ✔ 有这一行，无 ✖ |
| `plugin-security.test.mjs` | ✔ 有这一行，无 ✖ |

同一轮里 `plugin` 是 39 条全过、0 失败、0 跳过；整个 job 的日志里 `✖` 一次都没出现。这笔账在 CI 上还清了。

### 5.3 CI 上跑过的（`16e892f` 与返修后的 `bd5e2dd`，PR #352）

| 项目 | CI 里在哪 | 结果 |
|---|---|---|
| 工作区检查 | `check-build`（ubuntu、windows） | 两条腿都通过 |
| 打包 + 安装车道 | `install-smoke`（ubuntu、windows） | 两条腿都通过 |
| 单产品安装验收 | `installed-acceptance` + `--self-test-parser`（在同一个 `install-smoke` job 里） | 通过 |
| 发布门禁 | `ship-gate`（ubuntu、windows、macos） | 三条腿都通过 |
| 覆盖率 | `coverage` | 通过 |
| native smoke | ubuntu、ubuntu-24.04-arm、windows、macos | 都通过 |
| 联网探测 | `test:online`（非阻塞） | 通过 |

返修提交 `bd5e2dd` 上又跑了一轮，结果一样：17 条通过、1 条跳过（CodeRabbit）、0 失败，上面这些腿全在。

`20adba4` 那一轮 `coverage` 红过一次，跟本票无关：`packages/store/test/coldstart-race.test.ts` 第 2 轮撞到 `SQLITE_SCHEMA: vtable constructor failed: messages_fts`。这个文件在 #257 里就被记为偶发（CHANGELOG 也记了两次，重跑都过），这次 diff 没碰 `packages/store`。按 acceptance-267 的做法定点重跑（`gh run rerun --failed`），红的那次留着不抹。

装出来的产品上，分层诊断这几条逐条点到了（ubuntu 与 windows 两条腿的输出一致）：

```text
[OK] installed doctor exit 0
[OK] doctor reports vector arm status
[OK] doctor shows the four layers
[OK] doctor shows the DB layout row
[OK] doctor shows the domain rows
[OK] doctor lists docs domain
[OK] doctor shows active domain docs
[OK] doctor shows vector arm present after peer install
```

这两条腿里 `[FAIL]` 一次都没出现。`installed-acceptance` 那边也照旧过：`[OK] doctor 报了向量臂的状态`、`[OK] 迁移入口读到的产品版本是真实版本`。

## 六、#307 留下的两笔欠账

#307 的评论点了两笔账，本票要如实处理：

1. **宿主合同用例从没逐条点名过。** 现在点名了：5.2 有本机门禁那一轮，也有 CI 的 `check-build` 两条腿（`antigravity` / `claude` / `codebuddy` / `codex` / `golden` / `hooks` / `plugin` / `plugin-security` 每个文件都有一行 ✔）。这笔账还清。
2. **真实 dsh 宿主在 #307 之后没重跑过。** `apps/dsh-plugin/test/dsh-plugin.test.ts` 用的是 mock ctx 加本地假服务器，证明不了真宿主。`scripts/dsh-approval-acceptance.mjs` 需要真实宿主、浏览器和模型端点，本机和 CI 都没有。所以这一项按"#307 之后没重跑"记，不当成通过。

## 七、哪些话不成立

- ~~分层诊断在 `dist` 打包产物上验过，但没在真装出来的包里验过。~~ 现在两边都验过了：`e2e.test.ts` 在 `dist` 上跑通，`install-smoke` 又把 `pnpm pack` 打出来的产品装进干净前缀跑了一遍，见 5.3 那组 `[OK]`。
- **`[未配置]` 不抬退出码这件事，在 CI 里可能被别的东西盖住。** 比如 `install-smoke` 里装出来的产品在干净前缀下跑，`[未配置]` 项会更多；退出码仍是 0，但那是"没接"不是"没问题"。
- **宿主"待信任"只在 claude 上手工验过一次。** 其余三个宿主（codex / antigravity / codebuddy）的 `待信任` 行没单独验过，靠的是同一段代码。
- **`installed-acceptance.mjs` 抬头里的兜底只在本机造过现场。** 抬头本身在 `bd5e2dd` 的 CI 上跑过（绿）；之后给读版本加了「读不到就记一条 FAIL、版本写读不出来」的兜底。这条分支用空目录当 `ANS_ACC_TARBALLS` 走过一次：`[FAIL] 读得出装进去的产品版本`、抬头写「产品版本: anysearch-cli@读不出来」，后面照常往下跑，没有抛栈。`bd5e2dd` 之后的 CI 还没跑到这一版。
- **数据层那句「库文件在 / 当前布局」，可能是这次运行自己建出来的。** CLI 一启动就会为进程登记打开持久库，`ans doctor` 也不例外；本机实测：`runDoctor()` 单独调用不建库，走 `ans doctor` 就会在空目录里长出一个 340KB 的库。所以那句话证明的是「库能打开、布局认得出来」，不证明「之前就有一个库」。

## 八、怎么自己再跑一遍

```text
# 本机（不编译，直接跑源码）
pnpm -C apps/cli check
node --import tsx --test apps/cli/test/doctor.test.ts

# 装出来的产品上验分层诊断（CI 的 install-smoke 里跑）
node scripts/install-smoke.mjs

# 单产品安装验收（CI 的 install-smoke 里跑）
node scripts/installed-acceptance.mjs
node scripts/installed-acceptance.mjs --self-test-parser

# 真实宿主（要 dsh、浏览器、模型端点）
node scripts/dsh-approval-acceptance.mjs
```
