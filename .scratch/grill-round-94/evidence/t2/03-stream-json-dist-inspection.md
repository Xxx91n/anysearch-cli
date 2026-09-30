# T2 取证卷宗 03 — stream-json dist 只读勘查与版本指纹绑定

时间戳: 2026-09-30 | 覆盖: D-001 / D-002 | commit 类型: evidence

## 1. 勘查对象与版本指纹

- **宿主名称**：`@deepseek-ai/dsh`
- **勘查版本**：`0.1.7-rc.2`
- **物理路径**：`C:\Users\Administrator\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh` <!-- machine-local: 用户级 npm 全局安装目录为机外路径 @ 2026-09-30 -->

## 2. 字段面与结构勘查物证

勘查物理目录下的 `lib/` 转译产物与 `lib/types/` 类型定义：
1. `lib/types/plugin.d.ts`：
   仅导出 `runPlugin(profile: string, args: readonly string[]): Promise<number>`，无任何 tools 枚举或 stream-json 字段类型暴露。
2. `lib/types/dump-config-schema.d.ts`：
   仅提供 profile 配置收集与 JSON Schema 转储，不涉及运行时 model-request 劫持。
3. `lib/plugin-DkYIj96-.js`：
   内部仅包含基本的插件配置注入，无模型请求层 tools 暴露接口。

## 3. 勘查结论与指纹绑定

1. **枚举腿死亡证明**：在 dsh 0.1.7-rc.2 下，L3b primary 取证腿（stream-json 枚举）由于宿主未提供模型请求的结构化观测面，在物理上不具备可观测性（model-request tools 枚举 3 轮 0 出现）。
2. **版本绑定声明**：此结论严格绑定版本指纹 `0.1.7-rc.2`。若未来宿主晋升 stable（0.2.0），字段面可能重构，届时触发复活条件①重新评估。
