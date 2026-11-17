// What the resume path does with a damaged record, end to end (#316).
//
// The pure judgment is tested in pi-session-strict.test.ts. This file covers
// the part that only shows up on the real runtime:
//
//   R1 a torn tail is cut before the next append, so the conversation keeps
//      working instead of being locked out by one failed write;
//   R2 a record with a broken middle line is refused, the run sends nothing,
//      and the file is byte-for-byte unchanged;
//   R3 a record claiming a newer format is refused the same way;
//   R4 a record whose identity disagrees with the handle is refused, and no
//      fresh conversation is created under that handle;
//   R5 the record a refused run left alone can still be read afterwards.
//
// Run: pnpm --filter @anysearch-cli/kernel run test

import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "@anysearch-cli/store";
import { PI_SESSION_FORMAT_VERSION } from "../src/pi-session";
import { PiAgentRuntime, piSessionKey } from "../src/pi-runtime";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

function reply(text: string) {
  const message: any = {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "probe",
    model: "probe-model",
    stopReason: "stop",
    timestamp: Date.now(),
  };
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: { ...message, content: [] } };
      yield { type: "text_delta", contentIndex: 0, delta: text, partial: message };
      yield { type: "done", reason: "stop", message };
    },
    result: async () => message,
  };
}

function provider(text: string) {
  const calls: any[] = [];
  const fn = (_model: any, context: any) => {
    calls.push({ context });
    return reply(text);
  };
  return { fn, calls };
}

