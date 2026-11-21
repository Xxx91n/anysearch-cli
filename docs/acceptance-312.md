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
| `@anysearch-cli/cli` | 277 条：275 通过、0 失败、2 跳过 |
| `@anysearch-cli/plugin` | 39 条：39 通过、0 失败、0 跳过 |
| `@anysearch-cli/mcp` | 全绿 |
| `@anysearch-cli/kernel` / `store` / `retriever` / `embedding` / `dsh-plugin` | 全绿 |

`cli` 那 2 条跳过是 Windows 平台限制，逐条点名：

- `a source path with control characters is rejected before publication` —— Windows 文件名带不了控制字符；
- `a lock with a foreign machine identity and a different boot is never reclaimed` —— 这台机器拿不到 machineId。

`ans doctor` 自己的 7 条用例（`apps/cli/test/doctor.test.ts`）全过；`e2e.test.ts` 35 条全过，其中 `doctor runs layered diagnosis and exits 0` 在装出来的 dist 上跑通。

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

`codebuddy-contract.test.ts` 和 `hooks.test.ts` 在 dist 已构建时跑的是真断言，不是 SKIP——这次 `plugin` 的 `skipped` 是 0。这是本机 pre-commit 门禁的结果；CI 的 `check-build` 两条腿还要再点名一次，才算这笔账在 CI 上还清。

### 5.3 还没跑的（要等 CI）

| 项目 | 命令 | 状态 |
|---|---|---|
| 工作区检查 | `pnpm -r check` | 没跑 |
| 打包 + 安装车道 | `scripts/install-smoke.mjs`（CI 里是 `install-smoke` 的两条腿） | 没跑 |
| 单产品安装验收 | `scripts/installed-acceptance.mjs` | 没跑 |
| 发布门禁 | `scripts/ship-gate.mjs`（`ship-gate` 的三条腿） | 没跑 |

宿主合同那几条要**逐条点名**，不能只看"总绿"：CI 的 spec reporter 会逐条打印用例名，看 `check-build` 的两条腿里这些文件各自的 PASS/FAIL/SKIP。`codebuddy-contract.test.ts` 和 `hooks.test.ts` 是"dist 没构建就 SKIP"的写法，SKIP 不等于通过。

## 六、#307 留下的两笔欠账

#307 的评论点了两笔账，本票要如实处理：

1. **宿主合同用例从没逐条点名过。** PR #337 的 CI 里 `check-build` / `coverage` / `ship-gate` / `install-smoke` 在两条腿上都绿，但没人把 `claude` / `codex` / `antigravity` / `codebuddy` / `golden` 这几条合同用例的结果单独列出来。本票在 5.2 把本地门禁那一轮逐条点名了，但 CI 上还没点名 —— 这笔账在 CI 上还没还清。
2. **真实 dsh 宿主在 #307 之后没重跑过。** `apps/dsh-plugin/test/dsh-plugin.test.ts` 用的是 mock ctx 加本地假服务器，证明不了真宿主。`scripts/dsh-approval-acceptance.mjs` 需要真实宿主、浏览器和模型端点，本机没跑。所以这一项按"#307 之后没重跑"记，不当成通过。

## 七、哪些话不成立

- **分层诊断在 `dist` 打包产物上验过，但没在真装出来的包里验过。** 本地门禁里 `e2e.test.ts` 跑的是 `apps/cli/dist/index.js`，`doctor runs layered diagnosis and exits 0` 就是在那儿过的。真装出来的 `ans`（`pnpm pack` 再装进前缀）上跑一遍，还要等 `install-smoke` / `installed-acceptance` 的 CI 结果。
- **`[未配置]` 不抬退出码这件事，在 CI 里可能被别的东西盖住。** 比如 `install-smoke` 里装出来的产品在干净前缀下跑，`[未配置]` 项会更多；退出码仍是 0，但那是"没接"不是"没问题"。
- **宿主"待信任"只在 claude 上手工验过一次。** 其余三个宿主（codex / antigravity / codebuddy）的 `待信任` 行没单独验过，靠的是同一段代码。
- **`scripts/install-smoke.mjs` 和 `scripts/installed-acceptance.mjs` 的改动没跑过。** 只改了断言文字，没在真装出来的产品上跑过这两条车道。
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
