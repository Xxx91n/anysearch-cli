# T5 deprecate 备准 — 权限缺口分型与纯备准续挂

时间戳: 2026-09-30 | 覆盖: D-001 / D-003 | 性质: **纯备准（外发未执行，EOTP 待用户亲触）**

## 1. 权限缺口分型（实测核验）

```bash
$ npm whoami
npm error code E401
npm error 401 Unauthorized - GET https://registry.npmjs.org/-/whoami
```

**分型判定：`credential-scope`**
- 实测返回 E401，表明当前环境未注入具备 npm registry 写入权限的有效身份。
- 遵循 ADR-0094 D5 与治理规范：Agent 不代跑、不借凭证绕闸，不越权进行 npm 外发写入。

## 2. 六版本现状确认（只读复核）

受影响历史版本为 `@anysearch-cli/cli` 的 6 个早期版本（0.0.3 ~ 0.0.8），其当前 deprecate 文案中包含历史双空格笔误（`Fixed in 0.1.0␣␣upgrade.`）。

## 3. 备准命令清单（供用户亲触执行）

目标文案（修正为单空格，保持原意）：
```
Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade.
```

待用户登录具权账号后执行之标准命令清单：

```bash
npm deprecate @anysearch-cli/cli@0.0.3 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.4 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.5 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.6 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.7 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
npm deprecate @anysearch-cli/cli@0.0.8 "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 upgrade."
```

## 4. 挂账处置结论

本轮维持纯备准续挂状态，挂账项 `defer-r93-deprecate-credential-scope` 维持 open，cadence 保持为 EOTP 用户亲触。
