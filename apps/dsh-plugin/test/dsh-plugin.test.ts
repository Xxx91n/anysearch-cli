/**
 * apps/dsh-plugin mock-context unit tests (R72 T1 exit gate).
 * Exercises the five hook surfaces against a hand-built Cordis-like ctx and a
 * real localhost stand-in for the anysearch server — no dsh process needed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, name, inject, contextMessage } from '../src/index.js';
import type { Context } from '@deepseek-ai/cordis';
import type { PostToolDecision, PreToolDecision } from '@deepseek-ai/dsh-tools';

type Listener = (...args: never[]) => unknown;

interface MockAgent {
  session: { id: string };
  injected: Array<{ content: Array<{ text?: string }> }>;
  inject(msg: never): void;
}

function mockAgent(id = 'sess-42'): MockAgent {
  return {
    session: { id },
    injected: [],
    inject(msg: never) { this.injected.push(msg as { content: Array<{ text?: string }> }); },
  };
}

interface MockCtx {
  listeners: Map<string, Listener[]>;
  sections: Array<{ name: string; order: number; text: unknown }>;
  contexts: unknown[];
  on(event: string, fn: Listener): void;
  systemPrompt: {
    section(s: { name: string; order: number; text: unknown }): () => void;
    context(c: unknown): () => void;
    variable(n: string, p: unknown): () => void;
  };
  tools: {
    registered: Map<string, Record<string, unknown>>;
    register(d: Record<string, unknown>): () => void;
    get(n: string): Record<string, unknown> | undefined;
  };
}

function mockCtx(): MockCtx {
  const listeners = new Map<string, Listener[]>();
  const sections: MockCtx['sections'] = [];
  const contexts: unknown[] = [];
  return {
    listeners,
    sections,
    contexts,
    on(event, fn) {
      const arr = listeners.get(event) ?? [];
      arr.push(fn);
      listeners.set(event, arr);
    },
    systemPrompt: {
      section(s) { sections.push(s); return () => { }; },
      context(c) { contexts.push(c); return () => { }; },
      variable() { return () => { }; },
    },
    tools: {
      registered: new Map<string, Record<string, unknown>>(),
      register(d) { this.registered.set(d.name as string, d); return () => { this.registered.delete(d.name as string); }; },
      get(n) { return this.registered.get(n); },
    },
  };
}

const allow: () => Promise<PreToolDecision> = async () => ({ kind: 'allow' });
const accept: () => Promise<PostToolDecision> = async () => ({ kind: 'accept' });

/** Spin a localhost stand-in for the anysearch server; returns its URL + the captured request log. */
async function fakeAnsServer(handler: (req: { url: string; body: string; headers: Record<string, string | string[] | undefined> }) => { status: number; body?: unknown }): Promise<{ url: string; srv: Server; reqs: Array<{ url: string; body: string; headers: Record<string, string | string[] | undefined> }> }> {
  const reqs: Array<{ url: string; body: string; headers: Record<string, string | string[] | undefined> }> = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      reqs.push({ url: req.url ?? '', body, headers: req.headers });
      const out = handler({ url: req.url ?? '', body, headers: req.headers });
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.body ?? {}));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const addr = srv.address();
  return { url: 'http://127.0.0.1:' + (typeof addr === 'object' && addr ? addr.port : 0), srv, reqs };
}

const tmp = mkdtempSync(join(tmpdir(), 'ans-dsh-test-'));
const prevCwd = process.cwd();
process.chdir(tmp);
process.env.ANS_SERVER_TOKEN = 'test-token';
test.after(() => { process.chdir(prevCwd); rmSync(tmp, { recursive: true, force: true }); });

function exec(name: string, args: Record<string, unknown>, agent?: MockAgent) {
  return { name, arguments: args, agent, signal: new AbortController().signal };
}

test('exports: stable name + inject service list', () => {
  assert.equal(name, 'anysearch-dsh-plugin');
  assert.deepEqual([...inject].sort(), ['systemPrompt', 'tools']);
});

test('apply: mounts all five hook surfaces + routing-card section', () => {
  const ctx = mockCtx();
  apply(ctx as unknown as Context);
  for (const ev of ['agent/created', 'tools/pre-execute', 'tools/post-execute', 'tools/result']) {
    assert.ok((ctx.listeners.get(ev) ?? []).length >= 1, 'missing listener for ' + ev);
  }
  const sec = ctx.sections.find((s) => s.name === 'anysearch:routing-card');
  assert.ok(sec, 'routing-card section registered');
  assert.match(String(sec!.text), /ans_* prefix|search_web/);
});

