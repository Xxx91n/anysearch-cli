import type { SessionManager } from "@earendil-works/pi-coding-agent";

export const PI_TURN_STARTED = "anysearch:turn-started";
export const PI_TURN_COMPLETED = "anysearch:turn-completed";
const PI_TURN_INTERRUPTED = "anysearch:turn-interrupted";

/** 补上最后一轮的中断说明。调用方同时持有租约和记录写锁。 */
export function recoverPiSessionRecord(record: SessionManager): string | undefined {
  const branch = record.getBranch();
  const questionIndex = branch.findLastIndex(
    (entry) => entry.type === "message" && entry.message?.role === "user",
  );
  if (questionIndex < 0) return undefined;

  let modelCalled = false;
  let assistantSeen = false;
  let lastStopReason: string | undefined;
  const unansweredTools = new Map<string, string>();
  for (const entry of branch.slice(questionIndex + 1)) {
    if (entry.type === "custom") {
      if (entry.customType === PI_TURN_COMPLETED) return undefined;
      if (entry.customType === PI_TURN_STARTED) modelCalled = true;
    }
    if (entry.type === "custom_message" && entry.customType === PI_TURN_INTERRUPTED) return undefined;
    if (entry.type !== "message") continue;

    const message = entry.message;
    if (message?.role === "assistant") {
      assistantSeen = true;
      lastStopReason = message.stopReason;
      if (lastStopReason !== "aborted" && lastStopReason !== "error" && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part?.type === "toolCall") unansweredTools.set(part.id, part.name);
        }
      }
    } else if (message?.role === "toolResult") {
      unansweredTools.delete(message.toolCallId);
    }
  }

  // 旧记录没有开始和收尾标记。只有问题时看不出模型是否收到过请求；
  // 有回答时按最后一条回答的结束原因和工具结果判断。
  if (!modelCalled && !assistantSeen) return "上一轮只留下了问题，可以直接再问一次。";
  if (!modelCalled && (lastStopReason === "stop" || lastStopReason === "length") && unansweredTools.size === 0) {
    return undefined;
  }

  const tools = Array.from(unansweredTools, ([id, name]) => ({ id, name }));
  const notice = [
    "上一轮没正常结束。没收到结果的工具状态未知，继续前请先核对现场。",
    ...tools.map(({ id, name }) => `工具 ${name}（${id}）：结果未知，不要自动重跑。`),
  ].join("\n");
  // Design: 提醒和工具状态写在同一行。写到一半被杀时整行作废，下一次还能补齐。
  record.appendCustomMessageEntry(PI_TURN_INTERRUPTED, notice, true, { tools });
  return notice;
}
