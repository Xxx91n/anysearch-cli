// ans recommend: suggest a domain for a free-text task (#110; parent #31; T6 decision #92).
// Retrieval-style recommender: user free text → BM25 (FTS5) over domain metadata
// (name+description) → top-3 + confidence → high confidence suggests `ans domain <id>`,
// low confidence lists candidates for manual choice. NEVER auto-switches — this command
// only prints; persistence stays with `ans domain <name>` (abstain is a normal result here too).
// Embedding arm is peer-optional: without the package the engine degrades to FTS-only.

import { join } from "node:path";
import { listDomainTomls, loadDomain, recommendDomains, type DomainMeta } from "@anysearch-cli/store";
import { domainSearchDirs } from "../db";
import { formatRecommendText, formatRecommendJson, recommendExitCode } from "./recommend-format";

export async function runRecommend(args: string[]): Promise<number> {
  const isJson = args.includes("--json");
  const query = args.filter((a) => a !== "--json").join(" ").trim();
  if (!query) {
    process.stderr.write("ans recommend <free-text task description> [--json]\n");
    return 2;
  }

  // Domain metadata = name+description of every discoverable <name>.toml on the
  // resolution chain (same lister as `ans domain`). Each candidate goes through the
  // SAME validating loader the switch command uses (loadDomain = resolve+validate),
  // so `ans recommend` never suggests a domain that `ans domain <id>` would persist
  // and then resolve to silent full-fanout. Domains failing load are skipped
  // fail-open — a broken domain must not veto recommendations for the rest.
  const metas: DomainMeta[] = [];
  for (const [file, dir] of listDomainTomls(domainSearchDirs())) {
    const id = file.replace(/\.toml$/, "");
    try {
      const schema = loadDomain(join(dir, file));
      metas.push({ id, name: schema.name ?? id, description: schema.description ?? "" });
    } catch {
      // skip tomls the switch command's loader cannot resolve/validate
    }
  }

  const result = await recommendDomains(query, metas);
  if (isJson) {
    process.stdout.write(formatRecommendJson(result) + "\n");
  } else {
    console.log(formatRecommendText(result));
  }
  return recommendExitCode(result);
}
