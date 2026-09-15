# Handoff — Round-63 发布收口 + 下轮指示（2026-09-16）

## 终态

- **已发布**：`@anysearch-cli/{cli,mcp,plugin,embedding}@0.0.3`，latest 全指 0.0.3。
  registry 实测：peer=`0.0.3` 字面量、Apache-2.0、repository 在场、bin(ans/ans-mcp)在位。
- **净机实装通过**：`npm i -g @anysearch-cli/cli`（净 prefix）→ `ans --version`=0.0.3、
  `ans doctor` 22 pass/3 skip/0 fail、`ans search` 实返且 domain urlAllowlist 生效。
- **main**：`48db4cf`（0.0.3 bump）+ 收口 docs commit；tag `v0.0.3` post-tag assert 绿
  （fingerprint `4a529f6fbe2096c8` 命中 OF 账本 look-2）。
- **发布通道定格**：`pnpm pack` tarball → `npm publish <tgz>`（用户本机 passkey 交互）。

## 发布事故链（如实记录，供下轮 grill 取证）

1. **scope 蹲占**：org `anysearch` 被空壳占用（org create 报 unavailable，公开命名空间零实物）
   → 用户建成 `anysearch-cli` org，全仓 100 文件 280 处改名 `@anysearch/`→`@anysearch-cli/`。
   漏网两处已补：ship-gate 裸引用守卫的转义斜杠正则、install-smoke tarball 文件名前缀。
2. **2FA 通道**：账号 passkey（Bitwarden）是 WebAuthn——pnpm 只有数字 OTP 通道
   （`ERR_PNPM_OTP_NON_INTERACTIVE`），npm 交互式 publish 走浏览器 passkey 才能发。
   6 分钟窗口对 publish 不生效（registry 对 PUT 仍要 OTP）。
3. **真烧损 ×2**：`npm publish <dir>` 不做 pnpm 的 `workspace:*` canonical 改写
   → 0.0.1 与 0.0.2 的 cli/mcp/plugin manifest 携带 `peerDependencies: workspace:*`
   原文，`npm install` 报 EUNSUPPORTEDPROTOCOL **不可安装**（embedding 无 peer 独活）。
   npm 版本烧损规则禁止同号重发 → 0.0.3 经 tarball 通道发出（tarball manifest 已
   canonical：peer=`0.0.3`，实测无 workspace: 残留）。
4. **误报一则**：npm 警告 `bin script name invalid and removed` 实为 `./` 前缀归一化
   （registry manifest 实测 bin 在场）——我一度按"剔除"处置导致 0.0.2 空烧一次，
   已更正文档。教训：**警告文案信一半，registry manifest 复核才是真相源**。
5. **防线加固**：ship-gate step5 新增断言——packed manifest 任何 dep/peer 字段残留
   `workspace:` 即 fail（堵本次盲区：此前只验 pnpm pack 产物，未防 npm-dir 发布通道）。

## 待用户收尾

- [ ] unpublish 坏版本（72h 窗内，一次一个 spec + -f）：
      cli/mcp/plugin 各 @0.0.1 @0.0.2 共 6 条。embedding 的 0.0.1/0.0.2 可装可留。
      注：需 passkey，我只能给命令不能代跑。

## 下轮（Round-64）方向指示

**首选**：T6 收口 + 隔离裁决——10 条 quarantine TTL **2026-10-14** 死线；棘轮已硬
（过期无裁决/flag-record 漂移/longterm>1/NaN 日期全红），裁决出口
promote/retire/longterm(≤1)。根因与选项：`.scratch/grill-round-63/t6-live-drift-investigation.md`。

**发布工程欠条（due 0.0.4）**：
- release.yml 接 GitHub OIDC trusted publishing（4 包逐包在 npm 包设置配
  repository+workflow 绑定）——本次人肉 passkey 流程到此为止；provenance
  attestation 随 OIDC 自动获得（0.0.3 无 provenance 为已知 D-006 顺延后果）。
- 发布后 unpublish/deprecate 等敏感操作同样吃 passkey——trusted publishing
  覆盖 publish 路径；unpublish 仍属人肉操作（无异议，npm 设计如此）。
- 若再改发布通道：先跑 `npm publish --dry-run` 比对 tarball manifest 差异，
  再信警告文案。

## 资产索引

- 终审书：`.scratch/grill-round-63/go-no-go-0.0.1.md`（GO WITH CAVEATS）
- 报告：`.scratch/grill-round-63/reports/2026-09-15-report.md` +
  `2026-09-15-audit.md`（含复审收口+发布收口注记）
- ADR：`docs/adr/0064-*`（Closure evidence 四腿已填 done）
- 发布步骤：`docs/publishing.md`；release notes：`docs/release-notes/0.0.3.md`
- OF 账本：`packages/store/src/eval/eval-looks.json`（look-1 failed 历史 + look-2 pass）
