// Message-shape helpers for the inject path (#104).
// Why this exists: pi-agent-core normalizes `agent.prompt("hello")` into a
// content-BLOCK user message —
//   { role: "user", content: [{ type: "text", text: "hello" }] }
// (verified against @earendil-works/pi-agent-core 0.84.2), not a string. An
// inject path that only understands `typeof content === "string"` therefore
// either never fires or, worse, rewrites the user's message down to the
// injected text. These helpers make "read the text" and "append text" total
// over both shapes, and refuse to guess, so a caller can stand down instead.

/** A message's text channel, plus the shape the write-back has to keep. */
export interface TextTarget {
  /** Text as the model would read it (text blocks joined, non-text blocks skipped). */
  text: string;
  /** Which shape the message actually uses — the shape the write-back keeps. */
  kind: "string" | "blocks";
}

/**
 * Read a message's text channel.
 *
 * Returns null when the message has no text channel at all (an image-only
 * turn, a non-string/non-array `content`, a missing message): callers must not
 * treat "no text" as "empty text", because injecting into the latter is safe
 * while appending to the former is not.
 *
 * @param message - Any chat message; only `.content` is inspected.
 * @returns The text and its shape, or null when there is no text to read.
 */
export function readMessageText(message: unknown): TextTarget | null {
  const content = (message as { content?: unknown } | null | undefined)?.content;
  if (typeof content === "string") return { text: content, kind: "string" };
  if (!Array.isArray(content)) return null;
  let sawTextBlock = false;
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const { type, text } = block as { type?: unknown; text?: unknown };
    if (type !== "text" || typeof text !== "string") continue;
    sawTextBlock = true;
    parts.push(text);
  }
  // A block array with no text block is not a text target (do not inject).
  if (!sawTextBlock) return null;
  return { text: parts.join("\n"), kind: "blocks" };
}

/**
 * Append `suffix` to a message's text channel, preserving the original shape.
 *
 * A string stays a string; a block array keeps every non-text block, appends
 * into its LAST text block (trailing text wins), and falls back to a new
 * trailing text block when the array has none. The input message is never
 * mutated and block objects are copied, not aliased.
 *
 * @param message - Message whose text should grow.
 * @param suffix - Text to append; an empty suffix passes the message through.
 * @param target - Shape descriptor from {@link readMessageText}.
 * @returns A new message, or null on a shape mismatch (caller must leave the
 *   message untouched rather than guess).
 */
export function appendMessageText(message: unknown, suffix: string, target: TextTarget): unknown | null {
  if (!suffix) return message;
  const content = (message as { content?: unknown } | null | undefined)?.content;
  if (target.kind === "string") {
    if (typeof content !== "string") return null;
    return { ...(message as object), content: content + suffix };
  }
  if (!Array.isArray(content)) return null;
  const blocks = content.map((b) => (b && typeof b === "object" ? { ...(b as object) } : b));
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i] as { type?: unknown; text?: unknown } | null;
    if (block && block.type === "text" && typeof block.text === "string") {
      blocks[i] = { ...block, text: block.text + suffix };
      return { ...(message as object), content: blocks };
    }
  }
  blocks.push({ type: "text", text: suffix });
  return { ...(message as object), content: blocks };
}

/**
 * Prepend `prefix` to a message's text channel, preserving the original shape.
 *
 * The mirror of {@link appendMessageText}, used by the T0 preferences block,
 * which is documented as a *leading* block: the prefix lands on the FIRST text
 * block so `<user_preferences>` stays at the head of the user's text.
 *
 * @param message - Message whose text should grow at the front.
 * @param prefix - Text to prepend; an empty prefix is a pass-through.
 * @param target - Shape descriptor from {@link readMessageText}.
 * @returns A new message, or null on a shape mismatch.
 */
export function prependMessageText(message: unknown, prefix: string, target: TextTarget): unknown | null {
  if (!prefix) return message;
  const content = (message as { content?: unknown } | null | undefined)?.content;
  if (target.kind === "string") {
    if (typeof content !== "string") return null;
    return { ...(message as object), content: prefix + content };
  }
  if (!Array.isArray(content)) return null;
  const blocks = content.map((b) => (b && typeof b === "object" ? { ...(b as object) } : b));
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i] as { type?: unknown; text?: unknown } | null;
    if (block && block.type === "text" && typeof block.text === "string") {
      blocks[i] = { ...block, text: prefix + block.text };
      return { ...(message as object), content: blocks };
    }
  }
  blocks.unshift({ type: "text", text: prefix });
  return { ...(message as object), content: blocks };
}
