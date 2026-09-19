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
  tools: Record<string, never>;
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
    tools: {},
  };
}

const allow: () => Promise<PreToolDecision> = async () => ({ kind: 'allow' });
const accept: () => Promise<PostToolDecision> = async () => ({ kind: 'accept' });

/** Spin a localhost stand-in for the anysearch server; returns its URL + the captured request log. */
async function fakeAnsServer(handler: (req: { url: string; body: string; headers: Record<string, string | string[] | undefined> }) => { status: number; body?: unknown }): Promise<{ url: string; srv: Server; reqs: Array<{ url: string; body: string }> }> {
  const reqs: Array<{ url: string; body: string }> = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      reqs.push({ url: req.url ?? '', body });
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
  for (const ev of ['agent/session-start', 'tools/pre-execute', 'tools/post-execute', 'tools/result']) {
    assert.ok((ctx.listeners.get(ev) ?? []).length >= 1, 'missing listener for ' + ev);
  }
  const sec = ctx.sections.find((s) => s.name === 'anysearch:routing-card');
  assert.ok(sec, 'routing-card section registered');
  assert.match(String(sec!.text), /ans_* prefix|search_web/);
});

test('agent/session-start: injects the routing card as a durable user message', () => {
  const ctx = mockCtx();
  apply(ctx as unknown as Context);
  const agent = mockAgent();
  const fn = ctx.listeners.get('agent/session-start')![0] as (p: { agent: unknown }) => void;
  fn({ agent });
  assert.equal(agent.injected.length, 1);
  assert.match(agent.injected[0].content[0].text ?? '', /anysearch plugin active/);
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
    const out = await fn(exec('mcp__anysearch__search_web', { query: 'see https://bad.example/x' }, mockAgent()), allow);
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
    const out = await fn(exec('mcp__anysearch__search_web', { query: 'see https://unknown.example/x' }, mockAgent()), allow);
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
    const out = await fn(exec('mcp__anysearch__search_web', { query: 'anything' }, agent), allow);
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
    const out = await fn(exec('mcp__anysearch__search_web', { query: 'x' }, agent), allow);
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
  const out = await fn(exec('mcp__anysearch__search_web', { query: 'q' }, mockAgent()), result, accept);
  assert.equal(out.kind, 'accept');
  const msgs = out.additionalContexts ?? [];
  assert.equal(msgs.length, 1);
  const distilled = JSON.parse((msgs[0].content[0] as { text?: string }).text ?? '{}');
  assert.equal(distilled.tool, 'mcp__anysearch__search_web');
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
    fn(exec('mcp__anysearch__search_web', { query: 'q' }, mockAgent()), {
      isError: false,
      content: [{ type: 'text', text: JSON.stringify({ results: [{ title: 'T', url: 'u1', snippet: 's', source: 'exa' }] }) }],
    });
    await new Promise((r) => setTimeout(r, 300)); // fire-and-forget lands
    const idx = reqs.filter((r) => r.url === '/index');
    assert.equal(idx.length, 1);
    const body = JSON.parse(idx[0].body);
    assert.equal(body.toolName, 'mcp__anysearch__search_web');
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
    fn(exec('mcp__anysearch__search_web', {}, mockAgent()), { isError: true, error: { message: 'x' }, content: [] });
    fn(exec('read_file', {}, mockAgent()), { isError: false, content: [] });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(reqs.filter((r) => r.url === '/index').length, 0);
  } finally { srv.close(); delete process.env.ANS_SERVER_URL; }
});

test('contextMessage: produces a durable user message with plugin provenance', () => {
  const m = contextMessage('hello');
  assert.equal(m.role, 'user');
  assert.equal(m.content[0].type, 'text');
  assert.equal((m as { source: { kind: string; plugin: string } }).source.plugin, '@anysearch-cli/dsh-plugin');
});
