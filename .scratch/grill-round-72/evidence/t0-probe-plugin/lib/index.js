/**
 * @probe/dsh-plugin — R72 spike probe. Zero runtime deps, zero @deepseek-ai imports.
 * Mounts the four hook surfaces our product adapter needs and self-drives
 * ctx.tools.execute() to prove waterfall async serialization, post-execute
 * replacement, result observation, systemPrompt registration, agent.inject()
 * semantics, and mcp__anysearch__* tool naming — all without an LLM turn.
 */
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const name = 'probe-dsh-plugin';
export const inject = ['tools', 'systemPrompt', 'agents'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.PROBE_OUT;
function log(obj) {
  const line = 'PROBE|' + JSON.stringify({ t: Date.now(), ...obj });
  process.stderr.write(line + '\n');
  if (OUT) { try { appendFileSync(OUT, line + '\n'); } catch {} }
}

function userMessage(text) {
  // Hand-rolled UserMessage (createUserMessage lives in @deepseek-ai/dsh-llm,
  // which a zero-dep plugin must not need at runtime).
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'probe-dsh-plugin' },
  };
}

const TOOLS = ['probe_deny', 'probe_allow', 'probe_replace'];

export function apply(ctx) {
  log({ probe: 'apply-enter', inject: 'tools+systemPrompt+agents' });

  // ---- probe 3: systemPrompt section/context/variable registration ----
  try {
    const d1 = ctx.systemPrompt.section({ name: 'probe-section', order: 9001, text: 'PROBE_SECTION_TEXT' });
    const d2 = ctx.systemPrompt.context({ name: 'probe-context', order: 9001, text: 'PROBE_CONTEXT_TEXT' });
    const d3 = ctx.systemPrompt.variable('probevar', () => 'PROBE_VAR_VALUE');
    log({ probe: 'systemPrompt-register', ok: true, disposers: [typeof d1, typeof d2, typeof d3] });
  } catch (e) { log({ probe: 'systemPrompt-register', ok: false, error: String(e) }); }

  // ---- probe 4a: agent lifecycle + inject() semantics ----
  const onSessionStart = (payload) => {
    try {
      const agent = payload.agent;
      agent.inject(userMessage('PROBE_INJECT_MARKER_9f3c via agent/session-start'));
      log({ probe: 'session-start', injected: true, agentId: String(agent?.options?.id ?? 'unknown') });
    } catch (e) { log({ probe: 'session-start', injected: false, error: String(e) }); }
  };
  ctx.on('agent/session-start', onSessionStart);
  ctx.on('agent/created', (payload) => {
    log({ probe: 'agent-created', sessionSeq: payload.agent?.session?.seq });
  });

  // ---- probe 1: tools/pre-execute async serialization ----
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === 'probe_deny') {
      log({ probe: 'pre-execute-enter', name: exec.name });
      await sleep(400); // simulate async IPC policy check
      log({ probe: 'pre-execute-async-settled' });
      return { kind: 'deny', reason: 'PROBE_DENY_AFTER_400MS' };
    }
    return next();
  });

  // ---- probe 2b: tools/post-execute replace + additionalContexts ----
  ctx.on('tools/post-execute', async (exec, result, next) => {
    if (exec.name === 'probe_replace') {
      await sleep(50);
      return { kind: 'accept', content: [{ type: 'text', text: 'PROBE_POST_REPLACED' }] };
    }
    return next();
  });

  // ---- probe 2c: tools/result observation ----
  ctx.on('tools/result', (exec, result) => {
    log({ probe: 'result-observed', name: exec.name, isError: result.isError,
          contentText: (result.content ?? []).map((b) => b.text ?? '').join('').slice(0, 120) });
  });

  // ---- register three probe tools ----
  for (const n of TOOLS) {
    try {
      ctx.tools.register({
        name: n,
        description: 'R72 spike probe tool ' + n,
        parameters: { type: 'object', properties: {} },
        output: { schema: { type: 'string' }, render: (a, v) => [{ type: 'text', text: String(v) }] },
        execute: async () => 'PROBE_TOOL_OK_' + n,
      });
      log({ probe: 'tool-registered', name: n });
    } catch (e) { log({ probe: 'tool-registered', name: n, ok: false, error: String(e) }); }
  }

  // ---- self-test driver (after mount settles) ----
  const ac = new AbortController();
  const call = async (name) => {
    try {
      const r = await ctx.tools.execute({ callId: 'probe-' + name, name, arguments: {}, signal: ac.signal });
      return { isError: r.isError, error: r.error?.message, info: r.error?.info,
               contentText: (r.content ?? []).map((b) => b.text ?? '').join('').slice(0, 160) };
    } catch (e) { return { threw: String(e) }; }
  };

  (async () => {
    await sleep(400); // early start: self-test must land before the LLM stall resolves
    try {
      // probe 1 verdict: async deny must actually deny
      const deny = await call('probe_deny');
      log({ probe: 'exec-deny', ...deny,
            verdict: deny.isError && String(deny.error ?? '').includes('PROBE_DENY_AFTER_400MS') ? 'PASS-async-serialized' : 'FAIL-not-denied' });

      const allow = await call('probe_allow');
      log({ probe: 'exec-allow', ...allow, verdict: allow.isError === false ? 'PASS' : 'FAIL' });

      const repl = await call('probe_replace');
      log({ probe: 'exec-replace', ...repl,
            verdict: repl.contentText === 'PROBE_POST_REPLACED' ? 'PASS-post-replaced' : 'FAIL-content=' + repl.contentText });

      // probe 3 live: assembled prompt must contain our section + context
      try {
        const asm = await ctx.systemPrompt.assemble();
        log({ probe: 'systemPrompt-assemble',
              sectionHit: asm.sections.some((s) => s.name === 'probe-section' && s.text.includes('PROBE_SECTION_TEXT')),
              contextHit: asm.contexts.some((c) => c.name === 'probe-context' && c.text.includes('PROBE_CONTEXT_TEXT')),
              varHit: asm.variables?.probevar === 'PROBE_VAR_VALUE',
              sectionCount: asm.sections.length, contextCount: asm.contexts.length });
      } catch (e) { log({ probe: 'systemPrompt-assemble', ok: false, error: String(e) }); }

      // probe 6 live: bridged tool naming
      try {
        const names = ctx.tools.schemas().map((s) => s.name);
        log({ probe: 'tool-naming', total: names.length,
              anysearch: names.filter((n) => n.startsWith('mcp__anysearch__')),
              ansPatternHit: names.filter((n) => /(?:^|_|__)(?:search_web|research_web|recall_memory|query_knowledge|ans_chat)$/.test(n)) });
      } catch (e) { log({ probe: 'tool-naming', ok: false, error: String(e) }); }

      // probe 2: inject lands durable session event? dump session log
      try {
        let agents = ctx.agents.list();
        for (let w = 0; w < 60 && agents.length === 0; w++) { await sleep(500); agents = ctx.agents.list(); }
        log({ probe: 'agents-list', count: agents.length, waitedRounds: 60 - Math.max(0, 60 - 0) });
        for (const a of agents) {
          const seq = a.session.seq;
          const events = [];
          for (let i = 0; i < seq && events.length < 60; i++) {
            try { const ev = a.session.eventAt(i); if (ev) events.push(ev.type); } catch {}
          }
          const texts = [];
          for (let i = 0; i < seq; i++) {
            try {
              const ev = a.session.eventAt(i);
              const blocks = ev?.data?.message?.content ?? ev?.data?.messages?.[0]?.content;
              if (Array.isArray(blocks)) for (const b of blocks) if (b?.text) texts.push(b.text.slice(0, 80));
            } catch {}
          }
          log({ probe: 'session-dump', agentId: String(a.options?.id ?? '?'), seq,
                hasInjectMarker: texts.some((t) => t.includes('PROBE_INJECT_MARKER_9f3c')),
                eventTypes: events, markerTexts: texts.filter((t) => t.includes('PROBE')) });
          // late inject for durability check even if session-start was missed
          try {
            a.inject(userMessage('PROBE_INJECT_MARKER_late via agents.list'));
            log({ probe: 'late-inject', ok: true });
          } catch (e) { log({ probe: 'late-inject', ok: false, error: String(e) }); }
        }
      } catch (e) { log({ probe: 'session-dump', ok: false, error: String(e) }); }
    } catch (e) { log({ probe: 'selftest-error', error: String(e) }); }
    // late samples: MCP discovery is async — re-check naming until bridged tools land
    for (let w = 0; w < 20; w++) {
      await sleep(2000);
      try {
        const names = ctx.tools.schemas().map((x) => x.name);
        const hit = names.filter((x) => x.startsWith('mcp__anysearch__'));
        if (hit.length > 0 || w === 19) {
          log({ probe: 'tool-naming-late', round: w, total: names.length, anysearch: hit,
                ansPatternHit: names.filter((x) => /(?:^|_|__)(?:search_web|research_web|recall_memory|query_knowledge|ans_chat)$/.test(x)) });
          if (hit.length > 0) break;
        }
      } catch (e) { log({ probe: 'tool-naming-late', round: w, ok: false, error: String(e) }); break; }
    }
    log({ probe: 'PROBE_DONE' });
  })();
}
