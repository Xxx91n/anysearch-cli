// R84 T2 corpus generator — appends the live-scoped vertical corpus to
// eval-looks.json deterministically. Idempotent: drops existing vert-1xxx /
// ctrl-1xxx rows before inserting (re-runnable). All sub_domain/params values
// come from the live vocab snapshot evidence/sub-domains-vocab.json
// (get_sub_domains probe, 2026-09-26) — required params always populated.
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "eval-looks.json";
const PROV_VOCAB = { type: "constructed", ref: ".scratch/grill-round-84/evidence/sub-domains-vocab.json", harvestedAt: "2026-09-26", reviewer: "r84-fixer" };
const PROV_RAT = { type: "constructed", ref: ".scratch/grill-round-84/evidence/corpus-rationale.md", harvestedAt: "2026-09-26", reviewer: "r84-fixer" };

// [id, question, lang, intent, vdomain, stratum, vertical|null, vexp, hosts?, paths?, notes]
const FIN = "finance", ACA = "academic", COD = "code", HEA = "health";
const E = [];
const sub = (id, q, lang, intent, vdom, stratum, spec, vexp, notes) =>
  E.push({
    id, domain: "default", question: q, questionLang: lang, intent,
    vertical: spec ?? undefined,
    expected: { verdict: "answer", minResults: 1, vertical: vexp },
    dimensions: ["stratum:" + stratum, "vdomain:" + vdom],
    provenance: stratum === "parameterized" ? PROV_VOCAB : PROV_RAT,
    notes
  });

const VEXP = (domain, extra) => ({ role: "subject", domain, hit: true, ...extra });
const CTRL_NO = { role: "control", hit: false };                      // no spec injected
const CTRL_FB = { role: "control", degraded: "general-fallback" };    // spec injected, fallback/reject surface

// ---------------- finance ----------------
sub("vert-f1101", "NVDA next earnings date this quarter", "en", "factoid", FIN, "parameterized",
  { domain: "finance", subDomain: "calendar", params: { type: "earnings" } },
  VEXP("finance", { sub_domain: "calendar", paramsKeys: ["type"], paramsSent: true, hitHosts: ["financialmodelingprep.com", "finance.yahoo.com", "nasdaq.com"] }),
  "finance.calendar type=earnings（词表 required 参数齐）。");
sub("vert-f1102", "US CPI year-over-year latest release", "en", "factoid", FIN, "parameterized",
  { domain: "finance", subDomain: "macro", params: { type: "cpi" } },
  VEXP("finance", { sub_domain: "macro", paramsKeys: ["type"], paramsSent: true, hitHosts: ["financialmodelingprep.com", "tradingeconomics.com", "bls.gov"] }),
  "finance.macro type=cpi。");
sub("vert-f1103", "AAPL real-time stock price", "en", "factoid", FIN, "parameterized",
  { domain: "finance", subDomain: "quote", params: { type: "stock", symbol: "AAPL" } },
  VEXP("finance", { sub_domain: "quote", paramsKeys: ["symbol", "type"], paramsSent: true, hitHosts: ["finance.yahoo.com", "nasdaq.com", "marketwatch.com", "investing.com"] }),
  "finance.quote type=stock+symbol。");
sub("vert-f1104", "贵州茅台最新股价", "zh", "factoid", FIN, "parameterized",
  { domain: "finance", subDomain: "quote", params: { type: "stock", cn_code: "600519.SH" } },
  VEXP("finance", { sub_domain: "quote", paramsKeys: ["cn_code", "type"], paramsSent: true, hitHosts: ["eastmoney.com", "10jqka.com.cn", "sina.com.cn", "xueqiu.com"] }),
  "finance.quote type=stock+cn_code（A 股通道）。");
sub("vert-f1105", "MSFT analyst ratings and target price overview", "en", "factoid", FIN, "parameterized",
  { domain: "finance", subDomain: "fundamental", params: { type: "overview", symbol: "MSFT" } },
  VEXP("finance", { sub_domain: "fundamental", paramsKeys: ["symbol", "type"], paramsSent: true, hitHosts: ["financialmodelingprep.com", "finance.yahoo.com", "marketbeat.com"] }),
  "finance.fundamental type=overview+symbol。");
