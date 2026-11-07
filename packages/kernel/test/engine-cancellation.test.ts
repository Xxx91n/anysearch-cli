// #209 — engine caller cancellation seam.
//
//   - A mock provider receives an ALREADY-ABORTED signal when the caller was
//     cancelled before the search started (the pre-abort acceptance case).
//   - A non-pre-aborted caller aborts mid-flight: the provider's signal flips
//     to aborted and the fanout wait ends without waiting for the straggler;
//     an arm still unsettled when the wait ends is reported as
//     providersCancelled (never providersFailed).
//   - Cancellation suppresses the post-search sufficiency anchor write.
//
// No test framework (repo convention: assert-based, run via `node --import tsx
// --test`). No network.

import { RetroaererdEngine } from "../src/engine";
import type { SearchProvider, SearchRequest, ProviderEnvelope, FusedEnvelope } from "@anysearch-cli/retriever";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("FAIL: " + msg);
  }
}

const emptyEnvelope = (provider: string): ProviderEnvelope => ({
  provider,
  results: [],
  answers: [],
  elapsedMs: 1,
});

function makeEngine(recorder: {
  signals: AbortSignal[];
  abortedAtCall: boolean[];
  anchors: unknown[];
}) {
  let startedResolve: () => void = () => { };
  const started = new Promise<void>((r) => { startedResolve = r; });
  const provider: SearchProvider = {
    id: "slow",
    modes: ["fast"],
    async search(_req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope> {
      recorder.signals.push(signal);
      recorder.abortedAtCall.push(signal.aborted);
      startedResolve();
      if (signal.aborted) {
        // The pre-aborted case: the provider observes the cancelled signal and
        // never settles, mimicking an upstream call that was never started.
        return new Promise<ProviderEnvelope>(() => { });
      }
      return new Promise<ProviderEnvelope>((resolve) => {
        signal.addEventListener("abort", () => resolve(emptyEnvelope("slow")), { once: true });
      });
    },
  };
  const engine = new RetroaererdEngine([provider], {
    sessionId: "cancel-session",
    anchors: {
      saveAnchor: async (_sessionId, _type, payload) => {
        recorder.anchors.push(payload);
      },
    },
  });
  return { engine, started };
}

async function main() {
  // 1. Pre-aborted caller: every provider sees signal.aborted at call time.
  {
    const recorder = { signals: [] as AbortSignal[], abortedAtCall: [] as boolean[], anchors: [] as unknown[] };
    const { engine } = makeEngine(recorder);
    const caller = new AbortController();
    caller.abort("cancelled before start");

    const result: FusedEnvelope = await engine.search({ query: "pre-aborted", mode: "fast", signal: caller.signal });
    assert(recorder.signals.length === 1, "1: provider was invoked once");
    assert(recorder.abortedAtCall[0] === true, "1: provider received an already-aborted signal at call time");
    assert(result.metadata.providersQueried.includes("slow"), "1: provider still counted as queried");
    assert(result.metadata.providersCancelled.includes("slow"), "1: pre-aborted arm is cancelled, not failed");
    assert(result.metadata.providersFailed.length === 0, "1: cancellation does not become providersFailed");
    assert(recorder.anchors.length === 0, "1: pre-aborted search writes no sufficiency anchor");
  }

  // 2. In-flight caller abort: the provider signal aborts, the wait ends, the
  //    straggler is cancelled, and no anchor is written after cancellation.
  {
    const recorder = { signals: [] as AbortSignal[], abortedAtCall: [] as boolean[], anchors: [] as unknown[] };
    const { engine, started } = makeEngine(recorder);
    const caller = new AbortController();

    const search = engine.search({ query: "mid-flight", mode: "fast", signal: caller.signal });
    await started;
    assert(recorder.signals[0].aborted === false, "2: provider signal is live while the search is in flight");
    caller.abort("client cancelled");

    const result: FusedEnvelope = await search;
    assert(recorder.signals[0].aborted === true, "2: caller abort reaches the per-provider signal");
    assert(result.metadata.providersFailed.length === 0, "2: cancellation is not a provider failure");
    assert(recorder.anchors.length === 0, "2: cancelled search writes no sufficiency anchor");
  }

  // 3. Control: the same engine/search shape without a caller signal writes the
  //    anchor, so case 1/2 prove cancellation (not a broken anchor port).
  {
    const recorder = { signals: [] as AbortSignal[], abortedAtCall: [] as boolean[], anchors: [] as unknown[] };
    const provider: SearchProvider = {
      id: "fast",
      modes: ["fast"],
      async search(): Promise<ProviderEnvelope> {
        return { provider: "fast", results: [{ url: "https://example.com/a", title: "A", snippet: "s", source: "fast" }], answers: [], elapsedMs: 1 };
      },
    };
    const engine = new RetroaererdEngine([provider], {
      sessionId: "cancel-session",
      anchors: { saveAnchor: async (_sid, _type, payload) => { recorder.anchors.push(payload); } },
    });
    await engine.search({ query: "control", mode: "fast" });
    assert(recorder.anchors.length === 1, "3: uncancelled search still writes its anchor");
  }

  // 4. A provider whose promise rejects because of our abort stays cancelled:
  //    its rejection must not be reported as providersFailed.
  {
    const recorder = { signals: [] as AbortSignal[], abortedAtCall: [] as boolean[], anchors: [] as unknown[] };
    let startedResolve: () => void = () => { };
    const started = new Promise<void>((r) => { startedResolve = r; });
    const provider: SearchProvider = {
      id: "rejects",
      modes: ["fast"],
      async search(_req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope> {
        recorder.signals.push(signal);
        recorder.abortedAtCall.push(signal.aborted);
        startedResolve();
        return new Promise<ProviderEnvelope>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted by caller")), { once: true });
        });
      },
    };
    const engine = new RetroaererdEngine([provider], {
      sessionId: "cancel-session",
      anchors: { saveAnchor: async (_sid, _type, payload) => { recorder.anchors.push(payload); } },
    });
    const caller = new AbortController();
    const search = engine.search({ query: "reject-on-abort", mode: "fast", signal: caller.signal });
    await started;
    caller.abort("cancelled");
    const result = await search;
    assert(result.metadata.providersFailed.length === 0, "4: abort-induced rejection is not a provider failure");
    assert(result.metadata.providersCancelled.includes("rejects"), "4: abort-induced rejection is classified cancelled");
    assert(recorder.anchors.length === 0, "4: rejected-and-cancelled search writes no anchor");
  }

  console.log("--- engine cancellation tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
