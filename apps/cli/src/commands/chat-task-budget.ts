// #302 — the per-execution task budget `ans chat` bills to.
//
// #303 moved the decision into the kernel (`wireTaskBudget`), so the CLI and the
// MCP `ans_chat` tool cannot answer "was this run metered?" differently. This
// module keeps the CLI's name; the states, the degradation rules and the fault
// text live in `packages/kernel/src/task-budget.ts`.
//
// Run from tests: pnpm --filter @anysearch-cli/cli test

export { wireTaskBudget as wireChatTaskBudget } from "@anysearch-cli/kernel";
