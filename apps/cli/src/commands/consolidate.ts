// ans consolidate - episodic-to-semantic consolidation (ADR-0037 D2/D4, Phase-3 CLI).
// LLM summarize seam is assembled here via kernel createLlmSession; fidelity gate via
// kernel classifyClaim. Fail-open: missing LLM config -> dry-run with llmUnavailable counts.

import { createLlmSession, classifyClaim, resolveDbPath } from "@anysearch/kernel";
import { SqliteSessionStore, type ConsolidateEvidence, type ConsolidateClaimVerdict } from "@anysearch/store";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

interface ConsolidateStore {
  consolidateMemory(opts?: { dryRun?: boolean; limit?: number }): Promise<{
    dryRun: boolean; clustersScanned: number; clustersTriggered: number;
    llmUnavailable: number; gateRejected: number; add: number; noop: number; update: number;
    semanticIds: number[];
  }>;
}

function help(): string {
  return [
    "ans consolidate - episodic->semantic consolidation (ADR-0037)",
    "",
    "Usage: ans consolidate [--dry-run|--apply] [--limit N]",
    "",
    "Episodes are clustered by entity; clusters meeting the deterministic trigger are summarized",
    "through the configured LLM (ANS_LLM_PROVIDER/MODEL, optional ANS_LLM_BASE_URL+ANS_LLM_API),",
    "gated per-claim against source evidence, then written to semantic_memories (RRF sixth arm).",
    "--dry-run runs inside a rolled-back transaction (exact prediction, no writes). Default: --apply.",
    "Without an LLM configured the run reports llmUnavailable clusters and writes nothing (exit 1).",
    "",
  ].join("\n");
}

export async function runConsolidate(args: string[]): Promise<number> {
  const cmd = args[0];
  if (cmd === "--help" || cmd === "-h") { process.stdout.write(help()); return 0; }
  // r94 audit A6 (Pascal P3): reject unknown flags instead of silently running --apply.
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--limit") { i++; continue; }
    if (a !== "--dry-run" && a !== "--apply") {
      process.stderr.write("ans consolidate: unknown flag " + a + "\n");
      return 2;
    }
  }
  const dryRun = args.includes("--dry-run");
  const li = args.indexOf("--limit");
  const limit = li >= 0 ? Number(args[li + 1]) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    process.stderr.write("ans consolidate: --limit must be a positive integer\n");
    return 2;
  }

  // LLM summarize seam (fail-open when unconfigured).
  const providerName = process.env.ANS_LLM_PROVIDER;
  const modelName = process.env.ANS_LLM_MODEL;
  const baseUrl = process.env.ANS_LLM_BASE_URL;
  const apiRaw = process.env.ANS_LLM_API;
  const api = apiRaw === "chat" || apiRaw === "messages" || apiRaw === "responses" ? apiRaw : undefined;
  if (baseUrl && !api) {
    process.stderr.write("ANS_LLM_BASE_URL requires ANS_LLM_API=chat|messages|responses\n");
    return 3;
  }

  let summarize: ((episodes: ConsolidateEvidence[]) => Promise<string | null>) | undefined;
  if (providerName && modelName) {
    try {
      const session = await createLlmSession({
        provider: providerName, model: modelName, baseUrl, api,
        apiKey: baseUrl ? process.env.ANS_LLM_API_KEY : undefined,
      });
      summarize = async (episodes) => {
        const prompt = [
          "Summarize these episodic memories about the same entity into one short, factual paragraph.",
          "Only state facts directly supported by the episodes. No speculation.",
          ...episodes.map((e, i) => "[" + (i + 1) + "] " + e.title + " - " + e.snippet + " (" + e.url + ")"),
        ].join("\n");
        const stream = session.streamFn(session.model, { messages: [{ role: "user", content: prompt }] } as never, { apiKey: session.apiKey } as never);
        let out = "";
        for await (const ev of stream as AsyncIterable<{ type: string; delta?: string; content?: string }>) {
          if (ev.type === "text_delta") out += ev.delta ?? "";
          else if (ev.type === "text") out += ev.content ?? "";
        }
        return out.trim() || null;
      };
    } catch (e) {
      process.stderr.write("[warn] LLM init failed (" + (e as Error).message + "); clusters will report llmUnavailable\n");
    }
  } else {
    process.stderr.write("[warn] ANS_LLM_PROVIDER/ANS_LLM_MODEL not set; consolidation will report llmUnavailable\n");
  }

  // Fidelity gate adapter: kernel classifyClaim -> store verdict shape.
  const classify = (claim: string, evidence: ConsolidateEvidence[]): ConsolidateClaimVerdict => {
    const r = classifyClaim(claim, {
      retrievalResults: evidence.map((e) => ({ title: e.title, snippet: e.snippet, url: e.url }) as never),
    });
    return { label: r.label, confidence: r.confidence };
  };

  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = new SqliteSessionStore(dbPath, { consolidateSummarize: summarize, consolidateClassify: classify });

  const r = await store.consolidateMemory({ dryRun, limit });
  process.stdout.write(
    "consolidate" + (dryRun ? " (dry-run)" : "") +
      ": scanned " + r.clustersScanned + " cluster(s), triggered " + r.clustersTriggered +
      ", llmUnavailable " + r.llmUnavailable + ", gateRejected " + r.gateRejected +
      ", add " + r.add + ", noop " + r.noop + ", update " + r.update + "\n",
  );
  if (r.semanticIds.length > 0) {
    process.stdout.write("semantic ids: " + r.semanticIds.join(", ") + "\n");
  }
  return r.llmUnavailable > 0 && r.add === 0 && r.update === 0 ? 1 : 0;
}
