# T5 deprecate 双空格 — 权限缺口分型与纯备准核销

时间戳: 2026-09-30 | 覆盖: D-001 / D-002 | 性质: **纯备准（外发未执行，EOTP 待用户亲触）**
原始探针: `t5-deprecate-probe.json`

## 1. 权限缺口分型（ADR-0094 D5 三型枚举）

```bash
$ npm whoami
npm error code E401
npm error 401 Unauthorized - GET https://registry.npmjs.org/-/whoami
```

**分型判定：`credential-scope`**

| 缺口类型 | 判定信号 | 本轮实测 | 命中 |
|---|---|---|---|
| `credential-scope` | `npm whoami` → 401（无有效 token） | `npm whoami` → **E401** | ✅ |
| `maintainer` | 已认证但对该包无 write 权限（403/E404 on PUT） | 未到认证层，无法判定 | — |
| `org-owner` | 包已转让 / 归属变更，当前身份非 org owner | 未到认证层，无法判定 | — |

分型停在第一型：401 意味着**根本没有有效身份**，后两型的判定信号（403/E404 on PUT、包归属变更）
在无身份前提下不可观测。故不谎报为 `maintainer` 或 `org-owner` —— 记账只写实际观测到的层。

## 2. 六版本双空格枚举（只读，零写入）

```bash
$ for v in 0.0.3 0.0.4 0.0.5 0.0.6 0.0.7 0.0.8; do npm view @anysearch-cli/cli@$v deprecated; done
```

| 版本 | 现状文案 | 双空格 |
|---|---|---|
| 0.0.3 | `… Fixed in 0.1.0␣␣upgrade.` | ✅ |
| 0.0.4 | `… Fixed in 0.1.0␣␣upgrade.` | ✅ |
| 0.0.5 | `… Fixed in 0.1.0␣␣upgrade.` | ✅ |
| 0.0.6 | `… Fixed in 0.1.0␣␣upgrade.` | ✅ |
| 0.0.7 | `… Fixed in 0.1.0␣␣upgrade.` | ✅ |
| 0.0.8 | `… Fixed in 0.1.0␣␣upgrade.` | ✅ |

**6/6 双空格确认**（R92 记述在本轮独立复现，结论一致）。
`@anysearch-cli/cli` 版本全集 = `0.0.3 0.0.4 0.0.5 0.0.6 0.0.7 0.0.8 0.1.0`；
受影响范围确认为前 6 个（`0.1.0` 本身为修复目标版本，不在弃用范围）。

## 3. 备准命令清单（6 版本枚举，待用户亲触执行）

目标文案（修正为单空格，严格保持原意不改写措辞）：

```
Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade.
```

```bash
npm deprecate @anysearch-cli/cli@0.0.3 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.4 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.5 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.6 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.7 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.8 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
```

## 4. 执行态与核销结论

**外发未执行。** 依 ADR-0094 D5 的 `credential-scope` fallback 行为 + 任务书「deprecate 外发动作先 EOTP 呈报，
用户亲触后才执行」——本轮只做纯备准核销，不代跑、不借他人凭证绕闸。

**closeout-claims 双态措辞（按实际缺口型填充，未达成态）**：

> `T5 deprecate 执行尝试：命中 npm 权限屏障 (credential-scope) 挂账待用户亲触自执`

达成态措辞（预注册，本轮未采用）：

> `T5 deprecate 尝试：6 版本枚举文案已修正为单空格`

## 5. 本轮相对 R92 的增量

- R92 记为笼统「权限受限 / E401+E404」；本轮按 ADR-0094 D5 **分型到 `credential-scope`**，
  并显式声明后两型（`maintainer` / `org-owner`）在无身份前提下不可观测、不谎报。
- 6 版本双空格状态经独立只读复核（`npm view`），非承继 R92 记述。
- `0.1.0` 不在弃用范围的边界经版本全集枚举确认（原 R92 档未列此边界）。
