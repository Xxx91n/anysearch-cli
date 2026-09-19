/**
 * @anysearch-cli/dsh-plugin — DeepSeek Harness host adapter (R72 D-001/D-002).
 *
 * Thin Cordis bundle: hooks layer only. Zero runtime deps; @deepseek-ai/*
 * packages are devDep TYPE-ONLY imports (the compile-time churn alarm — an
 * upstream contract change breaks this build, which is the point). All
 * business logic stays in the anysearch server at 127.0.0.1 over HTTP IPC
 * (fail-open by contract); anysearch capability is re-used from
 * @anysearch-cli/plugin hook modules bundled into lib/index.js at build time.
 *
 * Four hook responsibilities:
 *   agent/session-start → agent.inject() routing card (durable next-step msg)
 *   systemPrompt        → 'anysearch:routing-card' section registration
 *   tools/pre-execute   → URL-policy deny/ask + preheat recall injection
 *   tools/post-execute  → distilled summary via additionalContexts
 *   tools/result        → /index IPC on the final frozen outcome
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type {
  PostToolDecision,
  PreToolDecision,
  ToolExecution,
  ToolExecutionResult,
} from '@deepseek-ai/dsh-tools';
import { randomUUID } from 'node:crypto';
import { isAnsTool, callServer, unwrapToolResponse, type HookDecision } from '@anysearch-cli/plugin/hooks/core';
import { makePreToolUseDecision } from '@anysearch-cli/plugin/hooks/preheat';
import { makePostToolUseDecision } from '@anysearch-cli/plugin/hooks/distill';
import { DEFAULT_ROUTING_CARD } from '@anysearch-cli/plugin/hooks/routing-card';
import { resolveServerToken } from '@anysearch-cli/plugin/hooks/server-token';

/** Stable Cordis plugin name. */
export const name = 'anysearch-dsh-plugin';
/** Services required before apply(): tools pipeline + prompt registry. */
export const inject = ['tools', 'systemPrompt'];

const serverUrl = (): string => process.env.ANS_SERVER_URL || 'http://127.0.0.1:33333';

/** Hand-rolled UserMessage — a zero-dep plugin cannot import dsh-llm at runtime. */
export function contextMessage(text: string): UserMessage {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: '@anysearch-cli/dsh-plugin' },
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

export function apply(ctx: Context): void {
  // -- surface 2: system-prompt section (renders in every request) ----------
  ctx.systemPrompt.section({
    name: 'anysearch:routing-card',
    order: 10300,
    text: DEFAULT_ROUTING_CARD,
  });

  // -- surface 1: session-start → durable next-step routing card ------------
  ctx.on('agent/session-start', ({ agent }: { agent: Agent }) => {
    try { agent.inject(contextMessage(DEFAULT_ROUTING_CARD)); } catch { /* fail-open */ }
  });

  // -- surface 3: pre-execute — URL policy gate + preheat recall -------------
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
        projectPath: process.cwd(),
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
  ctx.on('tools/post-execute', async (
    exec: ToolExecution,
    result: Readonly<ToolExecutionResult>,
    next: () => Promise<PostToolDecision>,
  ): Promise<PostToolDecision> => {
    if (!isAnsTool(exec.name)) return next();
    const downstream = await next();
    try {
      const d = makePostToolUseDecision({
        event: 'PostToolUse',
        toolName: exec.name,
        toolInput: (exec.arguments ?? {}) as Record<string, unknown>,
        toolOutput: toolOutputOf(result),
        projectPath: process.cwd(),
        sessionId: sessionIdOf(exec.agent),
      });
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

  // -- surface 4b: tools/result — index the final frozen outcome (fire+forget)
  ctx.on('tools/result', (exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) => {
    if (!isAnsTool(exec.name) || result.isError) return;
    try {
      const d = makePostToolUseDecision({
        event: 'PostToolUse',
        toolName: exec.name,
        toolInput: (exec.arguments ?? {}) as Record<string, unknown>,
        toolOutput: toolOutputOf(result),
        projectPath: process.cwd(),
        sessionId: sessionIdOf(exec.agent),
      });
      if (d.shouldIndex && d.indexEntries && d.indexEntries.length > 0) {
        void callServer(serverUrl() + '/index', resolveServerToken().token, {
          projectPath: process.cwd(),
          toolName: exec.name,
          entries: d.indexEntries,
        }, { sessionId: sessionIdOf(exec.agent) });
      }
    } catch { /* fail-open: indexing must never disturb the pipeline */ }
  });
}
