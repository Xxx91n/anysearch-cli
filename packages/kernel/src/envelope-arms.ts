// The three arm lists every fanout writes, read by the CLI and both web tools.
// A host that implements RetrieverPort itself can leave one out, and an absent
// list is not neutral: `failed: []` reads as "no arm failed", so a total outage
// would come back as a success naming no failed providers, and `cancelled: []`
// would clear `partial`. Name the missing field(s) and fail the call.
export interface EnvelopeArmLists {
  queried: string[];
  cancelled: string[];
  failed: string[];
}

export function envelopeArmLists(metadata: unknown): EnvelopeArmLists {
  const meta = metadata as {
    providersQueried?: unknown;
    providersCancelled?: unknown;
    providersFailed?: unknown;
  } | undefined;
  const missing: string[] = [];
  if (!Array.isArray(meta?.providersQueried)) missing.push("providersQueried");
  if (!Array.isArray(meta?.providersCancelled)) missing.push("providersCancelled");
  if (!Array.isArray(meta?.providersFailed)) missing.push("providersFailed");
  if (missing.length > 0) throw new Error("retriever envelope metadata missing " + missing.join(", "));
  const lists = meta as { providersQueried: string[]; providersCancelled: string[]; providersFailed: string[] };
  return { queried: lists.providersQueried, cancelled: lists.providersCancelled, failed: lists.providersFailed };
}
