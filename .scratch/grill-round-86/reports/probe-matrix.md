# R86 T2 判别实验探针矩阵 — 2026-09-27

对象：defer-r85-anysearch-arm-providersfailed（R85 57/57 格 iso 臂全 provider-failure 空列）。
方法：微分探针，一批一轴一变量。值纪律：ANYSEARCH_ENDPOINT/API_KEY 值不入档，只录存在性/类别。

## 探针矩阵

| 探针 | 变量轴 | 命令 | 结果 | 类别 |
|---|---|---|---|---|
| P0 | env 原样（用户配置域） | `node --import tsx scripts/probe-anysearch-provider.ts`（cwd packages/retriever） | `initialize → HTTP 404`，121ms | **permanent-protocol** |
| P1a | 端点=公网默认 × key=env | `... --default-endpoint` | `tools/call isError: invalid_api_key`，3259ms | **permanent-auth** |
| P1b | 端点=公网默认 × 匿名 | `... --default-endpoint --nokey` | `ok, 3 results, server 970ms`（cloudflare 系命中） | **alive** |
| P1c | 端点=env × 匿名 | — | **未跑（冗余）**：端点层在 initialize 即 404，key 分离不可能到达鉴权面 | — |
| P2 | raw MCP initialize/tools-call | — | **未跑（按需）**：P0 已证明 initialize 本身 404，raw 层无更多可判别维度 | — |

## 归因结论

- **上游健康**：公网默认端点匿名调用实测活着（3 条结果、服务端 970ms、命中域正确）。R85 「无信号」不是上游死。
- **根因=env 配置层双重缺陷**：
  1. `ANYSEARCH_ENDPOINT` 指向 loopback——**有 HTTP 服务在听但无 /mcp 路由**（initialize 404，非连接拒绝；属死路由/错配服务类）。
  2. `ANYSEARCH_API_KEY` 在上游实测无效（`invalid_api_key`），且为 permanent-auth（非配额/5xx 瞬态）。
- **non-transient**：两缺陷均为 permanent 类——不是配额或瞬态抖动，等不来自愈；修复方向=终端侧 env 修正/凭据轮换（**用户配置域，agent 不代办**）。
- **臂复活路径**：上游匿名可达 ⇒ 声明式测量环境（endpoint→源码内公开默认值、匿名）下臂可复活；R85 的 0 信号=测量环境坏，非臂死、非协议漂移、非上游死。

## 新机制落位（本批 fixture 升级）

| 机制 | 位置 | 语义 |
|---|---|---|
| P0 探针（长期 fixture） | `scripts/probe-anysearch-provider.ts` | 直调 `new AnySearchProvider().search()`，落 e.name+截断 message+errorClass；env 值只录存在性类别 |
| 错误类别通道 | contract.ts `ProviderErrorClass`+`classifyProviderError` → engine.ts metadata.providerErrorClasses → cli --json → delta 行 `providerErrorClasses{On,Off,IsoOn,IsoOff}` | delta 证据件从此记类别非仅旗标（generic-wrapping 缺陷已修） |
| P3 dist 新鲜度断言 | runner 启动段（PLAN 出口后、真跑前） | stamp.commit vs HEAD + src mtime ≤ dist mtime；不匹配→FAIL 提示重建。缺 dist 仍 SKIP（CI test-online 无 build 腿） |
| 构建戳 | `apps/cli/scripts/stamp-dist.mjs`（build 追加）→ `apps/cli/.build-stamp.json`（gitignore） | anysearch/build-stamp@1：commit+dirty |

## 断言/通道端到端实证

- 断腿：`ANS_VERTICAL_DELTA_LIMIT=1 node --import tsx test/online/eval-looks-vertical.online.ts`（无 stamp 时）→ `AssertionError: stale dist: .build-stamp.json commit=absent vs HEAD=72f1c4f5b431`——**FAIL 语义实证，非静默跑**。
- 放腿：`pnpm -C apps/cli build` 后 stamp=72f1c4f5 → LIMIT=1 冒烟放行，delta 行实载 `providerErrorClassesIsoOn/Off={anysearch:permanent-protocol}`（与 P0 分类一致）。
- 分类器单测 17/17；engine 传播测试 71/71（含新增 case 12）。

## 失误披露（诚实面）

- LIMIT=1 冒烟未设 `ANS_VERTICAL_DELTA_OUT`，默认输出覆盖了 `.scratch/vertical-eval/delta.json`（R85 全量复跑原件，65657B，覆盖前实测 sha256=4b8a080b809b8980345d8e60da709b7603f1a1ce584f5ae68efd2bf4a108957a）。原件字节已失；指纹留存于本档与 T4 清单扩展（disposition 将显式标注「指纹留存、字节被覆盖」而非伪装一致）。教训：冒烟跑必须先设 DELTA_OUT 隔离路径。

## 红线遵守

- 端点/key 值未入档；P0 的 stderr 由 provider 自身打印端点归一化提示（运行时行为，非文档记录）。
- env 修复归用户侧；本轮测量环境声明式覆盖（endpoint=仓库源码公开默认值、匿名）。
