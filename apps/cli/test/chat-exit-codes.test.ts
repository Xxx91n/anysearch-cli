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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
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

/** Point the layered resolver at a local endpoint through the env layer. */
function pointAtModel(port: number): void {
  process.env.ANS_LLM_PROVIDER = "openai";
  process.env.ANS_LLM_MODEL = "gpt-5";
  process.env.ANS_LLM_BASE_URL = "http://127.0.0.1:" + port + "/v1";
  process.env.ANS_LLM_API = "chat";
  process.env.ANS_LLM_API_KEY = "sk-test-local";
}

/**
 * A local model endpoint that accepts a request and never answers. `onRequest`
 * runs when the first request arrives, which is also proof that the run got
 * past config resolution and reached a provider call.
 */
async function stallingEndpoint(onRequest: () => void) {
  const sockets = new Set<Socket>();
  const server = createServer(() => onRequest());
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const listening = Promise.withResolvers<void>();
  server.once("error", listening.reject);
  server.once("listening", () => listening.resolve());
  server.listen(0, "127.0.0.1");
  await listening.promise;
  return {
    port: (server.address() as { port: number }).port,
    async close() {
      for (const socket of sockets) socket.destroy();
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      await closed.promise;
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

// Production's dispatch registers a task per command. This stands in for it:
// the id only has to name the execution whose budget the run attaches to, and
// an undeclared budget has no row to enforce, so a fake id is enough.
const CHAT_TASK = { taskId: "cli-chat-fake", kind: "cli.chat", role: "business" as const, attachSession: () => {} };

test("Ctrl-C during the model call: exit 130", async () => {
  const f = isolate();
  const endpoint = await stallingEndpoint(() => {
    // Reaching the request proves the SIGINT listener is installed and a model
    // call is in flight, so the abort is the path a user's Ctrl-C takes.
    process.emit("SIGINT");
  });
  try {
    pointAtModel(endpoint.port);
    const code = await runWithCliTask(CHAT_TASK, () => runChat(["-p", "hello"]));
    assert.equal(code, 130);
  } finally {
    await endpoint.close();
    f.restore();
  }
});

test("a broken user config plus env still reaches the model", async () => {
  const f = isolate();
  writeFileSync(join(f.home, ".ans", "config.toml"), "[llm\n");
  const request = Promise.withResolvers<void>();
  const endpoint = await stallingEndpoint(() => request.resolve());
  try {
    pointAtModel(endpoint.port);
    const run = runWithCliTask(CHAT_TASK, () => runChat(["-p", "hello"]));
    // The provider request is the proof the broken file did not stop the run.
    // Race the run so a regression that exits early fails with its exit code
    // instead of waiting for the test runner's timeout.
    await Promise.race([
      request.promise,
      run.then((code) => { throw new Error("the run exited " + code + " before reaching the model"); }),
    ]);
    process.emit("SIGINT");
    assert.equal(await run, 130);
  } finally {
    await endpoint.close();
    f.restore();
  }
});
