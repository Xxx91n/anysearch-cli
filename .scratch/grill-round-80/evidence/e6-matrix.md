# T1 — E6 闸内执法实测矩阵 transcript（pnpm 钉版 11.24.0 / node v24.11.0 / win32）

Date: 2026-09-23. 观测窗口截至戳 = **2026-09-23T10:32Z**。实验场 = `%TEMP%/r80-e6`（a/b/c/v 四 scratch 目录，不入仓） <!-- machine-local: Windows env-var 路径引用（scratch 实验场） @ 2026-09-23 -->；仓内仅只读复核，依赖面零改。闸 = `minimumReleaseAge: 2880`，strict 默认（未设 strict=false），`trustLockfile` 未设=默认 false。

## 核心裁决（先行）

**上游机器腿在钉版 11.24.0 实测闭合**——`verifyLockfileResolutions`（pnpm 11.1.3+ / PR #11583）对 lockfile 回放路径真实执法：污染 lockfile 在 frozen install / 非 frozen install（CI 路径）/ `pnpm fetch` / `verifyDepsBeforeRun:install` 四处全部 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` exit 1 拦截。**R78 E6「回放绕过龄期闸」证伪结论按本轮实测 revised**：当年五变体全放行并非缺腿，而是 **verdict 缓存污染**——lockfile 在 `strict:false` 宽松写入时已跑过复核（violations 降级 warn+auto-exclude），pass 判定被 `pnpm-cache/lockfile-verified.jsonl` 按 lockfile-hash+policy 指纹缓存，回放命中缓存直接放行。

## 判定机制（实证链）

1. `pnpm install` 对 lockfile 每条目重放 supply-chain policies（`Verifying lockfile against supply-chain policies (N entries)`），命中闸内版即 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` + 逐包发布时间 vs cutoff 列表 + 恢复提示（`pnpm clean --lockfile`）。
2. 判定缓存 = `%LOCALAPPDATA%/pnpm-cache/lockfile-verified.jsonl` <!-- machine-local: Windows env-var 路径引用（pnpm 判定缓存实测载体） @ 2026-09-23 -->，键 = lockfile 内容 hash+path+mtime/inode，记录 `verifiedAt` + policy 指纹（`minimumReleaseAge`/`minimumReleaseAgeExclude`/`trustPolicy`/`IgnoreMissingTime` 等——**不含 `strict`**）。指纹失配→重验；缓存命中→`✓ passes (verified Ns ago)` 放行。
3. 污染向量三态：
   - **异机无闸写入**（transplant）→ 本机无该 hash 判定 → 重验 → **拦截**（B/B-nf/B-fetch 实证）；
   - **本机宽松写入**（strict:false）→ 写入时判定=warn-pass 被缓存，同指纹回放**沿用放行**（A1/A2 实证）——残余边界=写入机本机；
   - **`trustLockfile: true`** → 复核腿整体跳过（B-tl 实证，文档明示 opt-out）；
   - **`Already up to date` 零作业路径** → 不触发复核（A3 实证，但此时无新内容落盘，无害）。

## 逐格实录

| 格 | 环境 | 操作 | 实测 | 判定 |
|---|---|---|---|---|
| A-write | a/ | `minimumReleaseAgeStrict:false` + 钉 `dsh-agent@0.1.7-alpha.1`（闸内）`pnpm install` | exit 0，lockfile 写入，ws yaml 自动追加 15 条 `minimumReleaseAgeExclude`；jsonl 记录 `verifiedAt 10:21:04Z policy{age:2880,excludes:[]}`（exclude 在复核后追加，指纹为空）| 宽松写入=自祝福 |
| A1 | a/ | 剥 strict+excludes，`--frozen-lockfile`（温）| exit 0 `✓ passes (verified 6s ago)` | 缓存沿用 |
| A2 | a/ | 同 A1 + rm node_modules + 全新 `--store-dir` | exit 0 `verified 3m ago` | 缓存不在 store |
| A3 | a/ | 同 A1 + node_modules 在位 + 全新 cache+store | exit 0 `Already up to date`（无复核输出）| no-op 短路不验 |
| A4 | a/ | 同 A2 + **全新 `--cache-dir`** | **exit 1**，`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 15 entries | **缓存载体=jsonl 坐实** |
| B | b/ | C 无闸机写 `dsh-agent@0.1.5-rc.3` lockfile 移植 + `--frozen-lockfile` + 全新 store | **exit 1**，AGE_VIOLATION 13 entries（逐包时间戳列出）| **异机污染拦截** |
| B-nf | b/ | 同 B + 裸 `pnpm install`（CI 同款非 frozen）| **exit 1** AGE_VIOLATION | CI 路径同腿 |
| B-fetch | b/ | 同 B + `CI=true pnpm fetch` | **exit 1** AGE_VIOLATION | fetch 同管线 |
| B-tl | b2/ | 同 B + `trustLockfile: true` | exit 0 `+ dsh-agent 0.1.5-rc.3` | opt-out 实证 |
| B-vdbr | b/ | 同 B + `verifyDepsBeforeRun: install` + `pnpm run probe` | **exit 1** AGE_VIOLATION（auto-install 继承复核，stderr 经 runDepsStatusCheck 传导）| vdbr=install 继承拦截 |
| V-err | v/ | 成熟 lockfile + package.json drift + `verifyDepsBeforeRun: error` | exit 1 `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`（drift 文案，非龄期）| vdbr=drift 检测 |
| V-warn | v/ | 同 V-err + `warn` | exit 0，WARN + probe 运行 | 同上 |
| Repo | 仓内 | `pnpm install --frozen-lockfile --ignore-scripts` | exit 0 `Already up to date`（lockfile 全成熟：rc.2 族 09-10 发布）| 正常态对照 |

