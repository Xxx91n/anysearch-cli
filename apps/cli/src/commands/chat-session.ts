import type { SessionStorePort } from "@anysearch-cli/kernel";

export interface ChatOptions {
  query: string;
  continueLatest: boolean;
  sessionId?: string;
  list: boolean;
  unassigned: boolean;
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

export function selectChatSession(store: SessionStorePort, options: ChatOptions, projectRoot: string | null, hasRecord: (id: string) => boolean): string | undefined {
  if (options.continueLatest) {
    if (!projectRoot) throw new Error("无法确定当前项目。请用 --list --unassigned 查看旧会话，再用 --session ID 续聊。");
    if (!store.listChatSessions) throw new Error("当前存储不支持查看会话。");
    const latest = store.listChatSessions(projectRoot).find((entry) => hasRecord(entry.id));
    if (!latest) throw new Error("当前项目还没有会话。直接提问就会新建对话。");
    return latest.id;
  }
  if (options.sessionId) {
    if (!store.getChatSession?.(options.sessionId)) throw new Error("找不到这个会话：" + options.sessionId);
    if (!hasRecord(options.sessionId)) throw new Error("找不到这段会话的完整对话记录：" + options.sessionId);
    return options.sessionId;
  }
  return undefined;
}