sub("vert-f1106", "technology sector US stocks screening", "en", "reference", FIN, "parameterized",
  { domain: "finance", subDomain: "screen", params: { type: "stock", sector: "Technology", country: "US" } },
  VEXP("finance", { sub_domain: "screen", paramsKeys: ["country", "sector", "type"], paramsSent: true, hitHosts: ["finance.yahoo.com", "finviz.com", "tradingview.com"] }),
  "finance.screen type=stock+sector+country。");
sub("vert-f1201", "hedge fund positioning in mega-cap technology stocks", "en", "reference", FIN, "semantic",
  { domain: "finance" }, VEXP("finance", { hitHosts: ["finance.yahoo.com", "bloomberg.com", "reuters.com", "ft.com"] }),
  "finance domain-only 语义查询。");
sub("vert-f1202", "央行降准对债券市场的影响", "zh", "reference", FIN, "semantic",
  { domain: "finance" }, VEXP("finance", { hitHosts: ["eastmoney.com", "cls.cn", "yicai.com", "sina.com.cn", "pbc.gov.cn"] }),
  "中文财经语义查询。");
sub("vert-f1203", "treasury yield curve inversion as recession signal", "en", "reference", FIN, "semantic",
  { domain: "finance" }, VEXP("finance", { hitHosts: ["finance.yahoo.com", "federalreserve.gov", "tradingeconomics.com", "treasury.gov"] }),
  "宏观语义查询。");
sub("vert-f1204", "dividend yield versus buyback yield comparison", "en", "comparison", FIN, "semantic",
  { domain: "finance" }, VEXP("finance", { hitHosts: ["finance.yahoo.com", "investopedia.com", "morningstar.com"] }),
  "对比型金融语义。");
sub("vert-f1205", "美联储下次利率决议时间", "zh", "factoid", FIN, "semantic",
  { domain: "finance" }, VEXP("finance", { hitHosts: ["federalreserve.gov", "cls.cn", "finance.yahoo.com", "reuters.com"] }),
  "中文时点查询。");

// ---------------- academic ----------------
sub("vert-a1101", "retrieval augmented generation evaluation benchmark", "en", "reference", ACA, "parameterized",
  { domain: "academic", subDomain: "preprint", params: { year_from: "2024", sort: "relevance" } },
  VEXP("academic", { sub_domain: "preprint", paramsKeys: ["sort", "year_from"], paramsSent: true, hitHosts: ["arxiv.org", "semanticscholar.org", "openreview.net"] }),
  "academic.preprint year_from+sort。");
sub("vert-a1102", "large language model survey papers", "en", "reference", ACA, "parameterized",
  { domain: "academic", subDomain: "search", params: { type: "review", year_from: "2023" } },
  VEXP("academic", { sub_domain: "search", paramsKeys: ["type", "year_from"], paramsSent: true, hitHosts: ["arxiv.org", "semanticscholar.org", "doi.org", "nature.com", "openalex.org"] }),
  "academic.search type=review+year_from。");
sub("vert-a1103", "CRISPR off-target effects clinical assessment", "en", "factoid", ACA, "parameterized",
  { domain: "academic", subDomain: "biomedical", params: { source: "MED", field: "tiab" } },
  VEXP("academic", { sub_domain: "biomedical", paramsKeys: ["field", "source"], paramsSent: true, hitHosts: ["pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov", "nih.gov"] }),
  "academic.biomedical source=MED。");
sub("vert-a1104", "attention is all you need citation count", "en", "factoid", ACA, "parameterized",
  { domain: "academic", subDomain: "citation", params: { id: "10.48550/arXiv.1706.03762", op: "citation-count" } },
  VEXP("academic", { sub_domain: "citation", paramsKeys: ["id", "op"], paramsSent: true, hitHosts: ["api.crossref.org", "crossref.org", "semanticscholar.org", "opencitations.net"] }),
  "academic.citation id+op=citation-count（required id 携带）。");
sub("vert-a1105", "climate modeling open research datasets", "en", "reference", ACA, "parameterized",
  { domain: "academic", subDomain: "dataset", params: { resource_type: "Dataset" } },
  VEXP("academic", { sub_domain: "dataset", paramsKeys: ["resource_type"], paramsSent: true, hitHosts: ["zenodo.org", "figshare.com", "datadryad.org", "dryad.org"] }),
  "academic.dataset resource_type=Dataset。");
