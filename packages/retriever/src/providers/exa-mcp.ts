// Exa free-quota search adapter: parses the text block returned by the shared
// transport in exa-free-arm.ts. Page-read parsing lives in exa-fetch.ts.
// Reply shapes, rate limits and known failures: providers/exa/README.md
// ("回复形状" / "已知异常").

import type { Mode, NormalizedResult, ProviderEnvelope, SearchProvider, SearchRequest } from "../contract";
import { PROVIDER_FACTS } from "./provider-facts";
import { callExaMcpTool } from "./exa-free-arm";

const FREE_ARM = PROVIDER_FACTS.exa.freeArm;

// 成功正文是一条 text 里按记录拼的文本块：Title / URL / Published / Author / Highlights，
// 一条记录一个结果。缺 Title 的记录回落到 url；没有 URL 的记录丢掉；Published 的 N/A 算没有。
type TextRecord = { title?: string; url?: string; published?: string; highlights: string[] };

const FIELD = /^(Title|URL|Published|Author|Highlights):[ \t]*(.*)$/;

// 正文里换行、空行都可能有（Highlights 是 markdown），所以不能按空行切记录：
// 抬头是一串连续的字段行，Highlights 之后才是正文。正文里再见到一个像抬头的行
// （Title 后面跟 URL/Published/Author/Highlights 之一，或者没写 Title 时 URL 后面跟
// 那三个之一），就是下一条记录开始了。正文里引用一句「Title: ...」不会被当成新记录。
function parseSearchText(text: string): NormalizedResult[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const records: TextRecord[] = [];
  let current: TextRecord | undefined;
  let inBody = false;
  let sawField = false;

  const begin = () => {
    current = { highlights: [] };
    records.push(current);
    inBody = false;
    sawField = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const field = FIELD.exec(line);
    if (inBody) {
      // 下一条记录也要有抬头的样子：Title 后面得跟 URL/Published/Author/Highlights 之一，
      // 或者（没写 Title 时）URL 后面跟 Published/Author/Highlights。正文里引用一句
      // 「Title: ...」不会被当成新记录。
      const next = lines[i + 1] ?? "";
      const startsNext =
        field !== null &&
        ((field[1] === "Title" && /^(URL|Published|Author|Highlights):/.test(next)) ||
          (field[1] === "URL" && /^(Published|Author|Highlights):/.test(next)));
      if (!startsNext) {
        current!.highlights.push(line);
        continue;
      }
      current = undefined;
      inBody = false;
      sawField = false;
    }
    if (!field) {
      // 抬头被一行普通内容打断：这条记录没写 Highlights，剩下的按正文算。
      if (current) {
        inBody = true;
        current.highlights.push(line);
      }
      continue;
    }
    // 抬头还没读完就又见到 Title（或第二个 URL）：上一条没写 Highlights，新的一条开始了。
    const restart =
      field[1] === "Title" ? sawField : field[1] === "URL" && current?.url !== undefined;
    if (restart) begin();
    if (!current) begin();
    sawField = true;
    switch (field[1]) {
      case "Title": current!.title = field[2]; break;
      case "URL": current!.url = field[2]; break;
      case "Published": current!.published = field[2]; break;
      case "Author": break;
      case "Highlights":
        inBody = true;
        // 服务端把正文写在下一行；万一哪天跟着冒号写在同一行，也别把它丢了。
        if (field[2].trim()) current!.highlights.push(field[2]);
        break;
    }
  }

  const results: NormalizedResult[] = [];
  for (const record of records) {
    const url = cleanField(record.url);
    if (!url) continue;
    const published = cleanField(record.published);
    results.push({
      url,
      title: cleanField(record.title) ?? url,
      snippet: record.highlights.join("\n").trim().slice(0, 500),
      source: PROVIDER_FACTS.exa.id,
      ...(published ? { publishedAt: published } : {}),
    });
  }
  return results;
}

// 上游缺字段时写的是字面量 N/A，不是省略，也不是空串。
function cleanField(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "N/A" ? trimmed : undefined;
}

export class ExaMcpProvider implements SearchProvider {
  readonly id = PROVIDER_FACTS.exa.id;
  readonly modes: readonly Mode[] = FREE_ARM.modes;
  readonly domainFilterSupported = FREE_ARM.domainFilterSupported;
  readonly verticalDomainSupported = FREE_ARM.verticalDomainSupported;
  async search(req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope> {
    const start = Date.now();
    // 免费工具只认 query 和 numResults（objective 标了 required，服务端不校验，不发）。
    const text = await callExaMcpTool(
      "web_search_exa",
      { query: req.query, numResults: req.maxResults ?? 10 },
      signal,
    );

    return {
      provider: this.id,
      results: parseSearchText(text),
      answers: [],
      elapsedMs: Date.now() - start,
      usage: undefined,
    };
  }
}
