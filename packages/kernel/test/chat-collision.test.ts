import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChatAttempt, ChatAttemptBusyError } from "../src/chat-attempt";
import { piSessionKey } from "../src/pi-runtime";
import { findPiSessionRecord } from "../src/pi-session";
import { acquireSessionLock, resolveSessionLockWindows } from "../src/session-lock";

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "ans-317-"));
  try {
    const source = join(dir, "2026-01-01_" + piSessionKey("original") + ".jsonl");
    const header = { type: "session", version: 3, id: piSessionKey("original"), cwd: "/project", timestamp: "2026-01-01T00:00:00Z" };
    const user = { type: "message", id: "u1", parentId: null, message: { role: "user", content: "先前的问题", timestamp: 1 } };
    const committed = JSON.stringify(header) + "\n" + JSON.stringify(user) + "\n";
    writeFileSync(source, committed + '{"type":"message"');
    let enter!: () => void, finish!: () => void;
    const entered = new Promise<void>(r => { enter = r; });
    const held = new Promise<void>(r => { finish = r; });
    const options = { sessionId: "original", piSessionDir: dir, projectRoot: "/project" };
    const holder = runChatAttempt(options, async () => { enter(); await held; return { completed: true }; });
    await entered;
    try {
      await assert.rejects(runChatAttempt(options, async () => { throw new Error("不能运行"); }), ChatAttemptBusyError);
      const before = readFileSync(source);
      await runChatAttempt({ ...options, onBusy: async () => ({ fork: "new-handle" }) }, async ctx => {
        assert.equal(ctx.sessionId, "new-handle");
        const fork = findPiSessionRecord(dir, piSessionKey("new-handle"));
        assert.ok(fork);
        const lines = readFileSync(fork, "utf8").trimEnd().split("\n").map(l => JSON.parse(l));
        assert.equal(lines[0].id, piSessionKey("new-handle"));
        assert.deepEqual(lines.slice(1), [user]);
        assert.deepEqual(readFileSync(source), before);
        return { completed: true };
      });
      const filesBefore = readdirSync(dir);
      await assert.rejects(runChatAttempt({ ...options, onBusy: async () => "stop" }, async () => { throw new Error("不能运行"); }), ChatAttemptBusyError);
      assert.deepEqual(readdirSync(dir), filesBefore);
      let started = false;
      const waiter = runChatAttempt({ ...options, onBusy: async () => "wait" }, async ctx => {
        started = true;
        assert.equal(ctx.sessionId, "original");
        return { completed: true };
      });
      await new Promise(r => setTimeout(r, 75));
      assert.equal(started, false);
      finish();
      await holder;
      assert.equal((await waiter).completed, true);
      assert.equal(started, true);
    } finally { finish(); await holder; }

    // A separate process owns the very same lease protocol. No model, stdin,
    // user config, or real home directory participates in this collision.
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { runChatAttempt } from ${JSON.stringify(new URL("../src/chat-attempt.ts", import.meta.url).href)};
      await runChatAttempt(${JSON.stringify(options)}, async () => {
        process.stdout.write("ready\\n");
        await new Promise(resolve => process.stdin.once("data", resolve));
        return { completed: true };
      });
    `], { stdio: ["pipe", "pipe", "pipe"] });
    let childError = "";
    child.stderr.on("data", chunk => { childError += chunk; });
    const exited = new Promise<number | null>(resolve => child.once("exit", resolve));
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("租约进程未就绪：" + childError)), 10_000);
        child.once("error", error => { clearTimeout(timeout); reject(error); });
        child.stdout.once("data", () => { clearTimeout(timeout); resolve(); });
        child.once("exit", () => { clearTimeout(timeout); reject(new Error("租约进程提前结束：" + childError)); });
      });
      const start = Date.now();
      await assert.rejects(runChatAttempt(options, async () => { throw new Error("不能运行"); }), ChatAttemptBusyError);
      assert.ok(Date.now() - start < 1_000, "跨进程同样立即拒绝");
      await runChatAttempt({ ...options, onBusy: async () => ({ fork: "cross-process-fork" }) }, async ctx => {
        assert.equal(ctx.sessionId, "cross-process-fork");
        assert.ok(findPiSessionRecord(dir, piSessionKey(ctx.sessionId)));
        return { completed: true };
      });
      const waiting = runChatAttempt({ ...options, onBusy: async () => "wait" }, async () => ({ completed: true }));
      child.stdin.end("finish");
      assert.equal((await waiting).completed, true);
      assert.equal(await exited, 0);
    } finally { child.kill(); await exited; }

    const lock = join(dir, "default.lock");
    const release = await acquireSessionLock(lock, resolveSessionLockWindows(undefined));
    try {
      const start = Date.now();
      await assert.rejects(acquireSessionLock(lock, resolveSessionLockWindows(undefined)), /busy/);
      assert.ok(Date.now() - start < 1_000, "底层锁默认不等待");
    } finally { release(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
