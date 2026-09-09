import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SqliteObservationStore,
  OBSERVATION_TESTED_WITH,
  SEMCONV_GENAI_COMMIT,
} from "../src/observation";

const dir = mkdtempSync(join(tmpdir(), "ans-observation-"));
const store = new SqliteObservationStore(join(dir, "trace.db"));

try {
  const runId = "demo-run";
  const value = await store.recordOperation(
    {
      runId,
      kind: "retrieve",
      operation: "demo.retrieve",
      attributes: {
        "anysearch.provider": "exa",
        "anysearch.model": "demo",
        "anysearch.output_tokens": 3,
        "gen_ai.system": "must-not-claim",
      },
    },
    async (span) => {
      span.addEvent("anysearch.search.started", { "anysearch.mode": "fast" });
      return 7;
    },
  );
  assert.equal(value, 7);

  const trace = store.getTrace(runId);
  assert.ok(trace);
  assert.equal(trace.semconvPin, SEMCONV_GENAI_COMMIT);
  assert.equal(trace.spans.length, 1);
  assert.equal(trace.spans[0]!.attributes["anysearch.provider"], "exa");
  assert.equal(trace.spans[0]!.attributes["gen_ai.system"], undefined);
  assert.equal(trace.spans[0]!.events[0]!.name, "anysearch.search.started");

  // runId replay is idempotent.
  await store.recordOperation(
    { runId, kind: "retrieve", operation: "demo.retrieve.replay" },
    async () => 8,
  );
  const replay = store.getTrace(runId);
  assert.equal(replay?.operation, "demo.retrieve");

  const otlp = store.exportOtlp(runId);
  assert.ok(otlp);
  const resourceSpans = (otlp as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ attributes: Array<{ key: string }> }> }> }> }).resourceSpans;
  const attributes = resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes.map((item) => item.key);
  assert.ok(attributes.includes("gen_ai.provider.name"));
  assert.ok(attributes.includes("gen_ai.system"));
  assert.ok(attributes.includes("gen_ai.usage.output_tokens"));
  assert.ok(attributes.includes("anysearch.provider"));

  const evalRunId = "demo-eval";
  store.recordEvaluationTrace({
    runId: evalRunId,
    name: "memory-eval",
    evaluation: { name: "memory-eval", scoreValue: 1, scoreLabel: "pass" },
    scores: [{ rubricItem: "passRate", value: 1 }],
    attributes: { "eval.datasetFingerprint": "0123456789abcdef" },
  });
  const evalTrace = store.getTrace(evalRunId);
  assert.ok(evalTrace);
  assert.equal(evalTrace.evaluations[0]!.name, "memory-eval");
  const evalOtlp = store.exportOtlp(evalRunId) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ events: Array<{ name: string }> }> }> }> };
  assert.equal(evalOtlp.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.events[0]!.name, "gen_ai.evaluation.result");

  assert.equal(OBSERVATION_TESTED_WITH.length, 4);
  console.log("observation trace/eval round-trip: OK");
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
