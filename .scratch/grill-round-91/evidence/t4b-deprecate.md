# T4b 弃用文案双空格证据档

时间戳: 2026-09-29T19:02+08:00

## 1. 受影响版本枚举（npm view）

执行命令: `npm view @anysearch-cli/cli@<version> deprecated`

| 版本 | 当前 npm 上弃用文案 | 问题诊断 |
|---|---|---|
| `@anysearch-cli/cli@0.0.3` | `"Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0  upgrade."` | 双空格 `0.1.0  upgrade.` |
| `@anysearch-cli/cli@0.0.4` | `"Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0  upgrade."` | 双空格 `0.1.0  upgrade.` |
| `@anysearch-cli/cli@0.0.5` | `"Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0  upgrade."` | 双空格 `0.1.0  upgrade.` |
| `@anysearch-cli/cli@0.0.6` | `"Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0  upgrade."` | 双空格 `0.1.0  upgrade.` |
| `@anysearch-cli/cli@0.0.7` | `"Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0  upgrade."` | 双空格 `0.1.0  upgrade.` |
| `@anysearch-cli/cli@0.0.8` | `"Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0  upgrade."` | 双空格 `0.1.0  upgrade.` |
| `@anysearch-cli/cli@0.1.0` | `""` (无弃用，正常发售件) | 正常 |

结论：受影响范围确定为 `0.0.3` 至 `0.0.8`（共 6 个版本），均在 `Fixed in 0.1.0  upgrade.` 处存在连续双空格。

## 2. 备准命令清单（修双空格，不改写措辞）

修正目标文案: `"Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."`

```bash
npm deprecate @anysearch-cli/cli@0.0.3 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.4 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.5 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.6 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.7 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.8 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
```

## 3. 执行态与权限屏障记录（R87 D4 执行态如实记账）

执行尝试: 对 `@anysearch-cli/cli@0.0.3` 执行 `npm deprecate`
回执结果:
```
npm error code E401 / E404
npm error 404 Not Found - PUT https://registry.npmjs.org/@anysearch-cli%2fcli - Not found
npm error The requested resource '@anysearch-cli/cli@0.0.3' could not be found or you do not have permission to access it.
```
`npm whoami` 回执: `401 Unauthorized - GET https://registry.npmjs.org/-/whoami`

**记账状态**:
- 按照 R87 D4 规范，命中 npm 凭证 / OTP 权限闸（EOTP / E401），属**零写入半残留**状态。
- 如实记账为「环境无写入权限挂账，待用户亲触自执」，不得记为 clean fail。
- 无外发 commit，证据入本报告。
