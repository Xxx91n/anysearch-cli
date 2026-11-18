/**
 * @anysearch-cli/dsh-plugin — DeepSeek Harness host adapter.
 *
 * Thin Cordis bundle: hooks layer + native tool plane . Zero
 * runtime deps; @deepseek-ai/* packages are devDep TYPE-ONLY imports (the
 * compile-time churn alarm — an upstream contract change breaks this build,
 * which is the point). All business logic stays in the anysearch server at
 * 127.0.0.1 over HTTP IPC (fail-open by contract); anysearch capability is
 * re-used from @anysearch-cli/plugin hook modules bundled into lib/index.js
 * at build time.
 *
 * Five hook surfaces:
 * agent/created → agent.inject() routing card (durable next-step msg; source!=='startup' guard)
 * systemPrompt → 'anysearch:routing-card' section registration
 * tools/pre-execute → URL-policy deny/ask + preheat recall injection
 * tools/post-execute → distilled summary via additionalContexts, and (#307) the
 *   awaited project-index write so the host waits out that call's post-work
 * tools/result → unused (a non-awaited notification is no place for a write)
 * Tool plane:
 * ctx.tools.register → five native ans_* tools; execute = MCP tools/call
 * over the ans-mcp HTTP endpoint (zero business logic); the MCP task id is
 * carried into the tool value so the index write can name its parent (#307)
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent, SessionStartSource } from '@deepseek-ai/dsh-agent';
import type { MessageId, UserMessage } from '@deepseek-ai/dsh-llm';
import type {
  PostToolDecision,
  PreToolDecision,
  ToolDefinition,
  ToolExecution,
  ToolExecutionResult,
  ToolRunContext,
} from '@deepseek-ai/dsh-tools';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { randomUUID } from 'node:crypto';
import { KernelJsonSchemas, KernelToolDescriptions, type KernelToolName } from '@anysearch-cli/kernel/tool-json-schemas';
import { isAnsTool, callServer, unwrapToolResponse, type HookDecision, type HookInput } from '@anysearch-cli/plugin/hooks/core';
import { makePreToolUseDecision } from '@anysearch-cli/plugin/hooks/preheat';
import { makePostToolUseDecision } from '@anysearch-cli/plugin/hooks/distill';
import { DEFAULT_ROUTING_CARD } from '@anysearch-cli/plugin/hooks/routing-card';
import { resolveServerToken } from '@anysearch-cli/plugin/hooks/server-token';
import { resolveHookProject } from '@anysearch-cli/plugin/hooks/project-identity';
import { indexToProject } from '@anysearch-cli/plugin/hooks/index-entries';

/**
 * anysearch plugin producer kind for injected user messages (0.2.2 contract:
 * MessageSourceMap is merge-extensible — each producer declares its own kind
 * in its own module; there is no shared catch-all 'plugin' kind).
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'anysearch-plugin': { kind: 'anysearch-plugin'; plugin: string };
  }
}

/** Stable Cordis plugin name. */
export const name = 'anysearch-dsh-plugin';
/** Services required before apply(): tools pipeline + prompt registry. */
export const inject = ['tools', 'systemPrompt'];

/** The explicit project this dsh process runs in; null when it cannot be told. */
const projectRoot = (): string | null => resolveHookProject(process.cwd()).root;

/** Hand-rolled UserMessage — a zero-dep plugin cannot import dsh-llm at runtime. */
export function contextMessage(text: string): UserMessage {
  return {
    id: randomUUID() as unknown as MessageId, // type-only dep: brand by cast (MessageId() ctor is runtime)
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'anysearch-plugin', plugin: '@anysearch-cli/dsh-plugin' },
  } as UserMessage;
}

function sessionIdOf(agent: Agent | undefined): string {
  const id = agent?.session?.id;
  return id == null ? '' : String(id);
}

function toolOutputOf(result: Readonly<ToolExecutionResult>): Record<string, unknown> {
  const un = unwrapToolResponse(result.content);
  if (un.kind === 'string') {
    try { return JSON.parse(un.text!) as Record<string, unknown>; }
    catch { return { text: un.text }; }
  }
  if (un.kind === 'object') return un.object!;
  return {};
}