test('agent/created: startup injects the routing card as a durable user message', () => {
  const ctx = mockCtx();
  apply(ctx as unknown as Context);
  const agent = mockAgent();
  const fn = ctx.listeners.get('agent/created')![0] as (p: { agent: unknown; source: string }) => void;
  fn({ agent, source: 'startup' });
  assert.equal(agent.injected.length, 1);
  assert.match(agent.injected[0].content[0].text ?? '', /anysearch plugin active/);
});

test('agent/created: resume/clear/compact do not re-inject the routing card', () => {
  const ctx = mockCtx();
  apply(ctx as unknown as Context);
  const agent = mockAgent();
  const fn = ctx.listeners.get('agent/created')![0] as (p: { agent: unknown; source: string }) => void;
  for (const source of ['resume', 'clear', 'compact']) fn({ agent, source });
  assert.equal(agent.injected.length, 0);
});

test('tools/pre-execute: non-ans tool passes through untouched', async () => {
  const ctx = mockCtx();
  apply(ctx as unknown as Context);
  const fn = ctx.listeners.get('tools/pre-execute')![0] as (
    e: unknown, n: () => Promise<PreToolDecision>,
  ) => Promise<PreToolDecision>;
  const out = await fn(exec('read_file', {}), allow);
  assert.equal(out.kind, 'allow');
});

test('tools/pre-execute: denied URL on ans tool returns deny', async () => {
  const { url, srv } = await fakeAnsServer(({ url }) =>
    url === '/policy'
      ? { status: 200, body: { allow: ['ok.example'], deny: ['bad.example'], policy_version: 'x' } }
      : { status: 404 });
  process.env.ANS_SERVER_URL = url;
  try {
    const ctx = mockCtx();
    apply(ctx as unknown as Context);
    const fn = ctx.listeners.get('tools/pre-execute')![0] as (
      e: unknown, n: () => Promise<PreToolDecision>,
    ) => Promise<PreToolDecision>;
    const out = await fn(exec('ans_search_web', { query: 'see https://bad.example/x' }, mockAgent()), allow);
    assert.equal(out.kind, 'deny');
    if (out.kind === 'deny') assert.match(out.reason, /bad.example|denylist/);
  } finally { srv.close(); delete process.env.ANS_SERVER_URL; }
});

test('tools/pre-execute: unallowlisted URL returns ask', async () => {
  const { url, srv } = await fakeAnsServer(({ url }) =>
    url === '/policy'
      ? { status: 200, body: { allow: ['ok.example'], deny: [], policy_version: 'x' } }
      : { status: 404 });
  process.env.ANS_SERVER_URL = url;
  try {
    const ctx = mockCtx();
    apply(ctx as unknown as Context);
    const fn = ctx.listeners.get('tools/pre-execute')![0] as (
      e: unknown, n: () => Promise<PreToolDecision>,
    ) => Promise<PreToolDecision>;
    const out = await fn(exec('ans_search_web', { query: 'see https://unknown.example/x' }, mockAgent()), allow);
    assert.equal(out.kind, 'ask');
  } finally { srv.close(); delete process.env.ANS_SERVER_URL; }
});

test('tools/pre-execute: recall hits are injected via agent.inject and the call is allowed', async () => {
  const { url, srv } = await fakeAnsServer(({ url }) =>
    url === '/recall'
      ? { status: 200, body: { hits: [{ title: 'Prior result', url: 'u', snippet: 'snippet-1' }] } }
      : { status: 404 });
  process.env.ANS_SERVER_URL = url;
  try {
    const ctx = mockCtx();
    apply(ctx as unknown as Context);
    const fn = ctx.listeners.get('tools/pre-execute')![0] as (
      e: unknown, n: () => Promise<PreToolDecision>,
    ) => Promise<PreToolDecision>;
    const agent = mockAgent();
    const out = await fn(exec('ans_search_web', { query: 'anything' }, agent), allow);
    assert.equal(out.kind, 'allow');
    assert.equal(agent.injected.length, 1);
    assert.match(agent.injected[0].content[0].text ?? '', /anysearch preheat|Prior result/);
  } finally { srv.close(); delete process.env.ANS_SERVER_URL; }
});

test('tools/pre-execute: server down fails open to allow', async () => {
  process.env.ANS_SERVER_URL = 'http://127.0.0.1:1'; // dead
  try {
    const ctx = mockCtx();
    apply(ctx as unknown as Context);
    const fn = ctx.listeners.get('tools/pre-execute')![0] as (
      e: unknown, n: () => Promise<PreToolDecision>,
    ) => Promise<PreToolDecision>;
    const agent = mockAgent();
    const out = await fn(exec('ans_search_web', { query: 'x' }, agent), allow);
    assert.equal(out.kind, 'allow');
    assert.equal(agent.injected.length, 0);
  } finally { delete process.env.ANS_SERVER_URL; }
});

