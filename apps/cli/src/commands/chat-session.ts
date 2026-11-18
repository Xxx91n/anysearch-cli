import type { PiSessionRecordVerdict, SessionStorePort } from "@anysearch-cli/kernel";
import { describePiSessionVerdict, piSessionKey, sessionVerdictsForDir } from "@anysearch-cli/kernel";
import { parseLlmFlags } from "../config-llm";

export interface ChatOptions {
  query: string;
  continueLatest: boolean;
  print: boolean;
  retryInterrupted: boolean;
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
  const options: ChatOptions = { query: "", continueLatest: false, print: false, retryInterrupted: false, list: false, unassigned: false };
  const query: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") { query.push(...args.slice(i + 1)); break; }
    if (arg === "--continue") options.continueLatest = true;
    else if (arg === "-p") options.print = true;
    else if (arg === "-c") options.retryInterrupted = true;
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
  if (options.retryInterrupted && (options.print || options.continueLatest || query.length)) {
    throw new Error("-c 会接着问被打断的那轮，请不要再传问题、-p 或 --continue。");
  }
  if (options.list && (options.continueLatest || options.sessionId || options.print || options.retryInterrupted || query.length)) throw new Error("查看会话列表时，不要同时提问或续聊。");
  options.query = query.join(" ");
  return options;
}

/**
 * 选出这次要续的会话；记录不能用就拒绝。
 *
 * 读记录是传进来的函数，所以这里不碰文件系统。拒绝时把原因带上：坏了第几行、
 * 格式比本版新、还是身份对不上。坏了和从来没有，是两句话，都不会被当成新对话。
 */
export function selectChatSession(store: SessionStorePort, options: ChatOptions, projectRoot: string | null, readRecord?: (id: string) => PiSessionRecordVerdict): string | undefined {
  if (options.continueLatest || (options.retryInterrupted && !options.sessionId)) {
    if (!projectRoot) throw new Error("无法确定当前项目。请用 --list --unassigned 查看旧会话，再用 --session ID 续聊。");
    if (!store.listChatSessions) throw new Error("当前存储不支持查看会话。");
    const latest = store.listChatSessions(projectRoot)[0];
    if (!latest) {
      throw new Error(options.retryInterrupted ? "当前项目没有可续的会话。" : "当前项目还没有会话。直接提问就会新建对话。");
    }
    const verdict = readRecord?.(latest.id);
    if (verdict && !verdict.ok) throw new Error("最近会话不能续聊（" + latest.id + "）：" + verdict.message);
    return latest.id;
  }
  if (options.sessionId) {
    if (!store.getChatSession?.(options.sessionId)) throw new Error("找不到这个会话：" + options.sessionId);
    const verdict = readRecord?.(options.sessionId);
    if (verdict && !verdict.ok) throw new Error("这段会话不能续聊（" + options.sessionId + "）：" + verdict.message);
    return options.sessionId;
  }
  return undefined;
}

/**
 * `ans chat --list` 的一行。
 *
 * 有问题的会话照样列出，后面写清是哪一种问题，方便自己去查或手工处理。
 * 一条坏记录不会让整张表失败，也不会让这一行消失。
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
 * 列表和续聊共用的读记录函数。
 *
 * 存储用的是自己的会话 id，记录目录用的是 PI 句柄。id 在这里转一次，两条路才在说同一份文件。
 */
export function chatRecordReader(sessionDir: string): (storeSessionId: string) => PiSessionRecordVerdict {
  const verdictsByHandle = sessionVerdictsForDir(sessionDir);
  return (storeSessionId: string) => verdictsByHandle(piSessionKey(storeSessionId));
}

/** `ans chat --list` 的全部行，每行一个会话。 */
export function formatChatList(
  readRecord: (storeSessionId: string) => PiSessionRecordVerdict,
  entries: ReadonlyArray<{ id: string; updatedAt?: string; isCompleted?: number | boolean | null }>,
): string[] {
  return entries.map((entry) => formatChatListLine(entry, readRecord));
}
