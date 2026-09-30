# T7 全量门禁 blocking 首秀与终验审计日志归档

日期: 2026-09-30 | 责任票: T7 门禁+终验审计 | 执行分支: \`r94-court-session\`

## 1. 验收标准逐项对照（硬证据）

用户验收标准原文：「编译通过、打包通过、启动并测活软件进程；每个平台都要有 test 闭环，避免只引入却没做到。」

| 验收项 | 命令 / 验证方式 | 结果 | 归档日志实证 |
|---|---|---|---|
| **编译通过** | \`pnpm run build\` | ✅ exit 0（5/5 total） | \`.scratch/grill-round-94/evidence/t7/build.log\` |
| **打包通过** | \`cd apps/dsh-plugin && npm pack\` | ✅ exit 0 | \`.scratch/grill-round-94/evidence/t7/pack.log\` |
| **启动并测活软件进程** | Plugin (port 33333) + MCP (port 3001) | ✅ 双进程测活通过 | \`.scratch/grill-round-94/evidence/t7/process-liveness.log\` |
| **类型检查通过** | \`pnpm run check\` | ✅ exit 0（8/8 total） | \`.scratch/grill-round-94/evidence/t7/check.log\` |
| **测试闭环** | \`pnpm run test\` | ✅ exit 0（13/13 tasks） | \`.scratch/grill-round-94/evidence/t7/test.log\` |
| **门禁全链（blocking 首秀）** | \`node scripts/ship-gate.mjs\` | ✅ exit 0（step 0~9 全绿） | \`.scratch/grill-round-94/evidence/t7/ship-gate.log\` |
| **ADR index 验证** | \`node scripts/gen-adr-index.mjs --check\` | ✅ exit 0（95 ADRs at HEAD） | ship-gate step 1b 判定绿 |
| **claims 机械比对** | ship-gate closeout-claims 腿 | ✅ 11/11 全绿 | \`closeout-claims r94: 11/11 registered claims re-derived green\` |
| **pathlint 全仓扫描** | ship-gate step 1i 腿 | ✅ 0 violations | \`path-lint: 19 registered doc(s) clean\` |

## 2. 软件进程测活细节摘要

经 \`process-liveness.log\` 确证：
- **Plugin 服务端**：监听端口 33333，进程就绪。
- **MCP HTTP 传输服务**：监听端口 3001，健康检查 \`GET /health\` 返回 200，内容 \`{"status":"ok","server":"anysearch-mcp","version":"0.1.0"}\`。
- **MCP RPC \`initialize\`**：返回 200，服务识别为 \`{"name":"anysearch","version":"0.1.0"}\`。
- **MCP RPC \`tools/list\`**：返回 200，精确列出 5 个 \`ans_*\` 注册工具，全部携带 \`inputSchema: true\`：
  1. \`search_web\`
  2. \`research_web\`
  3. \`recall_memory\`
  4. \`query_knowledge\`
  5. \`ans_chat\`

## 3. claims 冻结纪律与 Stage 2 审计确认

- **只读复证确认**：T7 全程严格履行只读复证职责，零改动 \`.scratch/grill-round-94/closeout-claims.json\` 实物。
- **比对结果**：实物 11 条声明与门禁重新推导完全吻合（11/11），无任何未申报偏差。
- **Clean-Tree 不变量**：所有构建、打包与测试日志均输出至系统外部临时目录后复制入仓，确保门禁 step 0 clean-tree 判定一次性全绿。
