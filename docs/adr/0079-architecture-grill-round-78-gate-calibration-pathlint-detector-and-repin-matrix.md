# ADR-0079: Grill Round 78 — 门禁可信度校准：pathlint token+分隔符组合判定器与 minimumReleaseAge 拦截边界实测

## Status

Accepted (implementation round r78). Records the round-78 decisions per the
serial ticket plan T0–T2. Ledger:
`.scratch/grill-round-78/decision-ledger.md` (D-001~D-005).
Evidence root: `.scratch/grill-round-78/evidence/`.

## Context

R77 审计留下两件同构的「门禁可信度」残账——一个拦不住该拦的，一个不知道
拦不拦：

1. **pathlint env-var 盲区**（`defer-r77-pathlint-envvar-blindspot`）：
   `PATH_RE` 只识别盘符/`/Users`/`/home`/`/tmp`/`AppData/` 字面形，`%TEMP%`/ <!-- machine-local: 判定器 token 形态示例引用（adr 文书） @ 2026-09-22 -->
   `$HOME`/`~/`/`\\host\` 形机器路径全漏网；存量逃逸实例 <!-- machine-local: 判定器 token 形态示例引用（adr 文书） @ 2026-09-22 -->
   `docs/adr/0042:111`（`%TEMP%/atomcode-r39-sources.txt`）实证。 <!-- machine-local: 判定器 token 形态示例引用（adr 文书） @ 2026-09-22 -->
2. **repin 拦截假设未证**：R77 ADR-0078 立法「L1=闸内唯一合法探测层」
   建立在「minimumReleaseAge 闸拦截任何 pnpm 驱动的版本解析」的假设上，
   该假设（含调研所载 PR #11583「lockfile 逐条目复核」在 11.24.0 的执法）
   未经本机实测。

## Decision

### D1 token+分隔符组合判定器（ledger D-003，A++ 案）

`PATH_RE` 单正则重构为 `scripts/ship-gate-pathlint-detect.mjs` 分类器模块，
判定规则统一为「**token 检出 + 后随路径分隔符 = locator**」：

- **硬拦 token 类**（七类）：`%VAR%` Windows env-var 形、`$VAR`/`${VAR}`
  POSIX env-var 形、`~/`/`~\` tilde 形、`\\host\` UNC 形 + 既有字面形 <!-- machine-local: 判定器 token 形态示例引用（adr 文书） @ 2026-09-22 -->
  （`X:\`/`X:/`、`/Users/`、`/home/`、`/tmp/`、`AppData\`/`AppData/`）。 <!-- machine-local: 判定器 token 形态示例引用（adr 文书） @ 2026-09-22 -->
  env-var/tilde 形把分隔符烤进 token 正则——裸散文提及（`%PATH%`、
  `$HOME`、`~` 约数）无分隔符后缀，**不报**（报则永久噪音）。
- **`/x` 单段 POSIX 根形**（无已知前缀，如 `/etc`）→ **info surfaced-skip**
  ——可见不阻断。多段未知根 POSIX 路径（`/var/log/x`、gitbash `/d/...` 形）
  与 URL 路径段不可区分，**登记为已知残余盲区**，不靠规则硬消化（误报面
  用分层消化，不用规则消化）。
- **inline code 不豁免**：locator 常居 code span，豁免即掏空 lint（辩证
  驳回调研建议）；fence 级 marker 已覆盖代码块场景。
- **失效标记棘轮腿**：marker 在行不再命中（裸行/覆盖空 fence 块）→ 报
  violation，单向收缩语义（rubocop `--report-unused-todo-entries` 同构）。
  本轮上线即自证：r72 spike-report 的 fence-cover marker、r77-audit 的
  行尾 marker、warn-sweep 文档自身的 info-fence marker 三处被检出剥除。
- **warn-first 迁移**：新判定器先以 collect 模式全量扫 313 注册文档，实录
  96 违例（93 missing-marker + 2 stale-marker + 1 malformed-marker）+ 685
  info（`evidence/t1-warn-sweep.md`），再逐条处置（97 动作/52 文件，
  `evidence/t1-remediate.md`），复扫残存 0 后翻 fail-closed。
- **红绿 fixture 成对**：`packages/store/fixtures/pathlint/{red,green}.md`
  + `packages/store/test/ship-gate-pathlint.test.mjs` 9 断言——两个实证逃逸
  实例（`%TEMP%/atomcode-r39-sources.txt`、`%TEMP%/r77-scratch-snap-…`） <!-- machine-local: 判定器 token 形态示例引用（adr 文书） @ 2026-09-22 -->
  固化红向，每 token 类红绿成对，散文/URL/已标记行绿向必放。

### D2 豁免三层心智模型（pathlint 侧）

1. **marker = 受审 artifact**：`<!-- machine-local: <reason> @ <date> -->`
   内联进 diff，每次 PR 可见——不开集中 baseline 文件先例（baseline 是规则
   后门，marker 是逐行声明）。
2. **只减不增**：棘轮腿把「marker 存在但不再守卫任何东西」判为违例——
   豁免面随时间只能收缩，不能淤积。
3. **locator 类**（config `locatorLinePatterns`，现仅 `Stack:` 行）：
   绝对路径是该行的职责本身，独立于 marker 体系。

### D3 repin 拦截判决矩阵实录 + 断言收窄（ledger D-002/D-005）

七格预登记判决矩阵逐格实录（`evidence/t0-repin-matrix.md`）：E1/E2/E3/E4
全一致，E5 语义一致（实录错误码 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`，
frozen 拒装于 config 一致性检查点），**E6 证伪**——lockfile 携闸内版 +
`--frozen-lockfile`（温/冷 store、显式 strict:true）与 `pnpm fetch` 五变体
全静默放行，`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 不触发。调研所载
「#11583 lockfile 复核通道」在本机 pnpm 11.24.0 **不执法**。

断言收窄为（替换 ADR-0078 D1 的隐含前提）：

> 在公网 registry（带 time 字段）、无 exclude、strict 模式（默认）前提下，
> `minimumReleaseAge` 闸只拦截**新鲜版本解析路径**（manifest/catalog/range
> 重解析）；**lockfile 回放通道不执法龄期闸**——闸内版一旦进入 lockfile
> （strict:false 放行写入、异机生成、闸外时期提交等任何渠道），frozen
> install 与 `pnpm fetch` 均静默放行。拦截边界 = 解析路径，非安装路径。

「L1 tarball 探针是闸内唯一合法探测层」的立法结论**维持**（npm pack 不过
pnpm resolver 的事实不变），但其依据从「闸拦截一切解析」收窄为「闸拦截
新鲜解析」；安全后果=本仓龄期闸保护「主动 repin/升级」场景，不保护
「lockfile 已携闸内版」场景——后者由 lockfile 评审纪律承担。

### D4 `minimumReleaseAgeIgnoreMissingTime: false` 加固（ledger D-002）

无 `time` 字段的 registry 源默认跳过龄期检查（pnpm 默认 true）——置 false
收紧为 fail-closed，堵 E7「配置面向量」（npmjs 恒带 time 无标本，记档态）。
`pnpm install` 绿实证无破坏。

### D5 不 bump 判定

本轮为治理工具链校准——判定器重构不改变 pathlint 的立法对象（ADR-0072
三分类不变），龄期闸配置加固是防御面收紧非功能变更；版本不 bump。

## Consequences

- pathlint 执法面扩至 env-var/tilde/UNC 形；失效 marker 会开始报违例
  （单向收缩）。
- info surfaced-skip 会在 ship-gate 输出中列出 `/x` 命中（可见不阻断）；
  若误报面失控，按账本负向需求退化为「记档不跑」并呈报，不静默放宽。
- 已知残余盲区（诚实登记）：多段未知根 POSIX 路径（含 gitbash `/d/`、
  `/c/` 盘符形）不报；`/x` 仅单段 info。
- `defer-r77-pathlint-envvar-blindspot` 核销关闭；upgrade-ledger v2 待校准
  项消解（实验已跑，断言按实测收窄）。
- 龄期闸文档口径收窄：CI/CD 若依赖 frozen install 挡闸内版须另加护栏
  （如 lockfile diff 评审、限制 strict:false 写入路径）。
