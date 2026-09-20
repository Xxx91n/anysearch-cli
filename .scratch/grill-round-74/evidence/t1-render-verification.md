# T1 渲染核验记录 — logo.svg + hero.svg（2026-09-20）

核验方式：Playwright + Chromium（本机 `ms-playwright` chromium-1228/1234）无头截图，
预览页临时文件 `ans-svg-preview.html`（machine-local，不入库）；截图实物 =
`.scratch/grill-round-74/evidence/t1-render-check.png`（同页含全部检项）。

| 检项 | 方法 | 结果 |
|------|------|------|
| 900px GitHub 宽渲染 | hero `width:100%` 于 900px 容器截图 | ✓ 左栏 mark/字标/价值句/install/meta 全可读；右栏域门示意完整（三射线→双闸→三行落格+×截停+虚线→门外 abstain 卡） |
| 360px 窄屏 | 同上于 360px 容器 | ✓ 构图整体可辨；文字按规范由 Markdown 正文/alt 承载（canvas 规范：必需信息不独存图内） |
| 深/浅底双验 | `#0d1117`（GitHub dark）与 `#ffffff`（light）两底各截 | ✓ 两 SVG 自带 `#0B1120` 底，双主题渲染逐像素一致 |
| 16px 缩略可辨 | logo 以 256/64/32/16px 渲染 | ✓ 16px 下暗砖+白框+cyan 闸+琥珀×剪影可辨，无文字依赖（图元识别核=门+截停） |
| 禁项扫描 | `grep -nE "foreignObject\|<script\|http://\|https://\|@import\|url(\|@font-face\|<image\|animation\|@keyframes"` | ✓ 仅命中 `xmlns` 命名空间声明（必需），无任何被 GitHub 剥离的特性；无远程字体/图片/CSS |
| 自足性 | 两 SVG 无外链、无 `<use>` 外引用、文字为系统字体栈 | ✓ self-contained |
| logo↔hero 一致性 | hero 内嵌 mark 与 `logo.svg` 几何逐元相同（同 path/坐标，`scale(0.28)` 缩嵌） | ✓ 同一 mark |

备注：字标 `anysearch-cli` 为 SVG `<text>`（系统字体栈非位图）；logo 本体零文字依赖。
