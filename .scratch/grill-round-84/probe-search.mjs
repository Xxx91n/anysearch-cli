// R84 probe: raw tools/call on the search tool — surfaces the upstream error.
const ENDPOINT = "https://api.anysearch.com/mcp";
const PROTO = "2025-11-25";
let sessionId;
let nextId = 1;
async function rpc(body, session = true) {
  const headers = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "mcp-protocol-version": PROTO,
    ...(process.env.PROBE_KEY ? { authorization: "Bearer " + process.env.PROBE_KEY } : {}),
    ...(session && sessionId ? { "mcp-session-id": sessionId } : {}),
  };
  const resp = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body) });
  const sid = resp.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  const ct = resp.headers.get("content-type") ?? "";
  const raw = await resp.text();
  if (ct.includes("text/event-stream")) {
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const m = JSON.parse(line.slice(5).trim());
      if (m.id === body.id) return m;
    }
    return null;
  }
  if (!raw.trim()) return { status: resp.status, empty: true };
  return JSON.parse(raw);
}
await rpc({ jsonrpc: "2.0", id: nextId++, method: "initialize", params: { protocolVersion: PROTO, capabilities: {}, clientInfo: { name: "r84-probe", version: "0" } } }, false);
await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
for (const args of [
  { query: "AAPL real-time stock price" },
  { query: "AAPL real-time stock price", domain: "finance", sub_domain: "quote", sub_domain_params: { type: "stock", symbol: "AAPL" } },
  { query: "q", domain: "finance", sub_domain: "calendar", sub_domain_params: { type: "earnings" } },
]) {
  const r = await rpc({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name: "search", arguments: args } });
  const text = (r?.result?.content ?? []).filter(c => c.type === "text").map(c => c.text).join("\n");
  console.log("=== args", JSON.stringify(args));
  console.log("isError:", r?.result?.isError === true, "| text head:", text.slice(0, 300).replace(/\n/g, " | "));
  const sc = r?.result?.structuredContent;
  if (sc?.results) console.log("structured results:", sc.results.length, "first:", JSON.stringify(sc.results[0]).slice(0, 200));
}