## γ 阻塞判定（ledger D-002 三可核验条件，逐条引用实测）

- **(a) lockfile 在册已含闸内未成熟版本**：未命中——仓内 `pnpm-lock.yaml` 全量条目成熟（dsh 族钉 0.1.5-rc.2 = 2026-09-10 发布，远超 2880min）；Repo 格 frozen install exit 0 实证。
- **(b) 回放可投毒构建产物**：未命中——B/B-nf/B-fetch/B-vdbr 四路径全部 exit 1 拦截；且 dsh 族为 type-only devDependency（esbuild `--external:@deepseek-ai/*`，dependencies:{} 不变量），不进入发布产物。
- **(c) trustLockfile 验证腿实测不覆盖且补偿控制失效**：未命中——验证腿实测覆盖（本矩阵 B 族全格）。

**γ 未触发 → 不阻塞 0.0.8。**

## 三选一裁决（产出落 T4 ADR-0081）

**b) 引用上游 → 记档核销**：放行依据 = 「上游机器腿闭合」（pnpm 11.1.3+ `verifyLockfileResolutions` + `trustLockfile` 默认 false，钉版 11.24.0 实测闭合）。例外记档降级为 **CI 断言依赖声明**：闭合前提 = 仓内 ws yaml 永不设 `trustLockfile:true`/`minimumReleaseAgeStrict:false`/非空 `minimumReleaseAgeExclude`——三者任一出现即重开 E6 向量；该断言随 T3 ship-gate 扩面落地（静态 rg 断言，与本票红绿成对）。

## 格式化结论行

`e6-matrix @ 2026-09-23T10:32Z: verifyLeg=REAL(11.24.0 confirmed,PR#11583/11.1.3+), poisoned-replay=BLOCKED(frozen/install/fetch/vdbr-install×exit1), launder-edge=same-machine-loose-write+trustLockfile:true+noop-shortcut, r78-e6=REVISED(verdict-cache contamination not missing-leg), gamma=NOT-TRIGGERED, decision=(b)upstream-leg-closed→registry-closeout+CI-assertion`

## 复跑指引

scratch 全量留存 `%TEMP%/r80-e6/{a,b,b2,c,v,store-*,cache-*}`；复跑关键格：`cd b && pnpm install --frozen-lockfile --store-dir <fresh> --cache-dir <fresh>` → 期望 exit 1 + AGE_VIOLATION；`cd a && rm -rf node_modules && pnpm install --frozen-lockfile --cache-dir <fresh>` → 同期望。 <!-- machine-local: Windows env-var 路径引用（scratch 实验场） @ 2026-09-23 -->
