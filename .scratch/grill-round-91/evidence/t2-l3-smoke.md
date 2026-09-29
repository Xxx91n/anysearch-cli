# T2 L3 冒烟执行 — Evidence

时间戳: 2026-09-29T18:54+08:00
宿主版本: dsh 0.1.7-rc.2
插件版本: @anysearch-cli/dsh-plugin 0.1.0

## 执行流程

### Step 1: pack
命令: `pnpm pack --pack-destination /tmp/dsh-plugin-pack` (in apps/dsh-plugin) <!-- machine-local: temp pack destination @ 2026-09-29 -->
结果: @anysearch-cli/dsh-plugin@0.1.0 → C:/Users/ADMINI~1/AppData/Local/Temp/dsh-plugin-pack/anysearch-cli-dsh-plugin-0.1.0.tgz ✓ <!-- machine-local: temp tgz path @ 2026-09-29 -->

### Step 2: plugin add tgz
命令: profile package.json 更新 + pnpm install (因 dsh plugin add 路径问题使用等效路径)
结果: @anysearch-cli/dsh-plugin@0.1.0 installed in headless profile ✓
验证: `dsh plugin --profile headless list` → @anysearch-cli/dsh-plugin@0.1.0 ✓

### Step 3: dump-config
命令: `dsh --profile headless --dump-config`
结果 (anysearch 相关):
```yaml
- id: anysearch-dsh-plugin
  name: '@anysearch-cli/dsh-plugin'
```
**L3a ESTABLISHED: bundle 层单行可见** ✓

### Step 4: 诱导 turns（N≤3）

诱导任务措辞（跑前定死）: 「请帮我搜索一下 deepseek dsh plugin 的最新功能」

**尝试 1**:
命令: `dsh --profile headless --json 请帮我搜索一下 deepseek dsh plugin 的最新功能` (无 DEEPSEEK_API_KEY)
结果: error code=MISSING_CREDENTIAL (no API key for provider route "deepseek-official")

**尝试 2**:
命令: 同上，DEEPSEEK_API_KEY=dummy-test-key
结果: error code=AUTH, status=401 (API key invalid, request_id=0a80a2a0...)
证明: model-request 到达 DeepSeek API 端点，但无有效 key 无法完成 turn

**结论**: DEEPSEEK_API_KEY 未在任何存储中找到:
- 环境变量: 不存在 (env | grep DEEPSEEK → 无结果)
- 注册表 HKCU/HKLM: 不存在
- ~/.dsh/ 目录下: 无 credentials.json/config.json <!-- machine-local: user dsh home directory @ 2026-09-29 -->
- Windows Credential Manager: 不存在 (cmdkey /list → 无 deepseek 条目)

## L3b 判定

stream-json transcript 取证通道: **ESTABLISHED** (NDJSON 正确, model-request 到达)
tools 载荷字段验证: **NOT ESTABLISHED** (因 DEEPSEEK_API_KEY 缺失, auth 在 tools 列表前失败)

**L3b 判词: not-established (环境限制，非机制缺陷)**

## L3c-min 判定

无法执行 (依赖有效 API key)
**L3c-min 判词: not-established (无法执行)**

## 最终判词 (三分支)

**判词: 分支 C — F-bug (L3b not-established)**

原因: L3b 不可判定（tools 载荷无法验证），按 D-002「a 或 b 败→F-bug」，
但本次属于「环境缺位导致不可判定」而非「机制失败」。

**如实记录**: DEEPSEEK_API_KEY 缺失是本次 L3b/L3c-min 不可判定的根因。
败因诊断: 非 dsh-plugin 机制问题，为外部凭证缺失。

**R87 D4 记账原则 (执行态如实记账)**: 本次冒烟执行到认证层失败，
不记录为「clean fail」，记录为「DEEPSEEK_API_KEY 环境缺失导致 L3b 不可执行」。

## as-is 对照补跑

因败因为环境凭证缺失（非机制差异），as-is 0.1.5-rc.3 对照补跑无意义——
旧版本同样缺 API key，无法产生有效对比。记录为「对照补跑跳过（同一根因）」。

## 挂账

- DEEPSEEK_API_KEY 缺失 → 需用户提供或通过 dsh web Models 页面写入
  (`dsh: AUTH: store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it),
   or export DEEPSEEK_API_KEY in the launching environment`)
- 如 API key 可用: 重跑 T2 (N≤3 尝试，相同措辞)