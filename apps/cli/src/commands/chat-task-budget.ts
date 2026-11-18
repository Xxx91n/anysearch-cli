// The CLI's name for the shared per-execution task-budget decision: `ans chat`
// and the MCP `ans_chat` tool must not answer "was this run metered?"
// differently, so the implementation lives in the kernel
// (`packages/kernel/src/task-budget.ts`). Covered by
// `apps/cli/test/chat-task-wiring.test.ts`, which drives this re-export.

export {
  wireTaskBudget as wireChatTaskBudget,
  type TaskBudgetWiring as ChatTaskBudgetWiring,
} from "@anysearch-cli/kernel";
