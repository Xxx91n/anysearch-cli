import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { readMessageText } from "./message-text";

export const PI_TURN_STARTED = "anysearch:turn-started";
export const PI_TOOL_STARTED = "anysearch:tool-started";
export const PI_TURN_COMPLETED = "anysearch:turn-completed";
const PI_TURN_INTERRUPTED = "anysearch:turn-interrupted";

interface InterruptedTurn {
  notice: string;
  question: string;
}

/** 读出或补上最后一轮的中断说明。调用方同时持有租约和记录写锁。 */
export function recoverPiSessionRecord(
  record: SessionManager,
  legacyTurnCompleted: () => boolean,
): InterruptedTurn | undefined {
  const branch = record.getBranch();
  let question = "";
  let questionIndex = branch.length - 1;
  for (; questionIndex >= 0; questionIndex--) {
    const entry = branch[questionIndex];
    if (entry?.type === "message" && entry.message?.role === "user") {
      question = readMessageText(entry.message)?.text ?? "";
      break;
    }
  }
  if (questionIndex < 0) return undefined;

  let modelCalled = false;
  let assistantSeen = false;
  let lastStopReason: string | undefined;
  const lastLegacyToolBatch = new Map<string, boolean>();
  const unansweredTools = new Map<string, string>();
  for (const entry of branch.slice(questionIndex + 1)) {
    if (entry.type === "custom") {
      if (entry.customType === PI_TURN_COMPLETED) return undefined;
      if (entry.customType === PI_TURN_STARTED) modelCalled = true;
      if (entry.customType === PI_TOOL_STARTED) {
        const data = entry.data as { id?: unknown; name?: unknown } | undefined;
        if (typeof data?.id === "string" && typeof data.name === "string") {
          unansweredTools.set(data.id, data.name);
        }
      }
    }
    if (entry.type === "custom_message" && entry.customType === PI_TURN_INTERRUPTED) {
      return typeof entry.content === "string" ? { notice: entry.content, question } : undefined;
    }
    if (entry.type !== "message") continue;

    const message = entry.message;
    if (message?.role === "assistant") {
      lastStopReason = message.stopReason;
      lastLegacyToolBatch.clear();
      const content = Array.isArray(message.content) ? message.content : [];
      const failed = lastStopReason === "aborted" || lastStopReason === "error";
      // PI can write a failure with an empty text block before reaching the model.
      assistantSeen ||= !failed || content.some((part) => {
        if (part?.type === "text") return typeof part.text === "string" && !!part.text.trim();
        if (part?.type === "thinking") return typeof part.thinking === "string" && !!part.thinking.trim();
        return part?.type === "toolCall";
      });
      // 旧记录只知道模型发过哪些工具请求，无法确认工具是否真的跑过。
      if (!modelCalled && !failed) {
        for (const part of content) {
          if (part?.type === "toolCall" && typeof part.id === "string" && typeof part.name === "string") {
            unansweredTools.set(part.id, part.name);
            lastLegacyToolBatch.set(part.id, false);
          }
        }
      }
    } else if (message?.role === "toolResult") {
      unansweredTools.delete(message.toolCallId);
      if (lastLegacyToolBatch.has(message.toolCallId)) {
        // These are the persisted reasons from the old URL policy's
        // terminate:true paths. PI did not store the terminate bit.
        const stoppedByPolicy = message.isError && Array.isArray(message.content) &&
          message.content.some((part) =>
            part?.type === "text" && typeof part.text === "string" &&
            (part.text.startsWith("URL rejected by trust boundary: ") ||
              part.text.startsWith("Blocked retrieved-derived URL ")));
        lastLegacyToolBatch.set(message.toolCallId, stoppedByPolicy);
      }
    }
  }

  // 旧记录没有开始和收尾标记。只有问题时看不出模型是否收到过请求；
  // 有回答时按最后一条回答的结束原因和工具结果判断。
  if (!modelCalled && !assistantSeen) return { notice: "上一轮只留下了问题，可以直接再问一次。", question };
  if (!modelCalled && unansweredTools.size === 0) {
    if (lastStopReason === "stop" || lastStopReason === "length") return undefined;
    // A tool may normally end the turn. Old PI records do not say whether
    // another request was expected, but the chat row can confirm completion.
    if (lastStopReason === "toolUse") {
      const policyEndedBatch = lastLegacyToolBatch.size > 0 && [...lastLegacyToolBatch.values()].every(Boolean);
      if (policyEndedBatch || legacyTurnCompleted()) return undefined;
    }
  }

  const tools = Array.from(unansweredTools, ([id, name]) => ({ id, name }));
  // 工具名和调用编号来自记录，只把标识符显示给用户和模型。
  const displayId = (value: string) => value.replace(/[^A-Za-z0-9_.:|+/-]/g, "�");
  const notice = [
    "上一轮没正常结束。没收到结果的工具状态未知，继续前请先核对现场。",
    ...tools.map(({ id, name }) => `工具 ${displayId(name)}（${displayId(id)}）：结果未知，不要自动重跑。`),
  ].join("\n");
  // Design: 提醒和工具状态一起写 — 这条记录没写完，下次就会整条重补。
  record.appendCustomMessageEntry(PI_TURN_INTERRUPTED, notice, true, { tools });
  return { notice, question };
}