test('tools/post-execute: non-ans tool passes through', async () => {
  const ctx = mockCtx();
  apply(ctx as unknown as Context);
  const fn = ctx.listeners.get('tools/post-execute')![0] as (
    e: unknown, r: unknown, n: () => Promise<PostToolDecision>,
  ) => Promise<PostToolDecision>;
  const out = await fn(exec('read_file', {}), { isError: false, content: [] }, accept);
  assert.equal(out.kind, 'accept');
  assert.equal(out.additionalContexts, undefined);
});

test('tools/post-execute: ans result gains a distilled additionalContexts message', async () => {
  const ctx = mockCtx();
  apply(ctx as unknown as Context);
  const fn = ctx.listeners.get('tools/post-execute')![0] as (
    e: unknown, r: unknown, n: () => Promise<PostToolDecision>,
  ) => Promise<PostToolDecision>;
  const result = {
    isError: false,
    content: [{ type: 'text', text: JSON.stringify({ results: [{ title: 'T', url: 'u1', snippet: 's', source: 'exa' }] }) }],
  };
  const out = await fn(exec('ans_search_web', { query: 'q' }, mockAgent()), result, accept);
  assert.equal(out.kind, 'accept');
  const msgs = out.additionalContexts ?? [];
  assert.equal(msgs.length, 1);
  const distilled = JSON.parse((msgs[0].content[0] as { text?: string }).text ?? '{}');
  assert.equal(distilled.tool, 'ans_search_web');
  assert.equal(distilled.resultCount, 1);
});

test('tools/result: indexes successful ans results over IPC', async () => {
  const { url, srv, reqs } = await fakeAnsServer(({ url }) =>
    url === '/index' ? { status: 200, body: { ok: true } } : { status: 404 });
  process.env.ANS_SERVER_URL = url;
  try {
    const ctx = mockCtx();
    apply(ctx as unknown as Context);
    const fn = ctx.listeners.get('tools/result')![0] as (e: unknown, r: unknown) => void;
    fn(exec('ans_search_web', { query: 'q' }, mockAgent()), {
      isError: false,
      content: [{ type: 'text', text: JSON.stringify({ results: [{ title: 'T', url: 'u1', snippet: 's', source: 'exa' }] }) }],
    });
    await new Promise((r) => setTimeout(r, 300)); // fire-and-forget lands
    const idx = reqs.filter((r) => r.url === '/index');
    assert.equal(idx.length, 1);
    const body = JSON.parse(idx[0].body);
    assert.equal(body.toolName, 'ans_search_web');
    assert.equal(body.entries.length, 1);
  } finally { srv.close(); delete process.env.ANS_SERVER_URL; }
});

test('tools/result: error results and non-ans tools are skipped', async () => {
  const { url, srv, reqs } = await fakeAnsServer(() => ({ status: 200, body: {} }));
  process.env.ANS_SERVER_URL = url;
  try {
    const ctx = mockCtx();
    apply(ctx as unknown as Context);
    const fn = ctx.listeners.get('tools/result')![0] as (e: unknown, r: unknown) => void;
    fn(exec('ans_search_web', {}, mockAgent()), { isError: true, error: { message: 'x' }, content: [] });
    fn(exec('read_file', {}, mockAgent()), { isError: false, content: [] });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(reqs.filter((r) => r.url === '/index').length, 0);
  } finally { srv.close(); delete process.env.ANS_SERVER_URL; }
});

test('contextMessage: produces a durable user message with plugin provenance', () => {
  const m = contextMessage('hello');
  assert.equal(m.role, 'user');
  assert.equal(m.content[0].type, 'text');
  const src = (m as { source: { kind: string; plugin: string } }).source;
  assert.equal(src.kind, 'anysearch-plugin');
  assert.equal(src.plugin, '@anysearch-cli/dsh-plugin');
});

// ---------------------------------------------------------------------------
// R90 T2 — expected-RED: native ctx.tools registration of the five ans_* tools.
// Pre-T3 every assertion below fails: apply() registers nothing on ctx.tools.
// ---------------------------------------------------------------------------

const ANS_NATIVE_NAMES = ['ans_search_web', 'ans_research_web', 'ans_recall_memory', 'ans_query_knowledge', 'ans_ans_chat'] as const;