/** Shared PostToolUse HookInput for the post-execute + result surfaces. */
function postHookInput(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): HookInput {
  return {
    event: 'PostToolUse',
    toolName: exec.name,
    toolInput: (exec.arguments ?? {}) as Record<string, unknown>,
    toolOutput: toolOutputOf(result),
    projectPath: projectRoot() ?? '',
    sessionId: sessionIdOf(exec.agent),
  };
}

// -- native ans_* tool plane ------------------------------------
// ctx.tools.register() is consumed with literal ToolDefinitions, NOT
// defineTool(): defineTool is a runtime VALUE in @deepseek-ai/dsh-tools — a
// runtime import violates this package's zero-dep contract (dependencies:{},
// external=node:* builtins only), and bundling it would freeze an upstream
// copy, defeating the compile-time churn alarm. The literal consumes the
// identical ToolRuntime.register contract and keeps KernelJsonSchemas
// VERBATIM — a ParameterSchemaSpec/DSL projection cannot express
// additionalProperties:false / minLength / minimum, so the raw JSON Schema
// object is the zero-loss single-source channel.

interface AnsNativeTool {
  /** Model-facing name inside dsh (bare ans_* name; isAnsTool already matches). */
  readonly dsh: string;
  /** Wire name on the ans-mcp server (kernel key). */
  readonly wire: KernelToolName;
  /** Per-tool IPC budget — retrieval/research/chat far exceed the 5s hook budget. */
  readonly timeoutMs: number;
}

const ANS_NATIVE_TOOLS: readonly AnsNativeTool[] = [
  { dsh: 'ans_search_web', wire: 'search_web', timeoutMs: 30_000 },
  { dsh: 'ans_research_web', wire: 'research_web', timeoutMs: 300_000 },
  { dsh: 'ans_recall_memory', wire: 'recall_memory', timeoutMs: 15_000 },
  { dsh: 'ans_query_knowledge', wire: 'query_knowledge', timeoutMs: 60_000 },
  { dsh: 'ans_ans_chat', wire: 'ans_chat', timeoutMs: 300_000 },
];

/** ans-mcp HTTP transport base (POST {base}/mcp); `ans mcp --transport http` serves it. */
const mcpBaseUrl = (): string => process.env.ANS_MCP_URL || 'http://127.0.0.1:3001';
/** Bearer for the MCP endpoint: ANS_MCP_KEY when the server enforces auth, else the server token. */
const mcpBearer = (): string => process.env.ANS_MCP_KEY || resolveServerToken().token;
const MCP_ACCEPT = 'application/json, text/event-stream';
const MCP_DEFAULT_VERSION = '2025-03-26';

let rpcSeq = 0;
interface McpChannel { version: string }
/** One MCP initialize/initialized handshake per (base,token); cleared on failure. */
const channels = new Map<string, Promise<McpChannel | null>>();

async function mcpHandshake(base: string, token: string): Promise<McpChannel | null> {
  const init = await callServer(base + '/mcp', token, {
    jsonrpc: '2.0', id: ++rpcSeq, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'anysearch-dsh-plugin', version: '0.2.0' } },
  }, { headers: { Accept: MCP_ACCEPT }, timeoutMs: 15_000 });
  const negotiated = (init?.result as { protocolVersion?: unknown } | undefined)?.protocolVersion;
  if (typeof negotiated !== 'string' || negotiated.length === 0) return null;
  const ack = await callServer(base + '/mcp', token, {
    jsonrpc: '2.0', method: 'notifications/initialized',
  }, { headers: { Accept: MCP_ACCEPT, 'MCP-Protocol-Version': negotiated }, timeoutMs: 15_000 });
  if (ack === null) return null;
  return { version: negotiated };
}

function mcpChannel(base: string, token: string): Promise<McpChannel | null> {
  const key = base + '|' + token;
  let p = channels.get(key);
  if (!p) { p = mcpHandshake(base, token); channels.set(key, p); }
  return p;
}

