// R84 T2 corpus-construction probe — calls get_sub_domains on the live upstream
// for the four selected domains. Construction-time ONLY (never runtime —
// runtime get_sub_domains is a rejected reintroduction per ADR-0084 D-006).
// Usage: node .scratch/grill-round-84/get-sub-domains.mjs
// PROBE_ENDPOINT is the probe-specific override — ANYSEARCH_ENDPOINT is the
// user-configured surface (here a local stub, currently down) and is never
// touched. Default = the public upstream.
const ENDPOINT = process.env.PROBE_ENDPOINT ?? "https://api.anysearch.com/mcp";
const PROTO = "2025-11-25";
let sessionId;
let nextId = 1;

async function rpc(body, session = true) {
  const headers = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "mcp-protocol-version": PROTO,
    ...(process.env.ANYSEARCH_API_KEY ? { authorization: "Bearer " + process.env.ANYSEARCH_API_KEY } : {}),
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

await rpc({ jsonrpc: "2.0", id: nextId++, method: "initialize", params: { protocolVersion: PROTO, capabilities: {}, clientInfo: { name: "r84-corpus-probe", version: "0.0.0" } } }, false);
await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });

const DOMAINS = ["finance", "academic", "code", "health"];
const out = {};
for (const d of DOMAINS) {
  const r = await rpc({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name: "get_sub_domains", arguments: { domain: d } } });
  const text = (r?.result?.content ?? []).filter((c) => c?.type === "text").map((c) => c.text).join("\n");
  out[d] = { isError: r?.result?.isError === true, text: text.slice(0, 14000), structured: r?.result?.structuredContent ?? null };
}
console.log(JSON.stringify(out, null, 2));
