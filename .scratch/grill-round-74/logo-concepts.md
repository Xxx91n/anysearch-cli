# Round-74 T1 — Logo 概念提案（repo-logo Phase 2/3 纪律）

> **选定记录 @ 2026-09-20：概念 1「域门」（确认闸 2 用户选定）** → 手写 `assets/readme/logo.svg`（深色圆角芯片底=自带底，深浅主题双安全；几何=域界框+双闸+三射线+落格点+截停×）。

## Brand Brief（Phase 2）

| 字段 | 值 |
|---|---|
| brand_name | `anysearch-cli`（CLI 解析名 `ans`） |
| brand_slug | `anysearch` |
| 领域隐喻方向 | 搜索 CLI → **域门/闸门**（产品差异化 = `urlAllowlist` 内核闸门 + abstain-first；不取通用搜索隐喻——放大镜/地球/闪电对本品无特异性） |
| 情感基调 | 硬核极简（Developer Utility + monochrome technical direction：墨底/纸白/双灰 + 单一强调色） |
| 配色起点 | 仓库无品牌色 → 按领域定：墨 `#0B1120` / 纸白 `#E8EEF4` / 支灰 `#94A3B8` / 阻灰 `#475569` / 闸道 cyan `#22D3EE` / abstain 琥珀 `#F59E0B`（克制单点用） |
| 风格约束 | 扁平、强轮廓、平衡负空间、跨尺寸可缩放；文字转 path 原则；深浅底双验 |
| 系统架构图景 | `apps/cli`+`apps/mcp` 入口 → retriever providers（exa/tavily/anysearch 扇出）→ kernel 域门（pre-filter 能力协商 + post-filter 权威 `urlAllowlist`）+ RRF 融合 + attribution → store FTS5/observation；零结果过闸 = abstain 一等结果 |

## 概念 1：「域门」（Domain Gate）★ 推荐

```text
Style:       几何符号标——粗线门框+扇入射线，硬核几何向（对标 Docker/Vercel 类工具标）
Composition: 居中。域界方框（右侧留口=开放边界）内双竖闸条；左三射线扇入指闸；
             闸右实心点落格；左下一射线被 × 截停于闸外
Colors:      主形 #E8EEF4；双闸 #22D3EE；截停线 #475569 + × 点 #F59E0B；透明底
Rationale:   差异化=「拦得住的搜索」——别家拼结果数量，本品拼准入。门=陌生人
             也读得懂的准入隐喻，且每个图元都有真实模块对应（见对照表）
16px 测试:   仅 4 类图元（框/双闸/射线/点×），无文字依赖；缩 16px 仍读作
             「有东西被拦在门外」——识别核是门+截停，非细节
```

视觉解剖 ASCII：

```text
   providers(层级端)      域门双闸(闭环端)     落格(焦点端)
   exa      ───╮
   tavily   ───┼──►  ┃║ ───►  ●     fused result
   anysearch───╯    ┃║          ┬── store FTS5
                ✕ ─╯╚═╝    (abstain 截停·一等结果非错误)
   ┌──────────────────────────┐
   │   ───╮                   │
   │   ───┼─► ┃║ ─► ●         │   方框=domain TOML 边界(ANS_DOMAIN)
   │   ───╯  ┃║   ✕ ─╯        │
   └──────────────────────────┘
```

图元-模块对照表：

| 图元 | 角色镜头 | 映射真实模块 |
|------|----------|--------------|
| 三射线扇入 | 层级端 | retriever providers：exa / tavily / anysearch 三路扇出 |
| 双竖闸条 | 闭环端 | kernel 域门双闸：pre-filter（capability-negotiated）+ post-filter（authoritative `urlAllowlist`） |
| 域界方框 | 闭环端 | domain TOML 策略边界（`domains/*.toml`，`ANS_DOMAIN` 选中） |
| 门内实心点 | 焦点端 | 融合后干净结果落格（RRF + attribution → FTS5 store） |
| 截停射线 + × | 闭环端 | abstain：越域 URL 被闸丢弃——一等公民结果而非错误 |

## 概念 2：「双闸滤柱」（Gate Column）

```text
Style:       抽象几何——竖向滤缝+横向层叠
Composition: 顶三竖线（providers）汇入一道窄竖缝（authoritative gate），
             缝下三短横行（fused 列表落格）；缝左一粒灰点止于缝外
Colors:      主形 #E8EEF4；竖缝 #22D3EE；止点 #475569；透明底
Rationale:   同域门语义但更抽象：缝=post-filter，层叠=FTS5 行
16px 测试:   缝+柱形可辨；但「滤缝+落格」读作通用 filter/sort，
             移除项目名后可复用于任何搜索/排序工具——项目特异性弱于概念 1
```

图元-模块对照表：

| 图元 | 角色镜头 | 映射真实模块 |
|------|----------|--------------|
| 顶三竖线 | 层级端 | providers 三路扇出 |
| 窄竖缝 | 闭环端 | post-filter 权威闸门 |
| 缝下三横行 | 焦点端 | RRF 融合列表 / FTS5 行层叠 |
| 缝外灰点 | 闭环端 | post-filter 丢弃的越域结果（abstain 侧） |

## 概念 3：「ans」门形字标

```text
Style:       字标（wordmark）——小写 `ans` 几何粗体，n 作门洞
Composition: `a` 负空间内嵌 cyan 点（allowlisted hit）；`n` 双竖+拱即域门本体；
             `s` 平实粗体收束。CLI 名即门
Colors:      字标 #E8EEF4；a 内点 #22D3EE；透明底
Rationale:   把 CLI 名 `ans` 直接画成门——名形合一，README header 复用性强
16px 测试:   三字母粗几何可辨，但 a 内点在 16px 易糊、n 的门形语义需文字兜底；
             独立符号性弱——缩略态退化为普通字标
```

图元-模块对照表：

| 图元 | 角色镜头 | 映射真实模块 |
|------|----------|--------------|
| `n` 门洞 | 闭环端 | 域门（双竖=pre/post 双闸的压缩形） |
| `a` 内 cyan 点 | 焦点端 | allowlisted 干净结果 |
| `ans` 三字母 | 执行端 | CLI bin 名 `ans`（apps/cli 入口） |

## 反糖精自查（黑名单对照）

无紫蓝渐变 / 无塑料圆角 / 无悬浮碎块 / 无魔法词依赖；三概念全部为扁平强轮廓几何；无任何「无映射装饰图形」过审。
