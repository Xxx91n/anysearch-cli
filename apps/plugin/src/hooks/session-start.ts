// SessionStart hook: inject static routing card at session start.
// ADR-0010 D2: Progressive Disclosure Three-Layer — this is the lightest layer.
// ~20 lines / 150-400 token routing card injected as additionalContext.
// Cross-platform: Claude/Codex have SessionStart; Cursor falls back to rules file.

// Static routing card — inject at session start, never changes.
const ROUTING_CARD = [
  "[anysearch plugin active]",
  "Tools available (ans_* prefix):",
  "- search_web: real-time multi-source web search",
  "- research_web: deep research (minute-level, multi-hop)",
  "- recall_memory: FTS5 research memory recall (time edge effect)",
  "- query_knowledge: enterprise RAG retrieval",
  "- ans_chat: PiAgentRuntime agent loop for complex queries",
  "",
  "Trigger rules:",
  "- Current events / factual lookup -> search_web",
  "- Multi-step research / synthesis -> research_web",
  "- Recall prior results from this session -> recall_memory",
  "- Enterprise knowledge base -> query_knowledge",
  "- Complex multi-tool research -> ans_chat",
  "- Skip redundant search if recall_memory already has relevant results",
  "",
  "Fail-open: if anysearch server is down, tools degrade gracefully (no block).",
  "For detailed guidance: see SKILL.md (anysearch skill).",
].join("\n");

interface SessionStartStdin {
  event?: string;
  cwd?: string;
  session_id?: string;
}

async function main(): Promise<void> {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  let stdin: SessionStartStdin;
  try { stdin = JSON.parse(input); }
  catch { process.exit(0); }

  // Only handle SessionStart event.
  if (stdin.event !== "SessionStart" && stdin.event !== "session_start" && stdin.event !== "sessionStart") {
    process.exit(0);
  }

  // Output routing card as additionalContext for the host agent.
  // Claude format: { additionalContext: "..." }
  // Codex format: { additionalContext: "..." }
  process.stdout.write(JSON.stringify({ additionalContext: ROUTING_CARD }));
  process.exit(0);
}

main();
