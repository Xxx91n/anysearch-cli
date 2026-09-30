# T0 五件探针证据归档

时间戳: 2026-09-30T08:45+08:00
覆盖: D-001 / D-003

## 探针 1 — 运行时 env 可见性
- 检查项: `process.env.DEEPSEEK_API_KEY`
- 结果: 存在 (`true`)，长度为 67 字符。
- 凭证纪律说明: 仅记录变量存在性与长度，密钥明文绝不写入证据文件或上下文。

## 探针 2 — User-scope 环境变量实测
- 检查命令: `powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY', 'User')"`
- 结果: User-scope 变量存在，长度为 67 字符。
- 密钥 SHA-256 前缀: `64a88ea6`（供收尾泄漏探针比对）。
- 凭证纪律说明: 密钥明文未落盘、未落上下文。

## 探针 3 — featherless 四态端点归因实测
- 3a. `GET https://api.featherless.ai/`
  - 状态: `200 OK`
  - 响应: `{"message":"Welcome to the Featherless.ai API!"}`
- 3b. `GET https://api.featherless.ai/v1/models`（无 Authorization 头）
  - 状态: `200 OK`
  - 响应: 返回可用模型列表（包含 `Qwen/Qwen3-32B`，context_length=32768, features.tool_use=true）。
- 3c. `GET https://api.featherless.ai/v1/models`（带 Authorization 头）
  - 状态: `200 OK`
- 3d. `POST https://api.featherless.ai/v1/chat/completions`（假 Key 探针）
  - 状态: `401 Unauthorized`
  - 结论: 端点认证生效，伪造或缺位 Key 返回 401。

## 探针 4 — key 直连 200 实测
- 目标端点: `POST https://api.featherless.ai/v1/chat/completions`
- 目标模型: `Qwen/Qwen3-32B`
- 凭证: User-scope `DEEPSEEK_API_KEY`
- 状态: `200 OK`
- 响应: 成功返回模型应答，证实模型原生可用且 Key 鉴权通过。

## 探针 5 — ANS_LLM_BASE_URL 现状
- 检查项: `process.env.ANS_LLM_BASE_URL`
- 结果: `http://127.0.0.1:20128/v1`（本地默认代理端点当前值）。
- 结论: 与 T2 方案正交，T2 走 pi-ai 自定义 provider 注入与隔离 profile，不依赖且不污染该全局环境变量。
