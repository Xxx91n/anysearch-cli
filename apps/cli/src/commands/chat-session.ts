import type { PiSessionRecordVerdict, SessionStorePort } from "@anysearch-cli/kernel";
import { describePiSessionVerdict, piSessionKey, sessionVerdictsForDir } from "@anysearch-cli/kernel";
import { parseLlmFlags } from "../config-llm";

export interface ChatOptions {
  query: string;
  continueLatest: boolean;
  sessionId?: string;
  list: boolean;
  unassigned: boolean;
}

export function parseChatArgv(argv: string[]) {
  const separator = argv.indexOf("--");
  const parsed = parseLlmFlags(separator < 0 ? argv : argv.slice(0, separator));
  if (separator >= 0) parsed.argv.push("--", ...argv.slice(separator + 1));
  return { flags: parsed.flags, options: parseChatOptions(parsed.argv) };
}

export function parseChatOptions(args: string[]): ChatOptions {
  const options: ChatOptions = { query: "", continueLatest: false, list: false, unassigned: false };
  const query: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") { query.push(...args.slice(i + 1)); break; }
    if (arg === "--continue") options.continueLatest = true;
    else if (arg === "--list") options.list = true;
    else if (arg === "--unassigned") options.unassigned = true;
    else if (arg === "--session" || arg.startsWith("--session=")) {
      const id = arg === "--session" ? args[++i] : arg.slice("--session=".length);
      if (!id || options.sessionId) throw new Error("--session 需要一个会话 ID。");
      options.sessionId = id;
    } else if (arg.startsWith("--")) throw new Error("不认识这个选项：" + arg);
    else query.push(arg);
  }
  if (options.continueLatest && options.sessionId) throw new Error("--continue 和 --session 只能选一个。");
  if (options.unassigned && !options.list) throw new Error("--unassigned 请和 --list 一起用。");
  if (options.list && (options.continueLatest || options.sessionId || query.length)) throw new Error("查看会话列表时，不要同时提问或续聊。");
  options.query = query.join(" ");
  return options;
}

/**
 * Pick the conversation this run belongs to, and refuse one whose record cannot
 * be used.
 *
 * The record judgment is passed in as a function so this stays a pure decision:
 * the caller owns the filesystem. A broken record is refused with its own
 * sentence — the line number, the format version, the identity mismatch — so
 * the user can tell "the file is damaged" from "this handle never had a record"
 * and neither is mistaken for a fresh conversation.
 */
export function selectChatSession(store: SessionStorePort, options: ChatOptions, projectRoot: string | null, readRecord: (id: string) => PiSessionRecordVerdict): string | undefined {
  if (options.continueLatest) {
    if (!projectRoot) throw new Error("无法确定当前项目。请用 --list --unassigned 查看旧会话，再用 --session ID 续聊。");
    if (!store.listChatSessions) throw new Error("当前存储不支持查看会话。");
    const latest = store.listChatSessions(projectRoot)[0];
    if (!latest) throw new Error("当前项目还没有会话。直接提问就会新建对话。");
    const verdict = readRecord(latest.id);
    if (!verdict.ok) throw new Error("最近会话不能续聊（" + latest.id + "）：" + verdict.message);
    return latest.id;
  }
  if (options.sessionId) {
    if (!store.getChatSession?.(options.sessionId)) throw new Error("找不到这个会话：" + options.sessionId);
    const verdict = readRecord(options.sessionId);
    if (!verdict.ok) throw new Error("这段会话不能续聊（" + options.sessionId + "）：" + verdict.message);
    return options.sessionId;
  }
  return undefined;
}

/**
 * One line of `ans chat --list`.
 *
 * Every conversation the store knows is listed, including the ones whose record
 * cannot be opened: a user needs to see that the conversation exists and what is
 * wrong with it, so they can inspect or repair it by hand. The reason comes from
 * the verdict, so a broken middle line, a newer format and a mismatched identity
 * each read differently. A record problem never removes the row — one bad file
 * must not make the list look like the conversation never existed.
 */
export function formatChatListLine(
  entry: { id: string; updatedAt?: string; isCompleted?: number | boolean | null },
  readRecord: (id: string) => PiSessionRecordVerdict,
): string {
  let note = entry.isCompleted ? "" : "\t未完成";
  try {
    const verdict = readRecord(entry.id);
    // A torn tail is not a refusal, but it IS something the user should see:
    // the conversation lost whatever that write was going to say.
    if (!verdict.ok || verdict.tornTail) note += "\t" + describePiSessionVerdict(verdict);
  } catch (error: any) {
    // The judgment itself must not take the whole list down.
    note += "\t对话记录无法确认，请单独检查";
  }
  return entry.id + "\t" + entry.updatedAt + note;
}

/**
 * The one reader both `ans chat --list` and `ans chat --session/--continue` use.
 *
 * The store and the record directory disagree on what a conversation is called:
 * the store speaks its own session id, the record directory speaks PI handles.
 * Mapping the id here, once, is what keeps the list and a resume talking about
 * the same file — a caller that passed a raw store id would make every row read
 * "没有对话记录" while a resume of the same id worked (#316).
 */
export function chatRecordReader(sessionDir: string): (storeSessionId: string) => PiSessionRecordVerdict {
  const verdictsByHandle = sessionVerdictsForDir(sessionDir);
  return (storeSessionId: string) => verdictsByHandle(piSessionKey(storeSessionId));
}

/**
 * Every line `ans chat --list` prints, from a session dir and a list of rows.
 *
 * The rendering is here rather than in the command so the reader BELOW and the
 * rows it feeds are exercised together: a test can hand in a real directory and
 * real rows, and any break in the id→handle mapping shows up as a wrong line
 * instead of passing because the test rebuilt the mapping itself (#316).
 */
export function formatChatList(
  sessionDir: string,
  entries: ReadonlyArray<{ id: string; updatedAt?: string; isCompleted?: number | boolean | null }>,
): string[] {
  const readRecord = chatRecordReader(sessionDir);
  return entries.map((entry) => formatChatListLine(entry, readRecord));
}
