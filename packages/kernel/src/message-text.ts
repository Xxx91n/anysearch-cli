// Message-shape helpers for the inject path (#104).
// Why this exists: pi-agent-core normalizes `agent.prompt("hello")` into a
// content-BLOCK user message —
//   { role: "user", content: [{ type: "text", text: "hello" }] }
// (verified against @earendil-works/pi-agent-core 0.84.2), not a string. An
// inject path that only understands `typeof content === "string"` therefore
// either never fires or, worse, rewrites the user's message down to the
// injected text. These helpers make "read the text" and "append text" total
// over both shapes, and refuse to guess, so a caller can stand down instead.

export interface TextTarget {
  // Text as the model would read it (blocks joined, non-text blocks skipped).
  text: string;
  // Which shape the message actually uses — the shape the write-back keeps.
  kind: "string" | "blocks";
}

// readMessageText returns the user-visible text of a message, or null when the
// message has no text channel at all (e.g. an image-only turn): callers must
// not treat "no text" as "empty text".
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

// appendMessageText returns a copy of `message` with `suffix` appended to its
// text channel, preserving the original shape: a string stays a string, a
// block array keeps every non-text block and appends to its last text block
// (falling back to a new trailing text block). Returns null when the message
// has no text channel — the caller must then leave it untouched.
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

// prependMessageText is appendMessageText at the head of the text channel —
// used by the T0 preferences block, which is documented as a leading block.
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
