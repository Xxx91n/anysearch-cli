// provider-facts：一家信息源在代码里会被读到的事实，只放这一处。三个适配器和免费面探针
// 都从这里读，改一家信息源改一行。
//
// Design: 行为值归这张表，说明文字归文档（providers/<id>/README.md、
// docs/mcp-server.md 的「## Upstream provider transport matrix」）——表不当文档的源，
// 往这里塞 prose 只会多一份要维护的拷贝（#419、#415 的 code-only 收窄）。
import type { Mode } from "../contract";

/** 免费面天生验不到的错误类：这一跑过了，也不代表这类问题是好的。
 *  三家的免费面现在都认得出坏 key，所以今天的取值只有 quota；auth 留着是给以后
 *  那些只看连通、分不出 key 好坏的新源用。 */
export type UndetectableClass = "auth" | "quota";

/**
 * 代码里有适配器、也有免费面探针的这几家。这组 id 现在各写一份、没有类型把它们绑在一起：
 * 这里、packages/store/src/credentials.ts 的 `SEARCH_PROVIDER_IDS`（凭据那侧）、
 * packages/kernel/src/composition.ts 的 `PROVIDER_CONSTRUCTORS`（装配）、probes 的 `PROBES`。
 * 新增一家要四处一起改。
 */
type ProviderKey = "exa" | "tavily" | "anysearch";

export interface ProviderFacts {
  /** 接得住的查询模式。适配器不再自己写一份。 */
  modes: readonly Mode[];
  /** true = includeDomains 随请求发给上游；false = 只在上游返回之后本地筛。 */
  domainFilterSupported: boolean;
  /** true = SearchRequest.vertical 映射成上游的 domain 参数。 */
  verticalDomainSupported: boolean;
  /** 免费面：不花钱的那一次调用打哪个入口，以及它天生验不到什么。 */
  freeProbe: {
    /** 探针入口：没给 endpoint 参数时打这个地址。也是该源适配器的默认地址（目前只有 anysearch 两边共用）。 */
    endpoint: string;
    undetectable: readonly UndetectableClass[];
  };
  /** MCP 客户端支持的协议版本。只有说 MCP 的那家有；适配器和探针发的是同一格。 */
  mcpProtocolVersion?: string;
}

/**
 * 表的形状：一家一行，每行都要填全 `ProviderFacts`，`id` 必须和键一致——写错在类型检查就红。
 * 少填一家 = 少了键，少填一个必填字段 = 那一行不满足 `ProviderFacts`。
 * 唯一的可选字段是 `mcpProtocolVersion`：删掉它不会让表本身红，读它的适配器和探针会红。
 */
type ProviderFactsTable = { [K in ProviderKey]: ProviderFacts & { readonly id: K } };

export const PROVIDER_FACTS = {
  exa: {
    id: "exa",
    modes: ["fast", "index", "deep", "answer"],
    // exa-js 的 includeDomains 是一等字段，上游按它过滤。
    domainFilterSupported: true,
    verticalDomainSupported: false,
    freeProbe: {
      // exa-js 构造函数默认的 baseURL。
      endpoint: "https://api.exa.ai",
      // 没有单独的用量接口，套餐用满只能从搜索回包看出来——免费面验不到。
      undetectable: ["quota"],
    },
  },
  tavily: {
    id: "tavily",
    modes: ["fast", "index", "deep", "answer"],
    // include_domains 随 mode 一起发（只发这个会 400），上游按它过滤。
    domainFilterSupported: true,
    verticalDomainSupported: false,
    freeProbe: {
      // @tavily/core 的 BASE_URL。
      endpoint: "https://api.tavily.com",
      // /usage 报得出套餐和用量，三家里验得最全。
      undetectable: [],
    },
  },
  anysearch: {
    id: "anysearch",
    modes: ["fast", "index", "deep"],
    // MCP 的 domain 参数是垂域路由枚举（academic..travel），装不下主机白名单；
    // 垂直那一轴走下面为 true 的位。
    domainFilterSupported: false,
    verticalDomainSupported: true,
    freeProbe: {
      // Design: 免费面 endpoint 就是适配器的默认地址 —— anysearch 的免费面本身就是
      // MCP 入口（initialize + tools/list + 空参数 tools/call），两个消费者要的是同一个
      // URL，收成两格只会漂。归属确认和证书证据见 anysearch.ts 的头注释（#15）。
      endpoint: "https://api.anysearch.com/mcp",
      undetectable: ["quota"],
    },
    // 客户端支持的那个版本由我们决定，不跟服务端协商；请求新版本时上游会往下退
    // （2026-07-28 → 2025-11-25，探针实测过），退到哪个就跟着哪个。
    mcpProtocolVersion: "2025-11-25",
  },
} as const satisfies ProviderFactsTable;
