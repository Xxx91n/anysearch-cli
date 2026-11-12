// Cross-process session lock (#266, D12).
//
// The lock's own rules, verified without spawning MCP servers:
//   L1 defaults and bounds — the engineering values are the production ones
//      (10 min stale, 120 s wait) and the heartbeat cadence is clamped;
//   L2 mutual exclusion in one process, plus busy after the wait cap;
//   L3 a live local owner is never reclaimed, however old its heartbeat is;
//   L4 a confirmed-dead local owner is reclaimed at once — no ten-minute wait;
//   L5 a foreign-host owner and an identity-less lock are only reclaimed
//      after the stale window (conservative for the unconfirmable);
//   L6 release and heartbeat only ever touch a lock that still names us.
//
// Plus the runtime wiring:
//   W1 a run with a durable PI record holds the lock while it runs and
//      cleans it up after;
//   W2 a same-session caller that outlives the wait cap gets "session busy"
//      as an error event, even when the current run is in the same process.
//
// Run: pnpm --filter @anysearch-cli/kernel run test

import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { PiAgentRuntime, piSessionKey } from "../src/pi-runtime";
import {
  acquireSessionLock,
  heartbeatIntervalMs,
  SESSION_BUSY_MESSAGE,
  SESSION_LOCKS_DIRNAME,
  SESSION_LOCK_STALE_MS,
  SESSION_LOCK_WAIT_MS,
} from "../src/session-lock";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

const OWNER_FILE = "owner.json";
const HEARTBEAT_FILE = "heartbeat";

function ownerFile(lockDir: string) { return join(lockDir, OWNER_FILE); }
function heartbeatFile(lockDir: string) { return join(lockDir, HEARTBEAT_FILE); }

function writeFakeOwner(lockDir: string, pid: number, host: string) {
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(ownerFile(lockDir), JSON.stringify({ pid, host, startedAt: Date.now() }));
}

function backdate(path: string, ageMs: number) {
  const old = new Date(Date.now() - ageMs);
  utimesSync(path, old, old);
}

/** A pid that was alive moments ago and is not anymore. */
async function recentlyDeadPid(): Promise<number | null> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  const pid = child.pid ?? null;
  await new Promise<void>((resolve) => child.on("exit", () => resolve()));
  return pid;
}

async function expectBusy(lockDir: string, staleMs: number, waitMs: number): Promise<string | undefined> {
  try {
    const release = await acquireSessionLock(lockDir, { staleMs, waitMs });
    release();
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function expectAcquired(lockDir: string, staleMs: number, waitMs: number): Promise<() => void> {
  return acquireSessionLock(lockDir, { staleMs, waitMs });
}

// ---------- runtime wiring helpers (same minimal shape as the #258 tests) ----------

const domain: any = {
  sources: { enabled: [] },
  prompts: [{ name: "system", content: "LOCK-PROBE: answer briefly." }],
  skills: { active: ["search"] },
  hooks: { toolWhitelist: ["search"] },
  rag: { adapter: "none" },
};
const model: any = {
  id: "probe-model", name: "probe-model", api: "openai-completions", provider: "probe",
  contextWindow: 200000, maxTokens: 4096, reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
class NoopRetriever {
  async search(q: any) {
    return { query: String(q.query), mode: "fast", results: [], answers: [], metadata: {} } as any;
  }
}

function slowProvider(text: string, delayMs: number) {
  const fn = async () => {
    await new Promise((r) => setTimeout(r, delayMs));
    const message: any = {
      role: "assistant", content: [{ type: "text", text }],
      api: "openai-completions", provider: "probe", model: "probe-model",
      stopReason: "stop", timestamp: Date.now(),
    };
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "start", partial: { ...message, content: [] } };
        yield { type: "text_delta", contentIndex: 0, delta: text, partial: message };
        yield { type: "done", reason: "stop", message };
      },
      result: async () => message,
    };
  };
  return fn;
}

async function drain(run: AsyncIterable<any>) {
  const events: any[] = [];
  for await (const e of run) events.push(e);
  return events;
}

