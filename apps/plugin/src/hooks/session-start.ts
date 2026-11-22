// SessionStart hook: inject static routing card at session start.
// It only puts the ~150-400 token routing card into the context, once per
// session; nothing here runs again during the session.
// do NOT modify host AGENTS.md, inject via hook output only.
// This bin serves Claude and Codex SessionStart; CodeBuddy registers SessionStart
// through its own adapter, and Antigravity has none and writes its .mdc fallback
// from its own adapter.

// routing card imported from shared routing-card.ts module.
import { DEFAULT_ROUTING_CARD as ROUTING_CARD } from "./routing-card.js";

interface SessionStartStdin {
  // real hosts inject hook_event_name; event kept as legacy fallback.
  hook_event_name?: string;
  event?: string;
}

async function main(): Promise<void> {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  let stdin: SessionStartStdin;
  try { stdin = JSON.parse(input); }
  catch { process.exit(0); }

  // Only handle SessionStart event.
  const event = stdin.hook_event_name ?? stdin.event;
  if (event !== "SessionStart" && event !== "session_start" && event !== "sessionStart") {
    process.exit(0);
  }

  // Output routing card as additionalContext for the host agent.
  // `configs/claude/hooks.json`, `configs/codex/hooks.json` and
  // `hooks/hooks.json` pass `--envelope`: Claude Code drops bare top-level keys,
  // and Codex mostly drops the bare form. Without the flag the bin prints bare
  // additionalContext, which is what a host wired by hand gets.
  if (process.argv.includes("--envelope")) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: ROUTING_CARD,
      },
    }));
  } else {
    process.stdout.write(JSON.stringify({ additionalContext: ROUTING_CARD }));
  }
  process.exit(0);
}

main();
