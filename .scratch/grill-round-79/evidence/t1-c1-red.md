# T1-c1 RED transcript — surfaced-skip /x silence (pre-fix)

Date: 2026-09-23. Command: node --import tsx --test test/ship-gate-pathlint.test.mjs (packages/store).
State: fixture+test assertions landed, detect.mjs NOT yet reordered (surfaced-skip still emitted pre-fence/pre-locator).

<!-- machine-local: node --test failure transcript excerpt @ 2026-09-23 -->
```
tests 12 / pass 10 / fail 2

✖ exemption domain: /x info silent on every fence + locator line (A2)
  AssertionError [ERR_ASSERTION]: surfaced-skip must be silent on exempt line 26: "%TEMP%/covered-hit.txt plus /etc and D:/Repo/Root/docs/x.md verbatim"
      at TestContext.<anonymous> (file:///D:/Aworker/anysearch-cli/packages/store/test/ship-gate-pathlint.test.mjs:72:33)

✖ exemption domain: covered fence skips in-repo check; locator line exempts in-repo
  AssertionError [ERR_ASSERTION]: fixture must carry covered-fence + locator in-repo lines cov=24 hit=26 loc=0
      (loc=0 was a patch-generation escape defect — \s/\b mangled to s/<BS>; fixed separately, not a detector failure)
```

## 失败原因语义核对（红线要求）

- c1 条款语义：`/x` surfaced-skip 在 fence（覆盖与否）+locator 行静默。
- 实测红因：info 产出于 covered-fence 内行（line 26 `%TEMP%/covered-hit.txt plus /etc ...`）——豁免域内 info 泄漏，与条款语义一致 = 真红（非断言坏）。 <!-- machine-local: 失败 transcript 行内字面量复述（%TEMP% 形） @ 2026-09-23 -->
- 第二条失败为补丁生成层缺陷（`\s`/`\b` 在多层引号中被吃成 `s`/0x08），修复断言文本后复核：豁免域 in-repo 断言本绿（Codify 对象=存量实现语义钉死，非红绿行使），仅剩 /x 静音断言红。

GREEN 对照（改后）：同一命令 12/12 pass，fail 0（本目录 `t1-c1-green.log` 或报告内联实录）。
