// Claude Code PreToolUse return value: the host's key names, built in one place.
//
// Design: a pure function with its own test, not three lines inside the
// adapter's main flow — the host drops a key it does not know without an error,
// so a typo here is a silent no-op. The return type spells the keys out (a
// wrong name is a type error) and claude-envelope.test.ts pins the JSON the
// host actually reads. The keys are the hooks reference's PreToolUse decision
// control: additionalContext, updatedInput, permissionDecision,
// permissionDecisionReason, all inside hookSpecificOutput with hookEventName.

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
