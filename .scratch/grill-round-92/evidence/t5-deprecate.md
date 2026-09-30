# T5 弃用文案双空格执行尝试证据档

时间戳: 2026-09-30T09:14+08:00
覆盖: D-001

## 1. 受影响版本枚举与诊断
- 受影响范围: `@anysearch-cli/cli@0.0.3` 至 `0.0.8`（共 6 个版本）。
- 诊断: 历史文案包含连续双空格 `"Fixed in 0.1.0  upgrade."`。
- 目标修正文案: `"Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."`（修正为单空格，严格保持原意不改写措辞）。

## 2. 备准命令清单（6 版本枚举）

```bash
npm deprecate @anysearch-cli/cli@0.0.3 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.4 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.5 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.6 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.7 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.8 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
```

## 3. 执行尝试回执与权限屏障记录 (R87 D4 执行态如实记账)

- 执行命令: `npm deprecate @anysearch-cli/cli@0.0.3 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."`
- 回执状态:
  ```
  npm error code E404
  npm error 404 Not Found - PUT https://registry.npmjs.org/@anysearch-cli%2fcli - Not found
  npm error 404 The requested resource '@anysearch-cli/cli@0.0.3' could not be found or you do not have permission to access it.
  ```
- 身份检查: `npm whoami` → `401 Unauthorized - GET https://registry.npmjs.org/-/whoami`
- **记账结论**:
  - 命中 npm registry 发包凭证屏障（E401/E404），属于外部权限受限导致的零写入状态。
  - 遵循 R87 D4 执行态如实记账原则，准确记为「环境无写入权限挂账，待用户亲触自执」，不掩盖、不记为 clean fail。

## 4. closeout-claims deprecate 双态措辞预注册
- **达成态措辞**: `T5 deprecate 尝试：6 版本枚举文案已修正为单空格`
- **未达成态措辞 (实测采用)**: `T5 deprecate 执行尝试：命中 npm 权限屏障 (E401/E404) 挂账待用户亲触自执`
