import { FUSION_REGISTRY, rrfScores } from "@anysearch-cli/retriever";

interface KnowledgeCandidate {
  rowid: number;
  content: string;
}

// Script is a cheap language hint, not a language detector. In a mixed query,
// non-Latin words carry the preference; a Latin company name must not erase it.
// Languages sharing a script remain tied. URLs and email addresses are not prose.
const SCRIPTS = [
  /\p{Script=Han}/u, /\p{Script=Cyrillic}/u, /\p{Script=Arabic}/u,
  /\p{Script=Hangul}/u, /[\p{Script=Hiragana}\p{Script=Katakana}]/u,
  /\p{Script=Devanagari}/u, /\p{Script=Latin}/u,
];
function prose(text: string): string {
  return text.replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+/giu, "");
}

export function rankKnowledge<T extends KnowledgeCandidate>(query: string, lanes: readonly T[][]): T[] {
  const active = lanes.filter((lane) => lane.length > 0);
  const byId = new Map(active.flat().map((hit) => [String(hit.rowid), hit]));
  const scores = rrfScores(active.map((lane) => lane.map((hit) => String(hit.rowid))), FUSION_REGISTRY.k_fusion.memory);
  const preference = SCRIPTS.find((script) => script.test(prose(query)));
  const boost = new Map([...byId].map(([id, hit]) => [id, preference?.test(prose(hit.content)) ? 1 : 0]));
  // Design: relevance first, language boost only at equal RRF score (#283).
  // Adding a numeric language weight would let it outrank stronger evidence.
  return [...scores].sort((a, b) => b[1] - a[1] || boost.get(b[0])! - boost.get(a[0])!)
    .map(([id]) => byId.get(id)!);
}
