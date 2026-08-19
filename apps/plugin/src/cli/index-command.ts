// ans index — CLI subcommand to manually index entries to project index.
// ADR-0009 Decision 4: hooks write project index via server IPC or CLI.
// Usage: ans index --title "..." --url "..." --snippet "..." --source "..."
//        echo '{"results":[...]}' | ans index --stdin

import { ProjectIndexStore } from "../store/project-index-store.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";

export async function runIndex(args: string[]): Promise<number> {
  const dbPath = process.env.ANS_PROJECT_DB || join(process.cwd(), ".anysearch", "project-index.db");
  const projectPath = process.cwd();

  mkdirSync(dirname(dbPath), { recursive: true });
  const store = new ProjectIndexStore(dbPath);

  // Parse args.
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
  const dbPath = process.env.ANS_PROJECT_DB || join(process.cwd(), ".anysearch", "project-index.db");
  const store = new ProjectIndexStore(dbPath);

  const query = args[0] || "";
  if (!query) {
    process.stderr.write("ans recall: query required\n");
    store.close();
    return 1;
  }

  const hits = store.search(query, 10);
  store.close();
  process.stdout.write(JSON.stringify({ query, hits, provenance: "project-index" }, null, 2) + "\n");
  return 0;
}
