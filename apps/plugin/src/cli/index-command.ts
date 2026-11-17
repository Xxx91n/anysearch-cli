// ans index — CLI subcommand to manually index entries to project index.
// hooks write project index via server IPC or CLI.
// Usage: ans index --title "..." --url "..." --snippet "..." --source "..."
// echo '{"results":[...]}' | ans index --stdin
//
// The rows land in the same user-level database the hook server uses, and the
// project comes from the explicit project this command runs in. Without a
// project identity the command stops and says so; it never writes into a
// shared bucket or reads another project's records.

import { ProjectIndexStore } from "../store/project-index-store.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveProjectContext } from "@anysearch-cli/store";
import { projectIndexDbPath } from "../server/token.js";

function requireProject(): string | null {
  const project = resolveProjectContext();
  if (!("reason" in project)) return project.root;
  process.stderr.write(
    "项目身份不明确：" + project.reason +
    " 请从项目根目录运行，或在项目里加 .anysearch/config.toml。\n",
  );
  return null;
}

export async function runIndex(args: string[]): Promise<number> {
  // Parse first: --help must work outside a project.
  let title = "", url = "", snippet = "", source = "cli", stdinMode = false;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--title": title = args[++i] || ""; break;
      case "--url": url = args[++i] || ""; break;
      case "--snippet": snippet = args[++i] || ""; break;
      case "--source": source = args[++i] || "cli"; break;
      case "--stdin": stdinMode = true; break;
      case "--help": case "-h":
        process.stdout.write("Usage: ans index --title T --url U --snippet S [--source SRC] [--stdin]\n");
        return 0;
    }
  }

  const projectPath = requireProject();
  if (!projectPath) return 2;
  const dbPath = projectIndexDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = new ProjectIndexStore(dbPath);

  let indexed = 0;
  if (stdinMode) {
    // Read JSON from stdin with results array.
    const input = readFileSync(0, "utf8");
    try {
      const parsed = JSON.parse(input);
      const results = Array.isArray(parsed.results) ? parsed.results : (Array.isArray(parsed) ? parsed : []);
      for (const r of results) {
        store.indexEntry({
          projectPath,
          toolName: "ans-index",
          title: r.title || "",
          url: r.url || "",
          snippet: (r.snippet || "").slice(0, 500),
          source: r.source || "cli",
          contentHash: createHash("sha256").update((r.url || "") + (r.title || "")).digest("hex").slice(0, 16),
        });
        indexed++;
      }
    } catch (e) {
      process.stderr.write("ans index: failed to parse stdin JSON: " + (e instanceof Error ? e.message : String(e)) + "\n");
      store.close();
      return 1;
    }
  } else {
    if (!url && !title) {
      process.stderr.write("ans index: --url or --title required (or use --stdin)\n");
      store.close();
      return 1;
    }
    store.indexEntry({
      projectPath,
      toolName: "ans-index",
      title, url, snippet, source,
      contentHash: createHash("sha256").update(url + title).digest("hex").slice(0, 16),
    });
    indexed = 1;
  }

  store.close();
  process.stdout.write("Indexed " + indexed + " entr" + (indexed === 1 ? "y" : "ies") + " to project index.\n");
  return 0;
}

export async function runRecall(args: string[]): Promise<number> {
  const projectPath = requireProject();
  if (!projectPath) return 2;
  const store = new ProjectIndexStore(projectIndexDbPath());

  const query = args[0] || "";
  if (!query) {
    process.stderr.write("ans recall: query required\n");
    store.close();
    return 1;
  }

  const hits = store.search(query, [projectPath], 10);
  store.close();
  process.stdout.write(JSON.stringify({ query, hits, provenance: "project-index", projects: [projectPath] }, null, 2) + "\n");
  return 0;
}
