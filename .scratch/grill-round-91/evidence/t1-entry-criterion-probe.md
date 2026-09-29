# T1 取证通道确认探针 — Entry Criterion Probe

时间戳: 2026-09-29T18:51+08:00
宿主版本: dsh 0.1.7-rc.2
插件版本: @anysearch-cli/dsh-plugin 0.1.0 (pack + add 已验证)

## L3a 装册绿（Entry Criterion 前置）

命令: `dsh plugin --profile headless list`
结果: @anysearch-cli/dsh-plugin@0.1.0 ✓

命令: `dsh --profile headless --dump-config | grep anysearch`
结果:
```yaml
- id: anysearch-dsh-plugin
  name: '@anysearch-cli/dsh-plugin'
```
**L3a 装册绿 ESTABLISHED ✓**

## 取证通道确认探针

### 探针 1 — 无 API key
命令: `dsh --profile headless --json 请简单回答：你好`
stream-json 输出 (第一部分):
<!-- machine-local: transcript stream event excerpt @ 2026-09-29 -->
```ndjson
{"type":"session","sessionId":"session-8c5dd4e9-fa71-4fd0-85fe-dc4e825652a5","cwd":"D:\\"}
{"type":"status","phase":"turn_start","turn":1}
{"type":"status","phase":"step_start","turn":1,"step":1}
{"type":"status","phase":"step_end","turn":1,"step":1}
{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"error","error":{"message":"llm-deepseek: no API key for provider route \"deepseek-official\"","code":"MISSING_CREDENTIAL"}}}
{"type":"final","text":""}
```

### 探针 2 — dummy API key（验证 model-request 到达）
命令: `dsh --profile headless --json 你好` (DEEPSEEK_API_KEY=dummy-test-key)
stream-json 输出:
<!-- machine-local: transcript stream event excerpt @ 2026-09-29 -->
```ndjson
{"type":"session","sessionId":"session-8f52d27b-cfbc-4f51-951e-0ba3c9ca347c","cwd":"D:\\Aworker\\anysearch-cli"}
{"type":"status","phase":"turn_start","turn":1}
{"type":"status","phase":"step_start","turn":1,"step":1}
{"type":"status","phase":"step_end","turn":1,"step":1}
{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"error","error":{"message":"Authentication Fails, Your api key: ****robe is invalid (request_id: 0a80a2a0-7e94-47e9-984e-bcbf5b8c8c51)","code":"AUTH","status":401}}}
{"type":"final","text":""}
```
stderr: `dsh: AUTH: Authentication Fails, Your api key: ****robe is invalid`

## 判词

**通道存在性**: ESTABLISHED
- NDJSON 格式正确：session/status/final 事件正常发出 ✓
- 探针 2 证实 model-request 实际到达 DeepSeek API 端点（request_id 存在） ✓
- 机制层面取证通道存在无疑

**model-request tools 载荷字段**: NOT ESTABLISHED
- 无有效 DEEPSEEK_API_KEY（环境变量/注册表/credentials store 均无）
- 认证失败发生在 step_start 之后、model 实际生成 tools 载荷之前
- 无法观察 {"type":"model-request",...,"tools":[...]} 事件

**L3b 判定（entry criterion probe 结论）**:
- 通道机制 ESTABLISHED（可进入 T2）
- tools 载荷可见性 NOT ESTABLISHED（因环境限制，非机制缺陷）
- 依 D-002：L3b 前置义务为「取证通道存在性」而非「tools 载荷完整性」
  「通道本身存在性须先于主探针实证」——通道存在性已证
  → T2 entry criterion：条件满足，进入冒烟执行
  → T2 若取证通道 tools 载荷不可观察：L3b 判定为 not-established（如实报告）

**结论**: T2 准入条件通过（通道机制存在）；DEEPSEEK_API_KEY 缺失是 T2 实质性执行风险