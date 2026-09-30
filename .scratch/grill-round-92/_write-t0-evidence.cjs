const fs = require('fs');
const path = require('path');

const R = 'D:\\Aworker\\anysearch-cli';
const evDir = path.join(R, '.scratch', 'grill-round-92', 'evidence');
if (!fs.existsSync(evDir)) {
  fs.mkdirSync(evDir, { recursive: true });
}

const t0BaselineContent = `# T0 证据档 — 哨戒续班+基线快照

时间戳: 2026-09-30T08:45+08:00

## T0a — dist-tags 复观（一次定死 TC 启停窗口）

命令: \`npm view @deepseek-ai/dsh dist-tags\`
输出:
\`\`\`
{ alpha: '0.1.7-alpha.2', latest: '0.2.0-rc.2', next: '0.2.0-rc.2' }
\`\`\`

其他包复观:
- @deepseek-ai/dsh-tools: { latest: '0.0.1-rc.1', alpha: '0.1.7-alpha.2', next: '0.2.0-rc.2' }
- @deepseek-ai/dsh-agent: { latest: '0.1.0-rc.6', alpha: '0.1.7-alpha.2', next: '0.2.0-rc.2' }
- @deepseek-ai/dsh-session: { latest: '0.0.1-rc.1', alpha: '0.1.7-alpha.2', next: '0.2.0-rc.2' }

**TC 窗口判定**: 0.2.0 stable 未目击（latest 与 next 均为 rc 版本 '0.2.0-rc.2'，无 stable 晋升） -> **TC 不启，不留痕**（D-001/D-003 §TC 条件票，一次定死）。

## T0b — 本机 dsh 版本确认

版本命令: \`dsh --version\`
当前版本: \`0.1.7-rc.2\`（不升不降，保持与 R91 同环境连续性及钉版契约）。

## T0c — 基线快照

### pnpm -r check
命令: \`pnpm -r check\` (Scope: 8 of 9 workspace projects)
结果: 全 8 包 tsc --noEmit Done ✓

### pnpm -r test
命令: \`pnpm -r test\` (逐包全部执行通过)
- packages/kernel: PASS in 9.2s
- packages/store: PASS in 126.4s
- packages/embedding: PASS in 1.1s
- packages/retriever: PASS in 2.5s
- apps/plugin: PASS in 7.9s
- apps/dsh-plugin: PASS in 2.3s
- apps/mcp: PASS in 5.2s
- apps/cli: PASS in 16.6s
结果: 全部包测试通过，无失败用例。

### node scripts/ship-gate.mjs --quick
命令: \`node scripts/ship-gate.mjs --quick\`
结果: EXIT 1（预期基线态）
唯一 fail:
  [fail] ADR-0081 D-004: CHANGELOG.md has no '## ' entry referencing r92 — current round is .scratch/grill-round-92; add the round entry or declare 'no-changelog-entry: <reason>' in goal.md
所有其他腿 pass（含 ADR-0073/ADR-0091 dsh-plugin churn lint、pathlint 等）。
`;

fs.writeFileSync(path.join(evDir, 't0-baseline.md'), t0BaselineContent, { encoding: 'utf8' });
console.log('Successfully written t0-baseline.md');

const t0ProbesContent = `# T0 五件探针证据归档

时间戳: 2026-09-30T08:45+08:00
覆盖: D-001 / D-003

## 探针 1 — 运行时 env 可见性
- 检查项: \`process.env.DEEPSEEK_API_KEY\`
- 结果: 存在 (\`true\`)，长度为 67 字符。
- 凭证纪律说明: 仅记录变量存在性与长度，密钥明文绝不写入证据文件或上下文。

## 探针 2 — User-scope 环境变量实测
- 检查命令: \`powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY', 'User')"\`
- 结果: User-scope 变量存在，长度为 67 字符。
- 密钥 SHA-256 前缀: \`64a88ea6\`（供收尾泄漏探针比对）。
- 凭证纪律说明: 密钥明文未落盘、未落上下文。

## 探针 3 — featherless 四态端点归因实测
- 3a. \`GET https://api.featherless.ai/\`
  - 状态: \`200 OK\`
  - 响应: \`{"message":"Welcome to the Featherless.ai API!"}\`
- 3b. \`GET https://api.featherless.ai/v1/models\`（无 Authorization 头）
  - 状态: \`200 OK\`
  - 响应: 返回可用模型列表（包含 \`Qwen/Qwen3-32B\`，context_length=32768, features.tool_use=true）。
- 3c. \`GET https://api.featherless.ai/v1/models\`（带 Authorization 头）
  - 状态: \`200 OK\`
- 3d. \`POST https://api.featherless.ai/v1/chat/completions\`（假 Key 探针）
  - 状态: \`401 Unauthorized\`
  - 结论: 端点认证生效，伪造或缺位 Key 返回 401。

## 探针 4 — key 直连 200 实测
- 目标端点: \`POST https://api.featherless.ai/v1/chat/completions\`
- 目标模型: \`Qwen/Qwen3-32B\`
- 凭证: User-scope \`DEEPSEEK_API_KEY\`
- 状态: \`200 OK\`
- 响应: 成功返回模型应答，证实模型原生可用且 Key 鉴权通过。

## 探针 5 — ANS_LLM_BASE_URL 现状
- 检查项: \`process.env.ANS_LLM_BASE_URL\`
- 结果: \`http://127.0.0.1:20128/v1\`（本地默认代理端点当前值）。
- 结论: 与 T2 方案正交，T2 走 pi-ai 自定义 provider 注入与隔离 profile，不依赖且不污染该全局环境变量。
`;

fs.writeFileSync(path.join(evDir, 't0-probes.md'), t0ProbesContent, { encoding: 'utf8' });
console.log('Successfully written t0-probes.md');
