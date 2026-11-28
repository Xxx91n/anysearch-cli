// The three arm lists every fanout writes, read by the CLI and both web tools.
// docs/mcp-server.md states the contract for host implementers.
import type { FusedEnvelope } from "@anysearch-cli/retriever";

export interface EnvelopeArmLists {
  queried: string[];
  cancelled: string[];
  failed: string[];
}

// The envelope keys in one place, typed from the contract: a renamed field fails
// to compile here instead of reading every envelope as "missing" at run time.
const ARM_FIELDS = ["providersQueried", "providersCancelled", "providersFailed"] as const;
type ArmField = (typeof ARM_FIELDS)[number];
type ArmMeta = Pick<FusedEnvelope["metadata"], ArmField>;

// An absent list is not neutral: `failed: []` reads as "no arm failed", so a
// total outage would come back as a success naming no failed providers, and
// `cancelled: []` would clear `partial`. Name the missing field(s) and fail.
export function envelopeArmLists(metadata: unknown): EnvelopeArmLists {
  const probe = metadata as Partial<ArmMeta> | undefined;
  const missing = ARM_FIELDS.filter((field) => !Array.isArray(probe?.[field]));
  if (missing.length > 0) throw new Error("retriever envelope metadata missing " + missing.join(", "));
  const lists = metadata as ArmMeta;
  return { queried: lists.providersQueried, cancelled: lists.providersCancelled, failed: lists.providersFailed };
}
