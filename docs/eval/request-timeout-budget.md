# 评测的钟：`ANS_EVAL_REQUEST_TIMEOUT_MS`

一句话：用户默认的 4 秒一个字不动；`ans search --deadline` 让这一次多等一会儿（最多 60 秒）；评测想量「再给点时间能追回多少」的时候，用这个变量把这一次的预算放宽，最多 15 秒。两个都传时 `--deadline` 优先。

## 是什么

| | |
|---|---|
| 谁读它 | 只有 `ans search`，而且只在没传 `--deadline` 时读。`ans chat` 和 MCP 那条路（`ans_search` / `ans_chat`）不读，也不会被转发进去 |
| 不设 | 4000 ms，和用户碰到的那条线是同一个数 |
| 写错（不是数字）、≤0、小数 | 还是 4000 ms，但会在 stderr 说一行：原值是什么、这次按 4000 ms 跑 |
| 上限 | 15000 ms，写更大也只按 15000 算；用户可调的 `--deadline` 是另一把钟，上限 60000 ms |
| 和 `--deadline` 同时出现 | `--deadline` 优先，这个变量这次不生效，stderr 说一行谁赢了 |
| 进 help、进产品文档吗 | 环境变量不进；`--deadline` 这个产品参数进 help，也写进 `docs/limitations.md` |

## 为什么存在

2026-11-26 那次整跑（#643 的 G 节基线：81 条执行）里，专线那批有 48 条在用户的 4 秒预算下被掐断。那是「没测到」，不是「坏了」；两者混成一个红，改语料的人就不知道该等一等还是该改题。所以要能用一口更长的钟再跑一遍。

但长钟跑出来的数不能和用户口径的数混在一起。规矩是：**数字自己带着钟走**。主报告永远是 4 秒那一档；放宽预算的那批单独一栏，标题写「专线质量（放宽时限）」，每个数旁边印着它用的预算。

## 怎么用

```bash
ANS_EVAL_REQUEST_TIMEOUT_MS=15000 ans search "查一下这家公司的财报" --json
```

- 人工搜索想等更久，直接用 `ans search "..." --deadline 15000`，不用碰这个变量。
- 这一跑的数归到 `extended` 那一栏，永远不进覆盖表的「每次提交跑过 / 每周跑过」两栏。
- 引擎真正拿到的是多少，看 `ans search --json` 里的 `requestTimeoutMs`（同一进程里就是 `CompositionResult.requestTimeoutMs`）——报告直接拿它盖章，别自己再按环境变量算一遍，那会算出两个数。`--json` 里还有一个 `deadlineMs`，和它是同一个数（#651 加的，给脚本读），报告仍用 `requestTimeoutMs`。
- 值没有原样生效时（写错、太小、超过上限），`ans search` 会在 stderr 说一行：原值是什么、这次按多少毫秒跑。这一行是给跑评测的人看的，别当噪音过滤掉。两个都传时也会说一行：这次 `--deadline` 赢，环境变量不生效。
- 频率是每月一次校准。周任务和每次提交的任务都保持 4 秒主口径。

## 挡不住的地方

`~/.ans/config.env` 里的任何 `ANS_*` 启动时都会被灌进环境，所以用户自己也能把这个变量设长；名字里带 `EVAL` 只是提醒，不是门。用户也可以用 `--deadline` 明着调这一次。两者最长也就让他自己那一次搜索多等几十秒，默认不动，可以接受。

## 谁钉着它

- `packages/kernel/src/composition.ts` 的 `resolveRequestTimeoutMs`：代码里这些规矩只在这一个函数里。环境变量这条默认上限 15000；`--deadline` 通过 `requestTimeoutCapMs` 带自己的 60000 上限（这份文档和 CHANGELOG 只是复述，改上限时别只改一处）。1ms 及以上的小数 cap 向下取整；小于 1ms 的 cap 按非法处理，回落 15000。
- `packages/kernel/test/composition-build-errors.test.ts` 里那组 `#657：评测的钟和用户的钟分开` 的断言：不设 = 4000、传 15000 生效、非法或 ≤0 回落 4000、默认上限 15000、显式 `requestTimeoutCapMs: 60000` 时 60000 生效、小数 cap 向下取整、小于 1ms 的 cap 回落 15000；顺带钉住 kernel 自己不读这个环境变量，所以 chat / MCP 拿不到它。
- `scripts/ship-gate.mjs` 继续用正则钉着引擎里的 `DEFAULT_REQUEST_TIMEOUT_MS`、`deadlineTimer` 的 `setTimeout` 和构造函数里的默认赋值，还有 `docs/limitations.md` 里那句 4 秒——那句一个字节没动，只在它后面补了 `--deadline` 的说明。