sub("vert-a1201", "recent advances in sparse mixture of experts architectures", "en", "reference", ACA, "semantic",
  { domain: "academic" }, VEXP("academic", { hitHosts: ["arxiv.org", "semanticscholar.org", "openreview.net"] }), null, "学术语义查询。");
sub("vert-a1202", "蛋白质结构预测最新进展", "zh", "reference", ACA, "semantic",
  { domain: "academic" }, VEXP("academic", { hitHosts: ["nature.com", "science.org", "pubmed.ncbi.nlm.nih.gov", "biorxiv.org"] }), null, "中文学术语义。");
sub("vert-a1203", "reinforcement learning from human feedback methods survey", "en", "reference", ACA, "semantic",
  { domain: "academic" }, VEXP("academic", { hitHosts: ["arxiv.org", "semanticscholar.org", "openreview.net", "proceedings.neurips.cc"] }), null, "综述型学术语义。");
sub("vert-a1204", "graph neural networks for drug discovery review", "en", "reference", ACA, "semantic",
  { domain: "academic" }, VEXP("academic", { hitHosts: ["arxiv.org", "pubmed.ncbi.nlm.nih.gov", "nature.com", "sciencedirect.com"] }), null, "交叉学科学术语义。");
sub("vert-a1205", "量子纠错码容错阈值研究", "zh", "reference", ACA, "semantic",
  { domain: "academic" }, VEXP("academic", { hitHosts: ["arxiv.org", "nature.com", "phys.org", "aps.org"] }), null, "中文学术语义。");

// ---------------- code ----------------
sub("vert-c1101", "react server components documentation", "en", "reference", COD, "parameterized",
  { domain: "code", subDomain: "doc", params: { library: "react" } },
  VEXP("code", { sub_domain: "doc", paramsKeys: ["library"], paramsSent: true, hitHosts: ["react.dev", "npmjs.com", "github.com"], hitPaths: ["/reference", "/learn"] }),
  "code.doc library=react（required）。");
sub("vert-c1102", "express error handling middleware", "en", "howto", COD, "parameterized",
  { domain: "code", subDomain: "doc", params: { library: "express" } },
  VEXP("code", { sub_domain: "doc", paramsKeys: ["library"], paramsSent: true, hitHosts: ["expressjs.com", "npmjs.com", "github.com"], hitPaths: ["/en/guide", "/en/4x"] }),
  "code.doc library=express。");
sub("vert-c1103", "tokio runtime spawn tutorial", "en", "howto", COD, "parameterized",
  { domain: "code", subDomain: "doc", params: { library: "tokio" } },
  VEXP("code", { sub_domain: "doc", paramsKeys: ["library"], paramsSent: true, hitHosts: ["tokio.rs", "docs.rs", "github.com"], hitPaths: ["/tk/", "/tokio/"] }),
  "code.doc library=tokio。");
sub("vert-c1104", "useState custom hook implementation typescript", "en", "howto", COD, "parameterized",
  { domain: "code", subDomain: "snippet", params: { lang: "TypeScript" } },
  VEXP("code", { sub_domain: "snippet", paramsKeys: ["lang"], paramsSent: true, hitHosts: ["github.com"], hitPaths: ["/blob/", "/tree/"] }),
  "code.snippet lang=TypeScript。");
sub("vert-c1105", "pandas dataframe merge operation", "en", "howto", COD, "parameterized",
  { domain: "code", subDomain: "snippet", params: { lang: "Python", repo: "pandas-dev/pandas" } },
  VEXP("code", { sub_domain: "snippet", paramsKeys: ["lang", "repo"], paramsSent: true, hitHosts: ["github.com"], hitPaths: ["/pandas-dev/pandas"] }),
  "code.snippet lang+repo 过滤。");
sub("vert-c1201", "python asyncio versus threading performance", "en", "comparison", COD, "semantic",
  { domain: "code" }, VEXP("code", { hitHosts: ["docs.python.org", "realpython.com", "stackoverflow.com", "github.com"] }), null, "代码域语义查询。");
sub("vert-c1202", "kubernetes pod eviction policy configuration", "en", "howto", COD, "semantic",
  { domain: "code" }, VEXP("code", { hitHosts: ["kubernetes.io", "github.com", "stackoverflow.com"] }), null, "运维型代码语义。");
