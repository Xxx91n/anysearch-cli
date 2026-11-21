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
| 宿主 | 每个宿主的配置在不在、待信任、实际生效 |
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
| 离线与真实分开 | 每条带 `mode`；宿主实际生效、真实模型调用、真实检索都只能是 `[未检查]` | 做了，源码上验过 |
| 跳过不伪报通过 | `[未检查]` 单独计数；`--strict` 时它把退出码顶到 5 | 做了，源码上验过 |
| 不泄露密钥 | 凭据只报位置和"有没有"，不打印值；新测试里塞了一个假密钥，断言它不出现在输出里 | 做了，源码上验过 |
| 真实宿主记录版本 / OS / 日期 | `scripts/dsh-approval-acceptance.mjs` 开头加了一段"验收对象：产品版本 / 系统 / 时间" | 加了，**没跑** |
| 假端点只证明接线与记账 | 脚本头部原话保留；模型是本地假端点 | 原有说明，没改 |
| 原型强杀不等于真实 Ctrl+C | Windows 上 `child.kill` 模拟不了终端 Ctrl-C，脚本直接 `SKIP` 并写明原因 | 原有行为，没改 |
| 核对调用方后再动旧的输出格式 | 改到的调用方：`apps/cli/test/e2e.test.ts`、`scripts/install-smoke.mjs`；都改到新格式，没有删掉原来的保护断言 | 做了 |
| 完整工作区 + 发布门禁 + 安装车道 + 宿主合同 + 平台检查 | 这个窗口只走远端，本机没跑 | **没跑**，见第五节 |
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

## 五、还没跑的

这个窗口的要求是只走远端。下面这些一项都没在本机跑，要等 CI：

| 项目 | 命令 | 状态 |
|---|---|---|
| 工作区检查 | `pnpm -r check` | 没跑 |
| 工作区全量测试 | `pnpm -r test` | 没跑 |
| 打包 + 安装车道 | `scripts/install-smoke.mjs`（CI 里是 `install-smoke` 的两条腿） | 没跑 |
| 单产品安装验收 | `scripts/installed-acceptance.mjs` | 没跑 |
| 发布门禁 | `scripts/ship-gate.mjs`（`ship-gate` 的三条腿） | 没跑 |
| 宿主合同用例 | `apps/plugin/test/{claude,codex,antigravity,codebuddy}-contract.test.ts`、`golden.test.ts`、`hooks.test.ts`、`plugin.test.ts` | 没跑 |

宿主合同那几条要**逐条点名**，不能只看"总绿"：CI 的 spec reporter 会逐条打印用例名，看 `check-build` 的两条腿里这些文件各自的 PASS/FAIL/SKIP。`codebuddy-contract.test.ts` 和 `hooks.test.ts` 是"dist 没构建就 SKIP"的写法，SKIP 不等于通过。

## 六、#307 留下的两笔欠账

#307 的评论点了两笔账，本票要如实处理：

1. **宿主合同用例从没逐条点名过。** PR #337 的 CI 里 `check-build` / `coverage` / `ship-gate` / `install-smoke` 在两条腿上都绿，但没人把 `claude` / `codex` / `antigravity` / `codebuddy` / `golden` 这几条合同用例的结果单独列出来。这笔账本票只能靠 CI 还 —— 上面第五节列了具体文件名。
2. **真实 dsh 宿主在 #307 之后没重跑过。** `apps/dsh-plugin/test/dsh-plugin.test.ts` 用的是 mock ctx 加本地假服务器，证明不了真宿主。`scripts/dsh-approval-acceptance.mjs` 需要真实宿主、浏览器和模型端点，本机没跑。所以这一项按"#307 之后没重跑"记，不当成通过。

## 七、哪些话不成立

- **分层诊断没在装出来的产品上验过。** 本机跑的是源码（`tsx` 直接跑 `src`），不是 `dist` 里的打包产物。装出来的 `ans` 上跑一遍要等 `install-smoke` / `installed-acceptance` 的 CI 结果。
- **`[未配置]` 不抬退出码这件事，在 CI 里可能被别的东西盖住。** 比如 `install-smoke` 里装出来的产品在干净前缀下跑，`[未配置]` 项会更多；退出码仍是 0，但那是"没接"不是"没问题"。
- **宿主"待信任"只在 claude 上手工验过一次。** 其余三个宿主（codex / antigravity / codebuddy）的 `待信任` 行没单独验过，靠的是同一段代码。
- **`scripts/install-smoke.mjs` 和 `scripts/installed-acceptance.mjs` 的改动没跑过。** 只改了断言文字，没在真装出来的产品上跑过这两条车道。

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
