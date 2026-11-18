// 转发到内核：CLI 和 MCP 共用同一份判断。测试见 test/chat-task-wiring.test.ts。

export {
  wireTaskBudget as wireChatTaskBudget,
  type TaskBudgetWiring as ChatTaskBudgetWiring,
} from "@anysearch-cli/kernel";