sub("vert-c1203", "rust ownership and borrow checker guide", "en", "howto", COD, "semantic",
  { domain: "code" }, VEXP("code", { hitHosts: ["doc.rust-lang.org", "rust-lang.org", "github.com", "stackoverflow.com"] }), null, "语言语义查询。");
sub("vert-c1204", "typescript generics conditional types explained", "en", "reference", COD, "semantic",
  { domain: "code" }, VEXP("code", { hitHosts: ["typescriptlang.org", "stackoverflow.com", "github.com"] }), null, "TS 语义查询。");
sub("vert-c1205", "redis 缓存穿透解决方案", "zh", "howto", COD, "semantic",
  { domain: "code" }, VEXP("code", { hitHosts: ["redis.io", "github.com", "juejin.cn", "csdn.net", "cnblogs.com"] }), null, "中文工程语义。");

// ---------------- health ----------------
sub("vert-h1101", "aspirin drug label adverse reactions", "en", "factoid", HEA, "parameterized",
  { domain: "health", subDomain: "drug", params: { type: "name" } },
  VEXP("health", { sub_domain: "drug", paramsKeys: ["type"], paramsSent: true, hitHosts: ["dailymed.nlm.nih.gov", "fda.gov", "drugs.com", "nih.gov"] }),
  "health.drug type=name。");
sub("vert-h1102", "metformin phase 3 clinical trials", "en", "reference", HEA, "parameterized",
  { domain: "health", subDomain: "trial" },
  VEXP("health", { sub_domain: "trial", paramsKeys: [], paramsSent: false, hitHosts: ["clinicaltrials.gov", "trialsearch.who.int"] }),
  "health.trial 无 params（词表未列参数）——paramsSent:false 钉 wire 缺席。");
sub("vert-h1103", "diabetes prevalence statistics by country", "en", "factoid", HEA, "parameterized",
  { domain: "health", subDomain: "stats" },
  VEXP("health", { sub_domain: "stats", paramsKeys: [], paramsSent: false, hitHosts: ["who.int", "ourworldindata.org", "cdc.gov"] }),
  "health.stats 无 params。");
sub("vert-h1104", "amoxicillin drug interactions warnings", "en", "factoid", HEA, "parameterized",
  { domain: "health", subDomain: "drug", params: { type: "name" } },
  VEXP("health", { sub_domain: "drug", paramsKeys: ["type"], paramsSent: true, hitHosts: ["dailymed.nlm.nih.gov", "drugs.com", "fda.gov", "medlineplus.gov"] }),
  "health.drug 第二条目——子域内多样本。");
sub("vert-h1105", "alzheimer disease clinical trial recruitment", "en", "reference", HEA, "parameterized",
  { domain: "health", subDomain: "trial" },
  VEXP("health", { sub_domain: "trial", paramsKeys: [], paramsSent: false, hitHosts: ["clinicaltrials.gov", "alzheimers.gov", "nia.nih.gov"] }),
  "health.trial 第二条目。");
sub("vert-h1201", "mRNA vaccine adverse event profile review", "en", "reference", HEA, "semantic",
  { domain: "health" }, VEXP("health", { hitHosts: ["cdc.gov", "fda.gov", "who.int", "pubmed.ncbi.nlm.nih.gov", "nih.gov"] }), null, "医药语义查询。");
sub("vert-h1202", "高血压用药相互作用注意事项", "zh", "howto", HEA, "semantic",
  { domain: "health" }, VEXP("health", { hitHosts: ["dailymed.nlm.nih.gov", "drugs.com", "medlineplus.gov", "nhs.uk"] }), null, "中文医药语义。");
sub("vert-h1203", "childhood vaccination schedule comparison", "en", "comparison", HEA, "semantic",
  { domain: "health" }, VEXP("health", { hitHosts: ["cdc.gov", "who.int", "nice.org.uk"] }), null, "对比型健康语义。");
sub("vert-h1204", "antibiotic resistance surveillance data", "en", "reference", HEA, "semantic",
  { domain: "health" }, VEXP("health", { hitHosts: ["who.int", "cdc.gov", "ecdc.europa.eu", "nih.gov"] }), null, "公共卫生语义。");
sub("vert-h1205", "GLP-1 受体激动剂副作用", "zh", "factoid", HEA, "semantic",
  { domain: "health" }, VEXP("health", { hitHosts: ["fda.gov", "drugs.com", "pubmed.ncbi.nlm.nih.gov", "nejm.org"] }), null, "中文医药事实查询。");