// ---------- the tests ----------

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), "ans-266-lock-"));

  try {
    // ---------- L1: engineering values are the production ones ----------
    {
      assert(SESSION_LOCK_STALE_MS === 10 * 60_000, "L1: stale window defaults to 10 minutes");
      assert(SESSION_LOCK_WAIT_MS === 120_000, "L1: same-session wait cap defaults to 120 seconds");
      assert(heartbeatIntervalMs(SESSION_LOCK_STALE_MS) === 5_000,
        "L1: production heartbeat cadence is the 5 s cap");
      assert(heartbeatIntervalMs(3_000) === 1_000, "L1: heartbeat follows stale/3 in the open interval");
      assert(heartbeatIntervalMs(150) === 100, "L1: heartbeat never beats faster than the 100 ms floor");
      assert(heartbeatIntervalMs(60_000) === 5_000, "L1: heartbeat never beats slower than the 5 s cap");
    }

    // ---------- L2: mutual exclusion, wait cap, cleanup ----------
    {
      const lockDir = join(workDir, "l2", "s.lock");
      const release = await expectAcquired(lockDir, 200, 500);
      assert(existsSync(ownerFile(lockDir)), "L2: the holder publishes owner.json");
      assert(existsSync(heartbeatFile(lockDir)), "L2: the holder writes a heartbeat immediately");

      const busy = await expectBusy(lockDir, 200, 300);
      assert(busy === SESSION_BUSY_MESSAGE,
        "L2: a contender outliving the wait cap gets the session-busy error (got " + JSON.stringify(busy) + ")");

      release();
      assert(!existsSync(lockDir), "L2: release removes the lock directory");

      const reRelease = await expectAcquired(lockDir, 200, 500);
      reRelease();
      assert(!existsSync(lockDir), "L2: the lock is immediately re-acquirable after release");
    }

    // ---------- L3: a live local owner is never reclaimed ----------
    {
      const lockDir = join(workDir, "l3", "s.lock");
      const release = await expectAcquired(lockDir, 200, 500);
      // The heartbeat and the directory are an hour old — far past any stale
      // window — but the owner (this process) is alive on this host.
      backdate(heartbeatFile(lockDir), 60 * 60_000);
      backdate(lockDir, 60 * 60_000);

      const busy = await expectBusy(lockDir, 200, 300);
      assert(busy === SESSION_BUSY_MESSAGE,
        "L3: a live local owner keeps the lock however old the heartbeat is (got " + JSON.stringify(busy) + ")");
      assert(existsSync(ownerFile(lockDir)), "L3: the contender did not sweep the live owner's lock");

      release();
      assert(!existsSync(lockDir), "L3: the real owner's release still cleans up");
    }

    // ---------- L4: a confirmed-dead local owner is reclaimed at once ----------
    {
      const deadPid = await recentlyDeadPid();
      if (deadPid !== null) {
        const lockDir = join(workDir, "l4", "s.lock");
        writeFakeOwner(lockDir, deadPid, hostname());
        writeFileSync(heartbeatFile(lockDir), String(Date.now())); // heartbeat is FRESH

        const started = Date.now();
        const release = await expectAcquired(lockDir, SESSION_LOCK_STALE_MS, 5_000);
        const elapsed = Date.now() - started;
        assert(elapsed < 2_000,
          "L4: a confirmed-dead local owner is reclaimed at once, not after the 10 min window (took " + elapsed + " ms)");
        const owner = JSON.parse(readFileSync(ownerFile(lockDir), "utf8"));
        assert(owner.pid === process.pid, "L4: the new holder's identity is on record after the reclaim");
        release();
      } else {
        assert(false, "L4: could not obtain a recently dead pid to test with");
      }
    }

    // ---------- L5: unconfirmable owners wait out the stale window ----------
    {
      // A foreign host with a heartbeat younger than the stale window is
      // protected (stale 1 s / wait 300 ms: the heartbeat cannot outlive the
      // window before the contender gives up)...
      const foreign = join(workDir, "l5a", "s.lock");
      writeFakeOwner(foreign, 424242, "some-other-host");
      writeFileSync(heartbeatFile(foreign), String(Date.now()));
      let busy = await expectBusy(foreign, 1_000, 300);
      assert(busy === SESSION_BUSY_MESSAGE,
        "L5: a foreign-host owner with a fresh heartbeat is not reclaimed (got " + JSON.stringify(busy) + ")");

      // ...and reclaimable once the heartbeat outlives the stale window.
      backdate(heartbeatFile(foreign), 1_500);
      const release = await expectAcquired(foreign, 1_000, 2_000);
      assert(existsSync(ownerFile(foreign)), "L5: an expired foreign-host lock is reclaimed");
      release();

      // A lock with no identity at all is judged by directory age: fresh is
      // protected (the just-created floor), old is reclaimed.
      const anonymous = join(workDir, "l5b", "s.lock");
      mkdirSync(anonymous, { recursive: true });
      busy = await expectBusy(anonymous, 1_000, 300);
      assert(busy === SESSION_BUSY_MESSAGE,
        "L5: an identity-less lock younger than the stale window is not reclaimed (got " + JSON.stringify(busy) + ")");
      backdate(anonymous, 1_500);
      const release2 = await expectAcquired(anonymous, 1_000, 2_000);
      release2();
      assert(!existsSync(anonymous), "L5: an identity-less lock past the stale window is reclaimed and released");
    }

    // ---------- L6: release/heartbeat only touch a lock that still names us ----------
    {
      const lockDir = join(workDir, "l6", "s.lock");
      const release = await expectAcquired(lockDir, 200, 500);
      // Simulate a reclaim by another holder while our run "continues".
      rmSync(lockDir, { recursive: true, force: true });
      writeFakeOwner(lockDir, 999999, "some-other-host");

      release(); // must not delete the new holder's lock
      assert(existsSync(lockDir), "L6: release does not delete a lock that now names another holder");
      const owner = JSON.parse(readFileSync(ownerFile(lockDir), "utf8"));
      assert(owner.pid === 999999, "L6: the new holder's identity survives the old holder's release");

      rmSync(lockDir, { recursive: true, force: true });
    }

    // ---------- L7: the reclaim path still honours the wait cap ----------
    {
      // A lock that keeps looking reclaimable but never actually gets swept:
      // the directory's owner is unreadable, so age decides, and the age is
      // fresh — no wait, the point is the deadline still fires. Simulate the
      // harder case: a stale lock whose sweep cannot complete because the
      // directory is not removable.
      const lockDir = join(workDir, "l7", "s.lock");
      mkdirSync(lockDir, { recursive: true });
      backdate(lockDir, 10_000); // past any short stale window
      // Make the reclaim rename fail every time by pointing at an unrenameable
      // target: a pre-existing file where the graveyard would go is not needed —
      // instead, drop the parent's write permission is not portable on Windows.
      // Read-only-ness is the portable lever: chmod the directory read-only.
      let release: (() => void) | undefined;
      const waitMs = 400;
      const started = Date.now();
      try {
        chmodSync(lockDir, 0o555);
      } catch { /* not enforced on some platforms */ }
      const busy = await expectBusy(lockDir, 50, waitMs).then((m) => m);
      try { chmodSync(lockDir, 0o755); } catch { /* best effort */ }
      const elapsed = Date.now() - started;
      // Either the sweep failed and the cap fired, or the sweep succeeded and
      // the lock was taken — both are finite. The failure this test guards
      // against is an unbounded loop, which shows up as elapsed >> waitMs.
      assert(elapsed < waitMs + 2_000,
        "L7: the reclaim path never spins past the wait cap (waited " + elapsed + " ms, cap " + waitMs + " ms)");
      if (busy === SESSION_BUSY_MESSAGE) {
        assert(existsSync(lockDir), "L7: a lock the sweep could not remove still exists for the next waiter");
      }
      try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }

    // ---------- L8: reclaim never deletes a lock a competitor just took ----------
    {
      // Two waiters judge the same dead lock reclaimable. The first sweeps it
      // and creates its own; the second's delete must not remove that one.
      // The rename-based sweep makes the loser see ENOENT instead.
      const lockDir = join(workDir, "l8", "s.lock");
      const deadPid = await recentlyDeadPid();
      if (deadPid !== null) {
        writeFakeOwner(lockDir, deadPid, hostname());
        const first = await expectAcquired(lockDir, SESSION_LOCK_STALE_MS, 3_000);
        // The first waiter is now the holder; a second contender must not
        // sweep it even though the previous owner is still dead on paper.
        const busy = await expectBusy(lockDir, SESSION_LOCK_STALE_MS, 300);
        assert(busy === SESSION_BUSY_MESSAGE,
          "L8: a contender does not steal a lock a live competitor just acquired (got " + JSON.stringify(busy) + ")");
        const ownerNow = JSON.parse(readFileSync(ownerFile(lockDir), "utf8"));
        assert(ownerNow.pid === process.pid,
          "L8: the competitor's acquired lock still names its holder (got " + JSON.stringify(ownerNow) + ")");
        first();
      } else {
        assert(false, "L8: could not obtain a recently dead pid to test with");
      }
    }

    // ---------- W1: the runtime holds the lock for the whole run ----------
    {
      const piDir = join(workDir, "w1-pi");
      const runtime = new PiAgentRuntime({
        retriever: new NoopRetriever() as any,
        domain, model, streamFn: slowProvider("W1-ANSWER", 700) as any,
        sessionId: "w1-session", piSessionDir: piDir,
        getApiKey: async () => "probe-key",
      });
      const lockDir = join(piDir, SESSION_LOCKS_DIRNAME, piSessionKey("w1-session") + ".lock");
      const running = drain(runtime.run("W1-QUESTION"));
      let held = false;
      for (let i = 0; i < 40 && !held; i++) {
        await new Promise((r) => setTimeout(r, 50));
        held = existsSync(lockDir) && existsSync(ownerFile(lockDir));
      }
      assert(held, "W1: the lock exists and names an owner while the run is in flight");
      const events = await running;
      assert(events.some((e) => e.type === "done"), "W1: the run completes");
      assert(!existsSync(lockDir), "W1: the lock is cleaned up after the run");
    }

    // ---------- W2: same-process same-session wait has the same cap ----------
    {
      const runtime1 = new PiAgentRuntime({
        retriever: new NoopRetriever() as any,
        domain, model, streamFn: slowProvider("W2-A", 1_200) as any,
        sessionId: "w2-session",
        getApiKey: async () => "probe-key",
      });
      const runtime2 = new PiAgentRuntime({
        retriever: new NoopRetriever() as any,
        domain, model, streamFn: slowProvider("W2-B", 50) as any,
        sessionId: "w2-session",
        sessionLock: { waitMs: 300 },
        getApiKey: async () => "probe-key",
      });
      const first = drain(runtime1.run("W2-A-QUESTION"));
      // Give the first run a moment to take its slot before contending.
      await new Promise((r) => setTimeout(r, 200));
      const events = await drain(runtime2.run("W2-B-QUESTION"));
      const busyEvent = events.find((e) => e.type === "error");
      assert(busyEvent?.message === SESSION_BUSY_MESSAGE,
        "W2: a same-process contender outliving the wait cap gets session busy (got " + JSON.stringify(busyEvent) + ")");
      assert(!events.some((e) => e.type === "done"),
        "W2: the busy contender reports no completion");
      const firstEvents = await first;
      assert(firstEvents.some((e) => e.type === "done"),
        "W2: the holder's run is unaffected by the contender's timeout");
    }

    // ---------- W3: different sessions run in parallel ----------
    {
      // Both runs take their lock and reach the provider before either
      // finishes: with a shared per-key lock the second would sit in the
      // queue and its provider call would start after the first ended.
      const piDir = join(workDir, "w3-pi");
      // Record when each run's provider call is in flight: serialized runs
      // never have both intervals open at once, parallel ones do.
      const windows: Array<{ name: string; start: number; end: number }> = [];
      const timed = (name: string) => (text: string, delayMs: number) => {
        const inner = slowProvider(text, delayMs);
        return async (...args: any[]) => {
          const entry = { name, start: Date.now(), end: Number.POSITIVE_INFINITY };
          windows.push(entry);
          const stream = await (inner as any)(...args);
          entry.end = Date.now();
          return stream;
        };
      };
      const a = new PiAgentRuntime({
        retriever: new NoopRetriever() as any,
        domain, model, streamFn: timed("a")("W3-A", 900) as any,
        sessionId: "w3-a", piSessionDir: piDir,
        getApiKey: async () => "probe-key",
      });
      const b = new PiAgentRuntime({
        retriever: new NoopRetriever() as any,
        domain, model, streamFn: timed("b")("W3-B", 900) as any,
        sessionId: "w3-b", piSessionDir: piDir,
        getApiKey: async () => "probe-key",
      });
      const [aEvents, bEvents] = await Promise.all([drain(a.run("W3-A-QUESTION")), drain(b.run("W3-B-QUESTION"))]);
      assert(aEvents.some((e) => e.type === "done") && bEvents.some((e) => e.type === "done"),
        "W3: both sessions complete");
      const wa = windows.find((w) => w.name === "a");
      const wb = windows.find((w) => w.name === "b");
      assert(wa != null && wb != null && wa.start < wb.end && wb.start < wa.end,
        "W3: the two sessions' provider calls overlap — different sessions are not serialized "
        + JSON.stringify(windows));
      const locksDir = join(piDir, SESSION_LOCKS_DIRNAME);
      assert(!existsSync(locksDir) || readdirSync(locksDir).length === 0,
        "W3: both locks are cleaned up");
    }

    // The lock directory keeps only per-session subdirectories.
    const locksDirs = readdirSync(join(workDir, "w1-pi", SESSION_LOCKS_DIRNAME), { recursive: false });
    assert(locksDirs.length === 0, "post: no lock artefacts are left behind (got " + JSON.stringify(locksDirs) + ")");
  } finally {
    try { rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\nSession lock tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Session lock test threw:", e);
  process.exit(1);
});
