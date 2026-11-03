// Transport harnesses for the SDK-v2 acceptance tests (#100).
// These reproduce, in-process, the exact wiring apps/mcp/src/index.ts uses:
//   - stdio:  StdioServerTransport over injected PassThrough streams
//   - HTTP:   express + per-request buildServer() + NodeStreamableHTTPServerTransport
//             (stateless: sessionIdGenerator undefined, enableJsonResponse, keepAliveMs 0)
// so the acceptance smoke exercises the real transport classes without a build
// or a spawned binary. The dist-level counterpart lives in scripts/mcp-smoke.mjs.
//
// Not a *.test.ts file — imported by the acceptance tests, never run directly.

import { InMemoryTransport } from "@modelcontextprotocol/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import express from "express";
import { PassThrough } from "node:stream";
import type { AddressInfo } from "node:net";

// Order-independent JSON stringify for deep schema comparison (key order on the
// wire is not contractual; keyword presence / values are).
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

interface RpcHarness {
  rpc: (method: string, params?: unknown) => Promise<any>;
  notify: (method: string, params?: unknown) => void;
}

function makePending() {
  const pending = new Map<number, (m: any) => void>();
  let nextId = 1;
  const dispatch = (m: any) => {
    if (m && m.id !== undefined && pending.has(m.id)) {
      const resolve = pending.get(m.id)!;
      pending.delete(m.id);
      resolve(m);
    }
  };
  const rpc = (method: string, params: unknown, send: (msg: any) => void, label: string) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(label + " timeout: " + method));
      }, 5000);
      pending.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      send({ jsonrpc: "2.0", id, method, params });
    });
  return { dispatch, rpc };
}

// In-memory linked pair (client <-> server). Used for tools/list schema assertions.
export async function inMemoryRpc(server: McpServer): Promise<RpcHarness> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const { dispatch, rpc } = makePending();
  clientT.onmessage = dispatch;
  await server.connect(serverT);
  await clientT.start();
  return {
    rpc: (method, params) => rpc(method, params, (msg) => { clientT.send(msg).catch(() => {}); }, "in-memory"),
    notify: (method, params) => { clientT.send({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) }).catch(() => {}); },
  };
}

// stdio over injected PassThrough streams (newline-delimited JSON-RPC).
export async function stdioRpc(server: McpServer): Promise<RpcHarness> {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const { dispatch, rpc } = makePending();
  let buf = "";
  stdout.on("data", (c: Buffer) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim()) dispatch(JSON.parse(line));
    }
  });
  const t = new StdioServerTransport(stdin, stdout);
  await server.connect(t);
  return {
    rpc: (method, params) => rpc(method, params, (msg) => { stdin.write(JSON.stringify(msg) + "\n"); }, "stdio"),
    notify: (method, params) => { stdin.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) }) + "\n"); },
  };
}

// Stateless Streamable HTTP endpoint, per-request server factory (mirrors index.ts).
export async function httpStateless(makeServer: () => McpServer) {
  const app = express();
  app.use(express.json());
  app.post("/mcp", async (req, res) => {
    try {
      const server = makeServer();
      const t = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        keepAliveMs: 0,
      });
      await server.connect(t);
      await t.handleRequest(req, res, req.body);
    } catch (e) {
      res.status(500).json({ error: { code: -32603, message: "Internal error: " + (e instanceof Error ? e.message : String(e)) } });
    }
  });
  const httpServer = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => httpServer.on("listening", r));
  const port = (httpServer.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}/mcp`;
  const post = async (body: unknown, extraHeaders: Record<string, string> = {}) => {
    const r = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json, text/event-stream", ...extraHeaders },
      body: JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };
  const close = () =>
    new Promise<void>((r) => {
      httpServer.close(() => r());
      // Drop any keep-alive sockets so the test process exits promptly.
      httpServer.closeAllConnections?.();
    });
  return { base, post, close };
}