// ---------------- controls (4 per domain) ----------------
const ctrl = (id, q, lang, intent, vdom, spec, vexp, notes) =>
  E.push({
    id, domain: "default", question: q, questionLang: lang, intent,
    vertical: spec ?? undefined,
    expected: { verdict: "answer", minResults: 1, vertical: vexp },
    dimensions: ["stratum:control", "vdomain:" + vdom],
    provenance: PROV_RAT, notes
  });

ctrl("ctrl-f101", "how to cook pasta carbonara properly", "en", "howto", FIN, null, CTRL_NO,
  "域外对照：无 spec 下禁出现 vertical 标记（防误标钉）。");
ctrl("ctrl-f102", "chocolate cake recipe ingredients", "en", "howto", FIN, { domain: "finance" }, CTRL_FB,
  "错配 spec：finance spec + 烹饪问题——上游静默回退面存在性断言（对照臂失败走 degraded 名单）。");
ctrl("ctrl-f103", "upcoming earnings calendar this week", "en", "factoid", FIN, { domain: "finance", subDomain: "bogus_sched" }, CTRL_FB,
  "bogus sub_domain：上游 isError 拒收面 live 钉（对照 2026-09-25 实测矩阵）。");
ctrl("ctrl-f104", "apple price", "en", "factoid", FIN, { domain: "finance", subDomain: "quote", params: { type: "stock" } }, CTRL_FB,
  "歧义查询：apple（水果/股票）+finance spec——消歧质量 delta 基线，存在性断言。");

ctrl("ctrl-a101", "best coffee brewing temperature guide", "en", "howto", ACA, null, CTRL_NO, "域外对照。");
ctrl("ctrl-a102", "pizza dough hydration calculator", "en", "howto", ACA, { domain: "academic" }, CTRL_FB, "错配 spec。");
ctrl("ctrl-a103", "recent papers on neural network pruning", "en", "reference", ACA, { domain: "academic", subDomain: "bogus_papers" }, CTRL_FB, "bogus sub_domain 拒收面。");
ctrl("ctrl-a104", "mercury element facts", "en", "factoid", ACA, { domain: "academic" }, CTRL_FB, "歧义查询（行星/元素/神祇）。");

ctrl("ctrl-c101", "italian pasta sauce comparison", "en", "comparison", COD, null, CTRL_NO, "域外对照。");
ctrl("ctrl-c102", "garden irrigation system setup guide", "en", "howto", COD, { domain: "code" }, CTRL_FB, "错配 spec。");
ctrl("ctrl-c103", "python list comprehension examples", "en", "howto", COD, { domain: "code", subDomain: "bogus_module" }, CTRL_FB, "bogus sub_domain 拒收面。");
ctrl("ctrl-c104", "java language basics", "en", "factoid", COD, { domain: "code" }, CTRL_FB, "歧义查询（语言/岛屿/咖啡）。");

ctrl("ctrl-h101", "how to change a car tire step by step", "en", "howto", HEA, null, CTRL_NO, "域外对照。");
ctrl("ctrl-h102", "chocolate chip cookie baking time", "en", "howto", HEA, { domain: "health" }, CTRL_FB, "错配 spec。");
ctrl("ctrl-h103", "vitamin D dosage guidelines", "en", "factoid", HEA, { domain: "health", subDomain: "bogus_nutri" }, CTRL_FB, "bogus sub_domain 拒收面。");
ctrl("ctrl-h104", "cold or flu difference", "en", "factoid", HEA, { domain: "health" }, CTRL_FB, "歧义查询（温度/感冒）。");

// ---------------- splice ----------------
const data = JSON.parse(readFileSync(FILE, "utf8"));
const keep = (id) => !/^vert-[fach]1\d{3}$/.test(id) && !/^ctrl-[fach]1\d{2}$/.test(id);
data.golden.entries = data.golden.entries.filter((e) => keep(e.id));
for (const e of E) { data.golden.entries.push(e); data.golden.scopes[e.id] = "live"; }
writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
console.log("wrote " + E.length + " corpus entries; totals: golden=" + data.golden.entries.length +
  " vert-subjects=" + E.filter(e => e.expected.vertical.role === "subject").length +
  " ctrl=" + E.filter(e => e.expected.vertical.role === "control").length);
