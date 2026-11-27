// provider-facts：一家信息源在代码里会被读到的事实，只放这一处。每个适配器（exa 的付费臂和
// 免费额度臂算两个）和免费面探针都从这里读，改一家信息源改一行。
//
// Design: 行为值归这张表，说明文字归文档（providers/<id>/README.md、
// docs/mcp-server.md 的「## Upstream provider transport matrix」）。每行的短注只回答
// 「这个值为什么是这个」；成段的解释、transport 描述和用量留在文档里（#419、#415）。
import type { Mode } from "../contract";

/** 免费面天生验不到的错误类：这一跑过了，也不代表这类问题是好的。
 *  三家的免费面现在都认得出坏 key，所以今天的取值只有 quota；auth 留着是给以后
 *  那些只看连通、分不出 key 好坏的新源用。 */
export type UndetectableClass = "auth" | "quota";

/**
 * 代码里有适配器、也有免费面探针的这几家。新增一家时，`probes` 的 `PROBES` 由类型盯着
 * （`Record<ProbeProviderId, …>`，少一个函数就红），另外三处要手动一起改：
 * 这里、packages/store/src/credentials.ts 的 `SEARCH_PROVIDER_IDS`（凭据那侧）、
 * packages/kernel/src/composition.ts 的 `PROVIDER_CONSTRUCTORS`（装配）。
 */
type ProviderKey = "exa" | "tavily" | "anysearch";

/**
 * 没配 key 时顶上来那一臂的事实。它和付费臂共用 `id`，但能力和入口都不一样：
 * 入口换成一家自己的免费额度端点，能力只按那个端点真给的来。
 */
export interface FreeArmFacts {
  /** 免费额度臂的入口。这个端点不吃凭据，也不跟环境变量走。 */
  endpoint: string;
  /** 免费额度臂接得住的模式——付费臂有的能力，免费端点不一定给。 */
  modes: readonly Mode[];
  domainFilterSupported: boolean;
  verticalDomainSupported: boolean;
}

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
  /** 有免费额度另一条路的那家填这一格；没有就空着。 */
  freeArm?: FreeArmFacts;
  /** MCP 客户端支持的协议版本。只有说 MCP 的那家有；适配器和探针发的是同一格。 */
  mcpProtocolVersion?: string;
  /** 读页端点一次接几个 URL；没有读页适配器的源不填。 */
  fetchMaxUrlsPerCall?: number;
}

/**
 * 表的形状：一家一行，每行都要填全 `ProviderFacts`，`id` 必须和键一致——写错在类型检查就红。
 * 少填一家 = 少了键，少填一个必填字段 = 那一行不满足 `ProviderFacts`。
 * 三个可选字段：`freeArm`（只有 exa 今天有）、`mcpProtocolVersion` 和 `fetchMaxUrlsPerCall`——删掉它们不会让表本身红，
 * 读它们的地方会红。
 */
type ProviderFactsTable = { [K in ProviderKey]: ProviderFacts & { readonly id: K } };

export const PROVIDER_FACTS = {
  exa: {
    id: "exa",
    modes: ["fast", "index", "deep", "answer"],
    // exa-js 的 includeDomains 是一等字段，上游按它过滤。
    domainFilterSupported: true,
    verticalDomainSupported: false,
    // 工具一次最多给 5 个句柄，读页适配器按同一个数切批；端点真实批量上限没测过。
    fetchMaxUrlsPerCall: 5,
    freeProbe: {
      // exa-js 构造函数默认的 baseURL。
      endpoint: "https://api.exa.ai",
      // 没有单独的用量接口，套餐用满只能从搜索回包看出来——免费面验不到。
      undetectable: ["quota"],
    },
    // 没配 key 时换成 Exa 自己的 MCP 端点，只借它的 web_search_exa：没有 answer，
    // 免费工具只有 query / numResults，也没有垂域路由。适配器见 exa-mcp.ts。
    // 三档都声明：端点没有深度参数，fast / index / deep 打出去是同一条请求（mode 只
    // 改 REST 臂的 type）；引擎也不按 modes 过滤 provider，少写档位只会让诊断少报能力。
    freeArm: {
      endpoint: "https://mcp.exa.ai/mcp",
      modes: ["fast", "index", "deep"],
      domainFilterSupported: false,
      verticalDomainSupported: false,
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
