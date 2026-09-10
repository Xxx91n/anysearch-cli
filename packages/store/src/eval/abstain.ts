// ADR-0054 D2/D3: behavioral abstain smoke — observational only, never gates.
// Three-tier verdict, cheapest first:
//   tier 1 "chain"   — access-chain trace shows zero retrieved evidence (chain_empty family)
//   tier 2 "regex"   — refusal-keyword match on the assistant response (prompt field)
//   tier 3 "llm"     — async judge sampling; any failure degrades to llm_fallback of tier 2
// The LLM judge is observational-only and never called in the golden eval (no judgeFn wired).

export type AbstainFamily = "chain_empty" | "refusal_keyword" | "answered";
export type AbstainTier = "chain" | "regex" | "llm" | "llm_fallback";

export interface AbstainProbeInput {
  family: AbstainFamily;
  prompt: string;
  judgeFn?: (prompt: string) => Promise<boolean | undefined>;
}

export interface AbstainVerdict {
  abstain: boolean;
  tier: AbstainTier;
  detail: string;
}

const REFUSAL_RE =
  /(?:无法回答|无法确定|无法确认|暂无(?:可靠)?(?:证据|信息)|没有足够(?:的)?(?:证据|信息))|(?:insufficient evidence|cannot answer|can'?t answer|not enough (?:information|evidence)|I don'?t know|no reliable sources)/i;

export async function runAbstainProbe(input: AbstainProbeInput): Promise<AbstainVerdict> {
  // Tier 1: access-chain trace — no retrieved evidence at all forces abstain.
  if (input.family === "chain_empty") {
    return { abstain: true, tier: "chain", detail: "access-chain trace: zero retrieved evidence" };
  }
  // Tier 2: refusal-keyword regex.
  const refused = REFUSAL_RE.test(input.prompt);
  const tier2: AbstainVerdict = {
    abstain: refused,
    tier: "regex",
    detail: refused ? "refusal-keyword match" : "no refusal keyword",
  };
  if (!input.judgeFn) return tier2;
  // Tier 3: async LLM judge sampling; any failure falls back to tier 2 (llm_fallback).
  try {
    const judged = await input.judgeFn(input.prompt);
    if (typeof judged === "boolean") {
      return { abstain: judged, tier: "llm", detail: "llm judge verdict (sampling)" };
    }
  } catch { /* fall through */ }
  return { ...tier2, tier: "llm_fallback", detail: tier2.detail + " (llm_fallback)" };
}
