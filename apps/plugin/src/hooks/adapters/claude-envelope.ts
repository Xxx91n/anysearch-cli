// Claude Code PreToolUse return value: the host's key names in one place.
//
// Design: the PreToolUse return value is built by one typed function with its
// own test — the host drops a key it does not know without an error, so a wrong
// name has to fail at typecheck or in the test, not silently in the host.

import type { HookDecision } from "../core.js";

type PreToolUseOutput = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    /** Rewritten tool arguments; replaces the whole input object. */
    updatedInput?: Record<string, unknown>;
    additionalContext?: string;
    permissionDecision?: HookDecision["permission"];
    permissionDecisionReason?: string;
  };
};

/** What the adapter prints for PreToolUse, or null when the decision says nothing. */
export function claudePreToolUseOutput(decision: HookDecision): PreToolUseOutput | null {
  const hookSpecificOutput: PreToolUseOutput["hookSpecificOutput"] = { hookEventName: "PreToolUse" };
  if (decision.additionalContext) hookSpecificOutput.additionalContext = decision.additionalContext;
  if (decision.updatedInput) hookSpecificOutput.updatedInput = decision.updatedInput;
  if (decision.permission) {
    hookSpecificOutput.permissionDecision = decision.permission;
    if (decision.permissionReason) hookSpecificOutput.permissionDecisionReason = decision.permissionReason;
  }
  return Object.keys(hookSpecificOutput).length > 1 ? { hookSpecificOutput } : null;
}
