# R88 Q4 atomcode 调研归档

> 来源：atomcode -p（q4-prompt.txt）；串行单跑；已索引 ctx（9 节）。注：分点结论/辩证检验/来源清单全文在 ctx FTS 索引（batch:atomcode 本次），此处收摘要+矩阵+检索到的节。

## 1) 执行摘要

推荐 A（修在前、并随收口，一票一 commit），Confidence 高。两条收敛心智模型：①Feathers characterization-test 纪律——先锁行为再动结构，a03 吞词测试即「先补测试锁行为再修」，a06 归并搬入的应是已修复形态（搬 bug 进新边界=把未定行为固化成契约）；②Fowler 两顶帽子+多源 commit 拆分惯例（Jake Goulding/Google eng-practices/git 官方 workflow）——refactor 与 behavior fix 不混 commit、refactor 优先但以行为已定为前提。B 的风险可推演必然：a06 把含 bug 守卫/组装搬进新边界后，a03 修法要么落新边界外（边界失效）要么混进 refactor commit（违 Conventional Commits refactor=neither fixes a bug nor adds a feature）。C 无必要。

## 3) 对比矩阵

| 项 | 心智模型符合 | fix/refactor 分离 | a03 修法位置 | 边界搬迁内容 | 回滚/审计 | 判 |
|---|---|---|---|---|---|---|
| A 修在前 | characterization test+两顶帽子+dependency order | ✅ 每票一 commit，refactor 搬已修复形态 | 新边界外旧区修完再归并 | 已修复形态+冻结输出 | 每步独立回滚、diff 单意图 | 推荐 |
| B 归并先行 | preparatory refactoring 误用（含 bug 代码非 no-op baseline） | ❌ 修法必混 refactor commit 或落边界外 | 新边界内（混）或外（边界失效） | 含吞词 bug 守卫 | 无法单步回滚 fix | 否决 |
| C 另排 | 无新增模型收益 | — | — | — | — | 无必要 |

## 来源（检索词面）

Feathers characterization tests / Fowler two hats（Nicolas Carlo silvrback/understandlegacycode）/ Jake Goulding commit 拆分 / Google eng-practices / git workflow 官方 / Conventional Commits spec / lobste.rs 讨论。全文已索引 ctx。