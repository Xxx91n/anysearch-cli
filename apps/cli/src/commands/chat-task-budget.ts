// #302 — the per-execution task budget `ans chat` bills to.
//
// #303 moved the decision itself into the kernel (`wireTaskBudget`), because the
// MCP `ans_chat` tool bills the same way and a second copy of the three states
// (undeclared / established / declared-but-failed) is how the two entries would
// drift apart. This module keeps the CLI's names so `chat.ts` and its tests read
// unchanged; the states, the degradation rules and the fault text live there.
//
// Run from tests: pnpm --filter @anysearch-cli/cli test

export {
  wireTaskBudget as wireChatTaskBudget,
  type TaskBudgetWiring as ChatTaskBudgetWiring,
} from "@anysearch-cli/kernel";
