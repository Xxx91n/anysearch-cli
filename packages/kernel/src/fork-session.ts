import { closeSync, fstatSync, openSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { piSessionKey } from "./pi-runtime";
import { findPiSessionRecord } from "./pi-session";

/** Snapshot complete appends into a new handle without opening PI on the source. */
export function forkChatSession(dir: string, sourceId: string, newId: string): void {
  if (!newId || newId === sourceId) throw new Error("fork 必须使用新的显式会话句柄。");
  const sourceKey = piSessionKey(sourceId), newKey = piSessionKey(newId);
  if (findPiSessionRecord(dir, newKey)) throw new Error("新句柄已有对话记录，不能覆盖。");
  const source = findPiSessionRecord(dir, sourceKey);
  if (!source) throw new Error("找不到原会话的对话记录，无法 fork。");
  const fd = openSync(source, "r");
  let snapshot: Buffer;
  try {
    // Design: capture one file size, then read only that prefix — the owner may
    // still append while the person chooses. A partial last line is uncommitted
    // and is omitted in the copy; the original is never repaired or truncated.
    const bytes = Buffer.alloc(fstatSync(fd).size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) break;
      offset += count;
    }
    const read = bytes.subarray(0, offset);
    snapshot = read.subarray(0, read.lastIndexOf(10) + 1);
  } finally { closeSync(fd); }
  const lines = snapshot.toString("utf8").trimEnd().split("\n");
  const entries = lines.map((line, i) => {
    try { return JSON.parse(line); }
    catch { throw new Error("原会话第 " + (i + 1) + " 行无法解析，不能 fork。"); }
  });
  const header = entries[0];
  if (header?.type !== "session" || header.id !== sourceKey) throw new Error("原会话身份不一致，不能 fork。");
  entries[0] = { ...header, id: newKey, parentSession: source };
  const text = JSON.stringify(entries[0]) + "\n" + lines.slice(1).map(line => line + "\n").join("");
  // Exclusive creation also protects against two callers choosing the same id.
  writeFileSync(join(dir, "fork_" + newKey + ".jsonl"), text, { flag: "wx", mode: 0o600 });
}
