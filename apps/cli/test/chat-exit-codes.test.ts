// #581 acceptance — the four exit codes `ans chat` promises.
//
//   2  usage error (nothing to do)
//   3  no usable provider/model
//   1  the attempt could not run (here: no interrupted turn to continue)
//   130 Ctrl-C during a model call
//
// The 130 case needs a real attempt: an execution task (so the script-mode
// budget exists), a local endpoint that accepts the request and never answers,
// then SIGINT at the moment the provider was reached. That is the same path a
// user's Ctrl-C takes, not a stubbed return value. The database is in-memory,
// so the attempt leaves no file behind and the engine's open connection cannot
// block cleanup on Windows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChat } from "../src/commands/chat.js";
import { runWithCliTask } from "../src/cli-task-context.js";

const ENV_KEYS = [
  "HOME", "USERPROFILE", "ANS_DB_PATH", "ANS_PI_SESSION_DIR", "ANS_DOMAIN", "ANS_DOMAINS_DIR",
  "ANS_LLM_PROVIDER", "ANS_LLM_MODEL", "ANS_LLM_BASE_URL", "ANS_LLM_API", "ANS_LLM_API_KEY",
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
  "EXA_API_KEY", "TAVILY_API_KEY", "ANYSEARCH_API_KEY",
];

/** A temp home/project pair with every env that could steer writes redirected. */
function isolate() {
  const root = mkdtempSync(join(tmpdir(), "ans-581-exit-"));
  const home = join(root, "home");
  const cwd = join(root, "project");
  mkdirSync(join(home, ".ans"), { recursive: true });
  mkdirSync(join(cwd, ".ans"), { recursive: true });
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.ANS_DB_PATH = ":memory:";
  process.env.ANS_PI_SESSION_DIR = join(root, "pi-sessions");
  const previousCwd = process.cwd();
  process.chdir(cwd);
  return {
    root, home, cwd,
    restore() {
      process.chdir(previousCwd);
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

test("no question is a usage error: exit 2", async () => {
  const f = isolate();
  try {
    assert.equal(await runChat([]), 2);
  } finally {
    f.restore();
  }
});

test("no usable provider/model: exit 3", async () => {
  const f = isolate();
  try {
    assert.equal(await runChat(["-p", "hello"]), 3);
  } finally {
    f.restore();
  }
});

test("no interrupted turn to continue: exit 1", async () => {
  const f = isolate();
  try {
    assert.equal(await runChat(["-c"]), 1);
  } finally {
    f.restore();
  }
});

test("Ctrl-C during the model call: exit 130", async () => {
  const f = isolate();
  const sockets = new Set<Socket>();
  let server: Server | undefined;
  try {
    server = createServer(() => {
      // Accept the request and never answer. Reaching this callback proves the
      // SIGINT listener is installed and a model call is in flight, so the
      // abort is the same path a user's Ctrl-C takes.
      process.emit("SIGINT");
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    const listening = Promise.withResolvers<void>();
    server.once("error", listening.reject);
    server.once("listening", () => listening.resolve());
    server.listen(0, "127.0.0.1");
    await listening.promise;
    const port = (server.address() as { port: number }).port;

    process.env.ANS_LLM_PROVIDER = "openai";
    process.env.ANS_LLM_MODEL = "gpt-5";
    process.env.ANS_LLM_BASE_URL = "http://127.0.0.1:" + port + "/v1";
    process.env.ANS_LLM_API = "chat";
    process.env.ANS_LLM_API_KEY = "sk-test-local";

    // Production's dispatch registers a task per command. This stands in for
    // it: the id only has to name the execution whose budget the run attaches
    // to, and an undeclared budget has no row to enforce, so a fake id is
    // enough for the cancellation path.
    const run = runWithCliTask(
      { taskId: "cli-chat-fake", kind: "cli.chat", role: "business", attachSession: () => {} },
      () => runChat(["-p", "hello"]),
    );
    // A hung run fails the test runner's own timeout; a returned code is the
    // contract under test.
    const code = await run;
    assert.equal(code, 130);
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server) {
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      await closed.promise;
    }
    f.restore();
  }
});
