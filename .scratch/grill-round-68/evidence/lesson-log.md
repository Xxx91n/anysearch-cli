# R68 lesson log — 2026-09-17

## T1 dry-run 结果（partial verification，显式入账）

| leg | SHA | result | exit |
|---|---|---|---|
| green | 14514da (T0 commit, concluded) | 8/8 ci+ship-gate checks terminal+allowed | 0 |
| red | d7bed91 (pre-fix red tip, concluded) | 5 bad (check-build×2, test:online, ship-gate×2), fail-fast | 1 |
| no-signal | 4833833 (no ci/ship-gate checks) | discovery window → fail-closed | 2 |

Transcript: \D:\Aworker\anysearch-cli\.scratch\grill-round-68\evidence\t1-dryrun-transcript.txt\。
未烧 OF look；wait-on-check-action 腿未实跑 → **partially verified**，首次真 pre-tag dispatch 前不宣称 fully verified。

## lessons

1. **release-bot 回写是 read→rebuild→write**——未知字段静默丢（schema_version 剥掉 → main 双红）。修法=Tolerant Reader + 字节级 round-trip 断言；同类 F-17 sweep N=2（cli.ts calibrate reset）并修。
2. **git remote stdout 尾换行**：spawnSync stdout 带 trailing newline——JS dollar-anchor 不匹配尾换行前的文本（与 Perl/Python 不同），match 前必须 .trim()。lint liveness 腿因 repo 解析失败静默降级——写探测代码时 log 出实际 stdout 再断言。
3. **同名 check 去重取最新**（keep_latest_per_name）是 wait-on-check-action 默认——wait-for-duplicates=true 才等全部。action 无 timeout input，硬超时走 step timeout-minutes。
4. **收口必填栏要机器执行**：R67 closeout 缺段+Stack+URL 三轮无人拦——lint 作用域取「diff 触碰 ∪ 最新收口」避免 grandfather 文档永久红。
5. **but land 直推 main** 是既有惯例（R67×2、R68 T0），治理裁决入 ADR-0069 D5：PR-mode/required-checks 留作 future direction。
