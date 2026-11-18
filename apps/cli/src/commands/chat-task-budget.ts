// #302 — the per-execution task budget `ans chat` bills to.
//
// #303: the decision itself now lives in the kernel (`wireTaskBudget`), because
// the MCP `ans_chat` tool bills the same way and a second copy of these three
// states is exactly how the two entries would drift apart. This module keeps
// the CLI's names so `chat.ts` and its tests read unchanged.
//
// The three states S9 keeps apart, decided in the kernel:
// - undeclared (domain has no [budget]): no task_budgets row, caps not
//   enforced — unmetered, same as an undeclared session.
// - established: the row is created with the declared caps; the runtime
//   enforces them on this execution's own budget.
// - declared but failed (no registered task, or row creation threw): a fault,
//   and the runtime stops the run before any controlled call.
//
// Degradation, said plainly: when NO task was registered (broken registry)
// or the store lacks the seam, an UNDECLARED domain returns an empty wiring
// and the run falls back to the session form — the same shape every
// unmigrated caller still runs, not a hidden guarantee. A DECLARED domain
// in the same corner returns a fault and stops instead.
//
// Run from tests: pnpm --filter @anysearch-cli/cli test

export {
  wireTaskBudget as wireChatTaskBudget,
  type TaskBudgetWiring as ChatTaskBudgetWiring,
} from "@anysearch-cli/kernel";
