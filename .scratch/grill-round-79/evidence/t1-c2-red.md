# T1-c2 RED transcript — WORD_CHAR 补 `_`（pre-fix）

Date: 2026-09-23. Command: node --import tsx --test test/ship-gate-pathlint.test.mjs (packages/store).
State: fixture+test assertions landed（green `foo_C:\x` 行 + red 裸 `C:\x` 行 + pair/boundary 断言），WORD_CHAR 仍 `[A-Za-z0-9]`。 <!-- machine-local: 用例字面量复述（散文行） @ 2026-09-23 -->

<!-- machine-local: node --test failure transcript excerpt @ 2026-09-23 -->
```
tests 13 / pass 10 / fail 3

✖ exemption pair: foo_C:\x green vs bare C:\x red (WORD_CHAR _)
  AssertionError [ERR_ASSERTION]: foo_C must produce zero violations post-fix

✖ green fixture: zero violations
  AssertionError: green fixture must produce no violations:
  [{"line":34,"kind":"missing-marker","detail":"...Identifier-glued drive token foo_C:\x is mid-word prose, not a locator"}]

✖ unit: boundary guard kills URL/identifier false positives
  AssertionError [ERR_ASSERTION]: underscore-glued drive token must not hit (WORD_CHAR _)
```

## 失败原因语义核对（红线要求）

- c2 条款语义：词字符集含 `_` → `foo_C:\x` 形标识符粘连盘符不命中；裸 `C:\x` 仍拦。 <!-- machine-local: 用例字面量复述（散文行） @ 2026-09-23 -->
- 实测红因：`foo_C:\x` 产出 missing-marker 违例 + `detectHits` 返回 1——`_` 不算词字符导致边界判定误命中，与条款语义一致 = 真红（非断言坏）。
- 近邻对照：裸 `C:\x`（red.md 末行）红向仍拦断言在绿修复后过 = 成对纪律。 <!-- machine-local: 用例字面量复述（散文行） @ 2026-09-23 -->

GREEN 对照（改后）：同一命令 13/13 pass，fail 0。

## 文书面次生效应（呈报项）

- `foo_C:\x` FP 消失使 r79 文书内仅靠该命中撑活的 marker 翻转为 stale-marker（decision-ledger.md:9/:23），外加 :16 本就失效的 marker 与 next-round.md:28/:30 裸 `C:\x` 缺 marker——T1-c3 docs commit 统一清剿。 <!-- machine-local: 用例字面量复述（散文行） @ 2026-09-23 -->
- `next-round.md:8` 与 `q1-atomcode.md:47` 的 missing-marker 违例随 FP 消失自动复绿。
