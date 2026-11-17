import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { ChatCollisionChoice } from "@anysearch-cli/kernel";

interface CollisionTerminal {
  isTTY: boolean;
  input?: Readable;
  output?: Writable;
  ask?: (question: string) => Promise<string>;
  newHandle?: () => string;
}

/** The host decides whether a person can answer; the attempt owns the lease. */
export async function chooseChatCollision(
  sessionId: string,
  terminal: CollisionTerminal = { isTTY: Boolean(process.stdin.isTTY) && !process.env.ANS_NO_INTERACTIVE },
): Promise<ChatCollisionChoice> {
  if (!terminal.isTTY) return "stop";
  const question = "这段会话正在别处运行（" + sessionId + "）。[1/fork] 另开一份接着聊，[2/wait] 等它跑完；直接回车不动：";
  let answer: string;
  try {
    answer = await (terminal.ask ? terminal.ask(question) : readAnswer(question, terminal.input ?? process.stdin, terminal.output ?? process.stderr));
  } catch { return "stop"; }
  switch (answer.trim().toLowerCase()) {
    case "1": case "f": case "fork": return { fork: (terminal.newHandle ?? randomUUID)() };
    case "2": case "w": case "wait": return "wait";
    default: return "stop";
  }
}

function readAnswer(question: string, input: Readable, output: Writable): Promise<string> {
  return new Promise(resolve => {
    const rl = createInterface({ input, output, terminal: false });
    const finish = (answer = "") => {
      input.removeListener("error", onError);
      rl.removeListener("line", onLine);
      rl.removeListener("close", onClose);
      rl.close();
      resolve(answer);
    };
    const onLine = (line: string) => finish(line);
    const onClose = () => finish();
    const onError = () => finish();
    rl.once("line", onLine);
    rl.once("close", onClose);
    input.once("error", onError);
    output.write(question);
    if (input.readableEnded || input.destroyed) finish();
  });
}
