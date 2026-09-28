# R87 T3 发布后实物验证实录 — 2026-09-28

验证对象：v0.1.0（tag 挂 8292071c=pre-tag 账本回写 sha；release run 36373586142；pre-tag run 36372963603）。方法=只读拉取 registry 实物逐项复核，非凭 CI 绿标。

## 1. dist-tags 实物

`npm view @anysearch-cli/<pkg> dist-tags.latest` ×5：

| 包 | latest | 结论 |
|---|---|---|
| @anysearch-cli/cli | 0.1.0 | ✅ |
| @anysearch-cli/mcp | 0.1.0 | ✅ |
| @anysearch-cli/plugin | 0.1.0 | ✅ |
| @anysearch-cli/dsh-plugin | 0.1.0 | ✅ |
| @anysearch-cli/embedding | 0.1.0 | ✅ |

（发布瞬间 registry 传播有分钟级延迟——`npm notice "may take a few minutes to become available"`；约 1 分钟后全部就位。）

## 2. integrity 复核

- `npm view @anysearch-cli/cli@0.1.0 dist.integrity` = `sha512-AfJ1dcLP+msVRtOI9ESO6wvDvEDDTyKDnNSxqJv+rh8PsPQuIs/8okhIUBcl9ySs+w46Z7J5/tf4rc2tBU/WVA==`
- 本机 `npm pack` 拉真 tarball 复算 sha512 = **逐字节一致** ✅
- dist.shasum `3e3b2a24…` 与 publish 日志 npm notice 行一致 ✅

## 3. tarball 拆包验端点（死路由修复臂在架证明）

`npm pack @anysearch-cli/cli@0.1.0` 解包 `dist/index.js`：
- `/mcp` 出现 4 处、`rewrite` 27 处、`retired` 3 处——重写逻辑在制品内。
- `v1/search` 仅 1 处，且为 `LEGACY_REST_SUFFIX = "/v1/search"` 常量定义（退休检测守卫，运行时触发「REST route is retired (ADR-0082); rewritten to /mcp」）——**非调用点**。死路由默认端点已移除 ✅

## 4. 净机 install-smoke（陌生人路径）

temp 空目录 `npm init -y && npm install @anysearch-cli/cli@0.1.0`：
- 安装成功；`./node_modules/.bin/ans --version` → **0.1.0** ✅
- `ans --help` → 全命令面在列（doctor/auth/llm/skill/search/chat/recommend/domain/mcp/pref/memory）✅
- 注：npm 对 @google/genai/protobufjs install-scripts 出 allowScripts 提示（npm 新版机制，非本品阻断）。

## 5. dsh-plugin 陌生人安装

temp 目录 `npm install @anysearch-cli/dsh-plugin@0.1.0` → 成功；包面完整（AGENTS.md/cordis.patch.yml/lib/index.js+index.d.ts/package.json），**runtime deps=0**（与 ADR-0073 churn lint 断言一致）✅

## 6. publish job OIDC 日志显式核验（npm/cli#8544 首版路径）

run 36373586142 · publish job · step "npm publish (trusted publishing + sigstore provenance)" 逐包可见：
- `publish Signed provenance statement with source and build information from GitHub Actions`
- `publish Provenance statement published to transparency log` + sigstore logIndex（embedding=2981305683 / cli=2981305731 / mcp=2981305817 …）
- `+ @anysearch-cli/<pkg>@0.1.0` 逐包回执

→ OIDC handshake + sigstore provenance 实证，非仅看绿标 ✅

## 7. gh release 面核对

`gh release list` → 无 v0.1.0 Release；release.yml 设计上不产 GitHub Release 对象（publish-only 管线，无 release-creation 步）——记录为「核对过：无」而非疏漏 ✅

## 结论

T3 全绿实证。死路由修复臂已在架（latest=0.1.0），0.0.8 及更早版本成纯历史带病件——T4 deprecate 前置条件满足。
