# Q3 atomcode 调研存档——垂域参数注入点选型

Date: 2026-09-25. 原题见 q3-prompt.txt；调研经 ctx_batch_execute 自动索引（source: atomcode-r83-q3）。

## 裁定：A=双层贯通（Confidence：高）

工业界心智模型高度一致：axios/better-fetch/grab/Rezo 全采「库默认→实例默认→per-request 覆盖」三级优先级；配置层持静态可复用亲和默认，运行时持动态按查询变化的值。sub_domain_params 是典型动态值（同 axios data=请求级不继承）。

## 分点结论

1. **双层默认+覆盖=HTTP client 生态收敛惯例**：axios config merge 顺序=library→instance→request，且 data 等选项 request-specific 不继承——仓级声明亲和默认（domain/sub_domain 枚举），动态 params 只能走请求级。四独立信源交叉。
2. **参数归属判据=变化频率与复用半径**（Brian Grant 声明式配置判据+nelhage 三层模型）：配置层只存放可收敛可 diff 可 review 的稳定意图——sources.vertical.domain 是仓的稳定知识主张入 TOML；verticalParams 每查询必变入工具 arg。
3. **Exa=最贴近一手先例且本身是「同请求双轴共存」**：category（垂域路由枚举）与 includeDomains（host allowlist）同请求并行语义正交；Exa 文档化组合冲突（company/people 不支持 excludeDomains/日期过滤，违规返 400）——支持两轴分开各自注入，**预警 A 案需参数兼容性校验/审计如实记录垂域模式下哪些 filter 失效**。
4. **C 否决**：动态 params 值在 TOML 只能写枚举白名单或模板占位=「配了无效」假声明面；Exa 宁可 400 拒绝不静默无效；且堵死无仓默认的临时垂域查询。
5. **B 否决**：仓中心架构下垂域亲和是仓级事实（sources 已承载 enabled/weights/allowlist）；B 把它降级为 LLM 每次现场猜参数=放弃配置可审计性；社区佐证=filter 组合固化成 named profile 而非临时拼参数。

## 落地细则（裁决附带）

- 优先级=**查询级整体覆盖仓级（不做深合并）**——axios data 语义
- 审计事件记垂域**生效值+来源层（repo|query）**
- 垂域模式下与 includeDomains 正交共存；参数兼容性校验在 T1 实测上游非法组合

## Sufficiency Gate

多角度检索（axios/better-fetch/grab/Rezo 四先例+Brian Grant/nelhage 声明式配置+Exa/Tavily 同构先例+jimmyresearch profile 化建议）；k8s annotation 先例未得（axios 系四信源已足）；上游 17 垂域非法组合表须 T1 实测。