/**
 * execute body: MCP tools/call through the shared callServer contract
 * (Bearer + propagation trio + fail-open). Reachable-but-erroring calls
 * materialize as thrown tool errors; transport failure degrades to the
 * canonical empty value (the AGENTS.md "empty results" contract).
 *
 * #307: the MCP side reports its per-call task in `structuredContent.closeout`.
 * It is carried into the tool VALUE (not the model-facing content) so the
 * awaited post-execute can name the task this call ran as when it sends the
 * project-index write. A host that does not know the id simply forwards none;
 * the service records "no link" instead of inventing one.
 */
async function callAnsTool(wire: KernelToolName, args: Record<string, unknown>, exec: ToolRunContext, timeoutMs: number): Promise<{ content: ContentBlock[]; taskId?: string }> {
  const base = mcpBaseUrl();
  const token = mcpBearer();
  // The MCP HTTP transport has no per-request workspace, so this host passes
  // its own explicit project for the project-index fallback. A model-supplied
  // projectPaths list wins.
  const root = projectRoot();
  const suppliedScope = Array.isArray(args.projectPaths)
    && (args.projectPaths as unknown[]).some((value) => typeof value === "string" && value.trim().length > 0);
  const callArgs = wire === 'recall_memory' && !suppliedScope && root
    ? { ...args, projectPaths: [root] }
    : args;
  const key = base + '|' + token;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ch = await mcpChannel(base, token);
    if (!ch) return { content: [] }; // fail-open: endpoint down/misconfigured
    const resp = await callServer(base + '/mcp', token, {
      jsonrpc: '2.0', id: ++rpcSeq, method: 'tools/call',
      params: { name: wire, arguments: callArgs },
    }, {
      sessionId: sessionIdOf(exec.agent),
      headers: { Accept: MCP_ACCEPT, 'MCP-Protocol-Version': ch.version },
      timeoutMs,
      signal: exec.signal,
    });
    if (resp === null) { // transport failure: re-handshake once, then empty degrade
      channels.delete(key);
      if (attempt === 0) continue;
      return { content: [] };
    }
    const rpcError = resp.error as { code?: number; message?: string } | undefined;
    if (rpcError) {
      // session/not-initialized errors re-handshake once; other RPC errors surface.
      if ((rpcError.code === -32001 || rpcError.code === -32600) && attempt === 0) { channels.delete(key); continue; }
      throw new Error('ans-mcp tools/call ' + wire + ': ' + (rpcError.message ?? 'rpc error'));
    }
    const result = resp.result as { content?: ContentBlock[]; isError?: boolean; structuredContent?: Record<string, unknown> } | undefined;
    if (result?.isError) {
      const text = (result.content ?? []).map((b) => (b as { text?: string }).text ?? '').filter(Boolean).join('\n');
      throw new Error(text || 'ans tool ' + wire + ' failed upstream');
    }
    // #307: keep the MCP task id for the post-work attribution. It rides the
    // tool value, so the model-facing content is unchanged.
    const taskId = (result?.structuredContent?.closeout as { taskId?: unknown } | undefined)?.taskId;
    return {
      content: result?.content ?? [],
      ...(typeof taskId === 'string' && taskId.length > 0 ? { taskId } : {}),
    };
  }
  return { content: [] };
}