/** Minimal ToolRunContext stand-in — the execute bodies read only agent+signal. */
function execCtx(agent?: MockAgent) {
  return { agent, signal: new AbortController().signal };
}

/** localhost stand-in for the ans-mcp HTTP transport: mirrors the stateless JSON-RPC sequence the probe script speaks. */
async function fakeMcpServer(toolResult: Record<string, unknown> | null): Promise<{ url: string; srv: Server; reqs: Array<{ url: string; body: string; headers: Record<string, string | string[] | undefined> }> }> {
  return fakeAnsServer(({ url, body }) => {
    if (url !== '/mcp') return { status: 404 };
    let rpc: { method?: string; id?: unknown } = {};
    try { rpc = JSON.parse(body); } catch { return { status: 400 }; }
    if (rpc.method === 'initialize') {
      return { status: 200, body: { jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'fake-ans-mcp', version: '0' } } } };
    }
    if (rpc.method === 'notifications/initialized') return { status: 202, body: {} };
    if (rpc.method === 'tools/call') {
      if (toolResult === null) return { status: 200, body: { jsonrpc: '2.0', id: rpc.id, error: { code: -32001, message: 'session expired' } } };
      return { status: 200, body: { jsonrpc: '2.0', id: rpc.id, result: toolResult } };
    }
    return { status: 400 };
  });
}

test('apply: registers all five ans_* tools natively on ctx.tools', () => {
  const ctx = mockCtx();
  apply(ctx as unknown as Context);
  for (const n of ANS_NATIVE_NAMES) {
    assert.ok(ctx.tools.get(n), 'missing native registration for ' + n);
  }
});

test('native tools: parameters projected verbatim from the kernel schema source', () => {
  const ctx = mockCtx();
  apply(ctx as unknown as Context);
  const sw = ctx.tools.get('ans_search_web') as { parameters: Record<string, unknown> } | undefined;
  assert.ok(sw, 'ans_search_web not registered');
  const sp = sw!.parameters as { type?: string; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown };
  assert.equal(sp.type, 'object');
  assert.ok(sp.properties && 'query' in sp.properties, 'search_web parameters lack query');
  assert.deepEqual(sp.required, ['query']);
  assert.equal(sp.additionalProperties, false);
  const rc = (ctx.tools.get('ans_recall_memory') as { parameters: { properties: Record<string, unknown>; required: string[] } }).parameters;
  assert.deepEqual(rc.required, ['query']);
  assert.ok('limit' in rc.properties);
  const ac = (ctx.tools.get('ans_ans_chat') as { parameters: { required: string[] } }).parameters;
  assert.deepEqual(ac.required, ['message']);
});