const domain: any = {
  sources: { enabled: [] },
  prompts: [{ name: "system", content: "RESUME-PROBE: answer briefly." }],
  skills: { active: ["search"] },
  hooks: { toolWhitelist: ["search"] },
  rag: { adapter: "none" },
};
const model: any = {
  id: "probe-model", name: "probe-model", api: "openai-completions", provider: "probe",
  contextWindow: 200000, maxTokens: 4096, reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

class NoopRetriever {
  async search(q: any) {
    return { query: String(q.query), mode: "fast", results: [], answers: [], metadata: {} } as any;
  }
}

async function drain(run: AsyncIterable<any>) {
  const events: any[] = [];
  for await (const e of run) events.push(e);
  return events;
}

function textOf(context: any): string {
  return JSON.stringify((context?.messages ?? []).map((m: any) => ({
    role: m?.role,
    text: typeof m?.content === "string" ? m.content : (m?.content ?? []).map((c: any) => c?.text ?? "").join(""),
  })));
}

function recordPath(piDir: string, sessionId: string): string {
  const files = readdirSync(piDir).filter((f) => f.endsWith(".jsonl") && f.includes(piSessionKey(sessionId)));
  return join(piDir, files[0]!);
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), "ans-316-runtime-"));
  const piDir = join(workDir, "pi-sessions");
  const store = new SqliteSessionStore(join(workDir, "anysearch.db"));

  try {
    // ---------- R1: a torn tail is cut, and the conversation continues ----------
    {
      const session = await store.createSession("chat");
      const first = provider("FIRST-ANSWER");
      await drain(new PiAgentRuntime({
        retriever: new NoopRetriever() as any,
        domain, model, streamFn: first.fn as any,
        store, sessionId: session.id, piSessionDir: piDir,
        getApiKey: async () => "probe-key",
      }).run("FIRST-QUESTION-MARKER"));

      const path = recordPath(piDir, session.id);
      const whole = readFileSync(path, "utf8");
      assert(whole.endsWith("\n"), "R1: the first run left a complete record");

      // What a process killed mid-append leaves: a fragment with no newline.
      const fragment = '{"type":"message","id":"dead","parentId":"x","timest';
      appendFileSync(path, fragment);
      assert(readFileSync(path, "utf8").endsWith(fragment), "R1: the torn tail is on disk before the resume");

      const second = provider("SECOND-ANSWER");
      const events = await drain(new PiAgentRuntime({
        retriever: new NoopRetriever() as any,
        domain, model, streamFn: second.fn as any,
        store, sessionId: session.id, piSessionDir: piDir,
        getApiKey: async () => "probe-key",
      }).run("SECOND-QUESTION-MARKER"));

      assert(!events.some((e) => e.type === "error"), "R1: the resume is not refused for a torn tail (got " + JSON.stringify(events.filter((e) => e.type === "error")) + ")");
      assert(events.some((e) => e.type === "done"), "R1: the resumed run finishes");
      const after = readFileSync(path, "utf8");
      assert(!after.includes(fragment), "R1: the fragment was cut before the next append");
      assert(after.startsWith(whole), "R1: the complete lines that were there are untouched");
      // Every line must now parse: one failed write no longer strands the rest.
      for (const line of after.split("\n").filter((l) => l.trim())) {
        let ok = true;
        try { JSON.parse(line); } catch { ok = false; }
        assert(ok, "R1: every line of the repaired record parses");
      }
      assert(textOf(second.calls[0]?.context).includes("FIRST-QUESTION-MARKER"),
        "R1: the repaired record still carries the earlier turn");
    }

    // ---------- R2/R3/R4: a damaged record is refused untouched ----------
    const refusals: Array<{ name: string; damage: (path: string) => void; expect: RegExp }> = [
      {
        name: "R2 broken middle line",
        damage: (path) => {
          const lines = readFileSync(path, "utf8").split("\n");
          // Insert the damage right after the header, then keep the rest.
          writeFileSync(path, [lines[0], "{not json at all", ...lines.slice(1)].join("\n"));
        },
        expect: /第 2 行/,
      },
      {
        name: "R3 newer format",
        damage: (path) => {
          const lines = readFileSync(path, "utf8").split("\n");
          const header = JSON.parse(lines[0]!);
          header.version = PI_SESSION_FORMAT_VERSION + 1;
          lines[0] = JSON.stringify(header);
          writeFileSync(path, lines.join("\n"));
        },
        expect: /格式版本/,
      },
      {
        name: "R4 identity mismatch",
        damage: (path) => {
          const lines = readFileSync(path, "utf8").split("\n");
          const header = JSON.parse(lines[0]!);
          header.id = "ans-" + "0".repeat(32);
          lines[0] = JSON.stringify(header);
          writeFileSync(path, lines.join("\n"));
        },
        expect: /身份对不上/,
      },
    ];

    for (const sample of refusals) {
      const session = await store.createSession("chat");
      const seed = provider("SEED-ANSWER");
      await drain(new PiAgentRuntime({
        retriever: new NoopRetriever() as any,
        domain, model, streamFn: seed.fn as any,
        store, sessionId: session.id, piSessionDir: piDir,
        getApiKey: async () => "probe-key",
      }).run("SEED-QUESTION"));

      const path = recordPath(piDir, session.id);
      sample.damage(path);
      const damaged = readFileSync(path);
      const recordCountBefore = readdirSync(piDir).filter((f) => f.endsWith(".jsonl")).length;

      const neverCalled = provider("MUST-NOT-ANSWER");
      const events = await drain(new PiAgentRuntime({
        retriever: new NoopRetriever() as any,
        domain, model, streamFn: neverCalled.fn as any,
        store, sessionId: session.id, piSessionDir: piDir,
        requirePiSessionRecord: true,
        getApiKey: async () => "probe-key",
      }).run("REFUSED-QUESTION"));

      const errors = events.filter((e) => e.type === "error");
      assert(errors.length === 1, sample.name + ": exactly one error event (got " + JSON.stringify(events.map((e) => e.type)) + ")");
      assert(sample.expect.test(errors[0]?.message ?? ""),
        sample.name + ": the message says what is wrong (got " + JSON.stringify(errors[0]?.message) + ")");
      assert(neverCalled.calls.length === 0, sample.name + ": no provider call was made");
      assert(!events.some((e) => e.type === "done"), sample.name + ": the run did not report a finished turn");
      assert(Buffer.compare(readFileSync(path), damaged) === 0, sample.name + ": the record is byte-for-byte unchanged");
      assert(readdirSync(piDir).filter((f) => f.endsWith(".jsonl")).length === recordCountBefore,
        sample.name + ": no fresh conversation was created under that handle");
    }

    // ---------- R5: a missing record is still its own answer ----------
    {
      const session = await store.createSession("chat");
      const neverCalled = provider("MUST-NOT-ANSWER");
      const events = await drain(new PiAgentRuntime({
        retriever: new NoopRetriever() as any,
        domain, model, streamFn: neverCalled.fn as any,
        store, sessionId: session.id, piSessionDir: piDir,
        requirePiSessionRecord: true,
        getApiKey: async () => "probe-key",
      }).run("NO-RECORD-QUESTION"));
      const errors = events.filter((e) => e.type === "error");
      assert(errors.length === 1 && /找不到这段会话的对话记录/.test(errors[0]?.message ?? ""),
        "R5: a required record that does not exist is refused in words (got " + JSON.stringify(errors) + ")");
      assert(neverCalled.calls.length === 0, "R5: nothing was sent to the provider");
    }
  } finally {
    try { store.close?.(); } catch { /* already closed */ }
    try { rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\nPI session strict-resume tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("PI session strict-resume test threw:", e);
  process.exit(1);
});