export function apply(ctx: Context): void {
  // -- surface 5: native ans_* tool registrations ---------------
  // description+parameters come from the kernel single-source module verbatim
  // (KernelToolDescriptions + KernelJsonSchemas); execute is transport only.
  for (const t of ANS_NATIVE_TOOLS) {
    const definition: ToolDefinition = {
      name: t.dsh,
      description: KernelToolDescriptions[t.wire],
      parameters: KernelJsonSchemas[t.wire],
      output: {
        schema: { type: 'object', properties: { content: { type: 'array' } }, required: ['content'], additionalProperties: true },
        render: (_args, value) => ((value as unknown as { content: ContentBlock[] }).content),
      },
      execute: (args, exec) => callAnsTool(t.wire, (args ?? {}) as Record<string, unknown>, exec, t.timeoutMs),
    };
    ctx.tools.register(definition);
  }

  // -- surface 2: system-prompt section (renders in every request) ----------
  ctx.systemPrompt.section({
    name: 'anysearch:routing-card',
    order: 10300,
    text: DEFAULT_ROUTING_CARD,
  });

  // -- surface 1: agent/created → durable next-step routing card ----------
  // agent/created also fires on resume/clear/compact (SessionStartSource); the
  // routing card is durable, so only 'startup' may inject — other sources would
  // duplicate the card into the session.
  ctx.on('agent/created', ({ agent, source }: { agent: Agent; source: SessionStartSource }): undefined => {
    if (source === 'startup') {
      try { agent.inject(contextMessage(DEFAULT_ROUTING_CARD)); } catch { /* fail-open */ }
    }
    return undefined;
  });

  // -- surface 3: pre-execute — URL policy gate + preheat recall (recall leg awaited by design: the deny gate must block per fail-closed contract, and awaiting lands preheat durable before the gated call completes; bounded by IPC timeouts) ---
  ctx.on('tools/pre-execute', async (
    exec: ToolExecution,
    next: () => Promise<PreToolDecision>,
  ): Promise<PreToolDecision> => {
    if (!isAnsTool(exec.name)) return next();
    let decision: HookDecision;
    try {
      decision = await makePreToolUseDecision({
        event: 'PreToolUse',
        toolName: exec.name,
        toolInput: (exec.arguments ?? {}) as Record<string, unknown>,
        projectPath: projectRoot() ?? '',
        sessionId: sessionIdOf(exec.agent),
      });
    } catch {
      return next(); // fail-open
    }
    if (decision.permission === 'deny') {
      return { kind: 'deny', reason: decision.permissionReason ?? 'denied by anysearch URL policy' };
    }
    if (decision.permission === 'ask') {
      return { kind: 'ask', ...(decision.permissionReason ? { reason: decision.permissionReason } : {}) };
    }
    if (decision.additionalContext) {
      try { exec.agent?.inject(contextMessage(decision.additionalContext)); } catch { /* fail-open */ }
    }
    return next();
  });

  // -- surface 4: post-execute — distilled summary for the next request ------
  // #307: the project-index write belongs to the SAME call as the distilled
  // summary. Before this ticket it ran on `tools/result` as fire-and-forget,
  // which the host never awaits: the agent loop had already moved on, and the
  // write could still be in flight (or be dropped when the process exited)
  // while the anysearch service recorded nothing for it. Running it here means
  // the host waits for it, and the follow-up task it starts names the MCP
  // call's own task as its parent whenever the id came back.
  // It stays excluded from `isError` results: an error outcome has nothing
  // indexable, and the index write is not a correction of the error.
  // The tool VALUE is passed through untouched — dsh validates it against the
  // declared output schema and the model reads `content`, so this wrapper
  // changes none of it.
  ctx.on('tools/post-execute', async (
    exec: ToolExecution,
    result: Readonly<ToolExecutionResult>,
    next: () => Promise<PostToolDecision>,
  ): Promise<PostToolDecision> => {
    if (!isAnsTool(exec.name)) return next();
    const downstream = await next();
    // `next()` is the only place a listener's own failure is contained; a throw
    // here would fail the tool. Every step below is guarded for that reason.
    try {
      const d = makePostToolUseDecision(postHookInput(exec, result));
      if (!result.isError && d.indexEntries && d.indexEntries.length > 0) {
        const valueTask = (result.value as { taskId?: unknown } | undefined)?.taskId;
        const parentTaskId = typeof valueTask === 'string' && valueTask.length > 0 ? valueTask : undefined;
        // Awaited on purpose: this is the call's post-work, not a new request.
        await indexToProject(projectRoot(), exec.name, d.indexEntries, sessionIdOf(exec.agent), parentTaskId)
          .catch(() => { /* fail-open: indexing never fails the tool */ });
      }
      if (!d.distilledOutput) return downstream;
      const injected = contextMessage(d.distilledOutput);
      return {
        ...downstream,
        additionalContexts: [...(downstream.additionalContexts ?? []), injected],
      };
    } catch {
      return downstream; // fail-open
    }
  });

  // -- surface 4b: tools/result — no write here (see surface 4) ------------
  // The index write moved into the awaited post-execute above (#307). The
  // listener is gone rather than kept empty: `tools/result` is a notification
  // the host does NOT await, so writing there is exactly the "task with no
  // owner" shape this ticket removes. The dsh integration doc's surface table
  // says where the write lives now.
}