test('native execute: MCP tools/call to /mcp carries kernel tool name + propagation trio', async () => {
  const { url, srv, reqs } = await fakeMcpServer({ content: [{ type: 'text', text: '{"results":[{"title":"T","url":"u"}]}' }], isError: false });
  process.env.ANS_MCP_URL = url;
  try {
    const ctx = mockCtx();
    apply(ctx as unknown as Context);
    const def = ctx.tools.get('ans_search_web') as { execute(a: unknown, e: unknown): Promise<{ content: Array<{ type: string; text?: string }> }> } | undefined;
    assert.ok(def, 'ans_search_web not registered');
    const agent = mockAgent('sess-9');
    const value = await def!.execute({ query: 'q-one' }, execCtx(agent));
    assert.match(value.content[0]?.text ?? '', /results/);
    const initReq = reqs.find((r) => r.body.includes('"initialize"'));
    const callReq = reqs.find((r) => r.body.includes('"tools/call"'));
    assert.ok(initReq, 'no MCP initialize handshake on the wire');
    assert.ok(callReq, 'no tools/call on the wire');
    const call = JSON.parse(callReq.body) as { method: string; params: { name: string; arguments: Record<string, unknown> } };
    assert.equal(call.method, 'tools/call');
    assert.equal(call.params.name, 'search_web');
    assert.deepEqual(call.params.arguments, { query: 'q-one' });
    assert.equal(callReq.headers.authorization, 'Bearer test-token');
    assert.match(String(callReq.headers.traceparent ?? ''), /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    assert.equal(callReq.headers['x-anysearch-session-id'], 'sess-9');
    assert.match(String(callReq.headers.accept ?? ''), /text\/event-stream/);
  } finally { srv.close(); delete process.env.ANS_MCP_URL; }
});

test('native execute: server unreachable fails open to empty content (no throw)', async () => {
  process.env.ANS_MCP_URL = 'http://127.0.0.1:1';
  try {
    const ctx = mockCtx();
    apply(ctx as unknown as Context);
    const def = ctx.tools.get('ans_recall_memory') as { execute(a: unknown, e: unknown): Promise<{ content: unknown[] }> } | undefined;
    assert.ok(def, 'ans_recall_memory not registered');
    const value = await def!.execute({ query: 'x' }, execCtx());
    assert.deepEqual(value, { content: [] });
  } finally { delete process.env.ANS_MCP_URL; }
});

test('native execute: upstream isError materializes as a thrown tool error', async () => {
  const { url, srv } = await fakeMcpServer({ content: [{ type: 'text', text: 'provider blew up' }], isError: true });
  process.env.ANS_MCP_URL = url;
  try {
    const ctx = mockCtx();
    apply(ctx as unknown as Context);
    const def = ctx.tools.get('ans_search_web') as { execute(a: unknown, e: unknown): Promise<unknown> } | undefined;
    assert.ok(def, 'ans_search_web not registered');
    await assert.rejects(() => def!.execute({ query: 'q' }, execCtx()), /provider blew up/);
  } finally { srv.close(); delete process.env.ANS_MCP_URL; }
});

test('native execute: JSON-RPC session error re-handshakes once then succeeds', async () => {
  // First tools/call answers a session error; the retry after re-handshake succeeds.
  let calls = 0;
  const { url, srv } = await fakeAnsServer(({ url, body }) => {
    if (url !== '/mcp') return { status: 404 };
    const rpc = JSON.parse(body) as { method?: string; id?: unknown };
    if (rpc.method === 'initialize') return { status: 200, body: { jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'f', version: '0' } } } };
    if (rpc.method === 'notifications/initialized') return { status: 202, body: {} };
    if (rpc.method === 'tools/call') {
      calls++;
      if (calls === 1) return { status: 200, body: { jsonrpc: '2.0', id: rpc.id, error: { code: -32001, message: 'session expired' } } };
      return { status: 200, body: { jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: 'ok-after-reinit' }], isError: false } } };
    }
    return { status: 400 };
  });
  process.env.ANS_MCP_URL = url;
  try {
    const ctx = mockCtx();
    apply(ctx as unknown as Context);
    const def = ctx.tools.get('ans_query_knowledge') as { execute(a: unknown, e: unknown): Promise<{ content: Array<{ text?: string }> }> } | undefined;
    assert.ok(def, 'ans_query_knowledge not registered');
    const value = await def!.execute({ query: 'kb' }, execCtx());
    assert.equal(value.content[0]?.text, 'ok-after-reinit');
    assert.ok(calls >= 2, 'expected a re-handshake retry, got ' + calls + ' calls');
  } finally { srv.close(); delete process.env.ANS_MCP_URL; }
});

test('hook compatibility: bare ans_* names still hit all four hook surfaces', async () => {
  const { url, srv, reqs } = await fakeAnsServer(({ url }) =>
    url === '/recall'
      ? { status: 200, body: { hits: [{ title: 'Prior', url: 'u', snippet: 'snip' }] } }
      : { status: 200, body: {} });
  process.env.ANS_SERVER_URL = url;
  try {
    const ctx = mockCtx();
    apply(ctx as unknown as Context);
    const pre = ctx.listeners.get('tools/pre-execute')![0] as (e: unknown, n: () => Promise<PreToolDecision>) => Promise<PreToolDecision>;
    const post = ctx.listeners.get('tools/post-execute')![0] as (e: unknown, r: unknown, n: () => Promise<PostToolDecision>) => Promise<PostToolDecision>;
    const res = ctx.listeners.get('tools/result')![0] as (e: unknown, r: unknown) => void;
    const agent = mockAgent();
    const result = { isError: false, content: [{ type: 'text', text: JSON.stringify({ results: [{ title: 'T', url: 'u1', snippet: 's', source: 'exa' }] }) }] };
    const out = await pre(exec('ans_search_web', { query: 'x' }, agent), allow);
    assert.equal(out.kind, 'allow');
    assert.ok(agent.injected.length >= 1, 'pre-execute did not engage for bare ans_search_web');
    const p = await post(exec('ans_search_web', { query: 'q' }, agent), result, accept);
    assert.ok((p.additionalContexts ?? []).length === 1, 'post-execute did not engage for bare ans_search_web');
    res(exec('ans_search_web', {}, agent), result);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(reqs.filter((r) => r.url === '/index').length, 1, 'tools/result did not index for bare ans_search_web');
  } finally { srv.close(); delete process.env.ANS_SERVER_URL; }
});
