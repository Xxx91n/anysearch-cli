# T4c approval-channel 可行性探测证据档

时间戳: 2026-09-29T19:03+08:00
宿主版本: dsh 0.1.7-rc.2

## 1. 探测目标

探测 dsh `--profile headless` 运行环境下是否具备触达交互审批（user approval）的通道可行性，为 `defer-r72-dsh-approval-channel` 提供决议证据。

## 2. 源码与 .d.ts 探测证据

### A. `@deepseek-ai/dsh-user-approval` 服务设计
路径: `C:\Users\Administrator\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-user-approval` <!-- machine-local: global npm module path @ 2026-09-29 -->
- `ctx.approval` 采用 answerer 瀑布调度设计。
- 声明注释契约明确:
  > *"Missing answerers fail closed; grants apply only to the requested action."*
- 预置状态值: `allowed-once`, `rejected`, `cancelled`, `unavailable`。

### B. `@deepseek-ai/dsh-headless` 架构限制
路径: `C:\Users\Administrator\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-headless` <!-- machine-local: global npm module path @ 2026-09-29 -->
- 包描述: *"The dsh one-shot bundle: a direct core Agent/Session runner over dsh-base with no Host, HTTP, or browser layer"*
- `cordis.patch.yml` 与 `lib/index.js` 检查证实:
  - 源码中 `approval mentions in dsh-headless: false`，未实现、未导入亦未注入任何 `ApprovalAnswerer`。
  - 交互式 UI / 终端提问能力仅存在于 `web` profile 或 `dsh-client-ui-approval`，headless 环境无交互响应通道。

## 3. 探测结论

- **不可行性实证**: 在 `--profile headless` 单次运行模式下，由于缺失交互 answerer，任何触发 `ctx.approval` 的调用均会触发 fail-closed（降级为 `unavailable` 或拒绝），无法完成真正的交互式授权流。
- **裁决**: 如实维持 `defer-r72-dsh-approval-channel` 挂账（维持 defer 状态），证据归档，不入判词门槛。
