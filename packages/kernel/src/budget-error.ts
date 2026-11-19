// #304: a typed refusal from the retrieval path's per-call budget.
//
// The engine has always refused a search whose reservation does not fit
// ("Budget exceeded: ..."), but as a plain Error. The CLI and the MCP search
// tools need to tell that refusal apart from an upstream outage without
// parsing prose, so the stop is a named class carrying the same machine code
// the agent runtime already emits ("budget-rejected").
//
// Design: a typed class instead of matching message text — the message stays
// byte-identical on purpose, so existing logs and assertions keep the wording
// they had while hosts branch on the type.

export class TaskBudgetRejectedError extends Error {
  readonly reason = "budget-rejected" as const;
  constructor(message: string) {
    super(message);
    this.name = "TaskBudgetRejectedError";
  }
}

/**
 * True for the budget refusal above, including a copy rebuilt across a module
 * boundary (a bundled host and a source-run test can each hold their own class
 * object). Matches on the name and the reason, not on `instanceof` alone.
 */
export function isTaskBudgetRejectedError(e: unknown): e is TaskBudgetRejectedError {
  if (e instanceof TaskBudgetRejectedError) return true;
  if (typeof e !== "object" || e === null) return false;
  const candidate = e as { name?: unknown; reason?: unknown };
  return candidate.name === "TaskBudgetRejectedError" && candidate.reason === "budget-rejected";
}
