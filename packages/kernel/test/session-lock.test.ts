// Cross-process session lock (#266, D12).
//
// The lock's own rules, verified without spawning MCP servers:
//   L1 defaults and bounds — the engineering values are the production ones
//      (10 min stale, no automatic wait) and the heartbeat cadence is clamped;
//   L2 mutual exclusion in one process, plus busy after the wait cap;
//   L3 a live local owner is never reclaimed, however old its heartbeat is —
//      and neither is one whose pid the probe cannot classify, until that
//      owner's heartbeat goes stale (#576);
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

/**
 * The busy answer for `lockDir`, worded for what the probe said: `alive` gets
 * the recycled-pid way out, `gone` must not ask for a wait, `anonymous` has no
 * "that process" to name, and `unconfirmed` is the shared sentence.
 */
function busyAt(
  busy: string | undefined,
  lockDir: string,
  kind: "alive" | "gone" | "anonymous" | "unconfirmed" = "unconfirmed",
): boolean {
  if (busy === undefined || !busy.includes(lockDir)) return false;
  switch (kind) {
    case "alive":
      return busy.includes("(still running") && busy.includes("no longer belongs to that run");
    case "gone":
      // The marker survives; the "retry after it finishes" tail must not.
      return busy.startsWith("Session is busy: ")
        && busy.includes("That process is gone")
        && !busy.includes(SESSION_BUSY_MESSAGE);
    case "anonymous":
      return busy.includes("nobody is using it");
    default:
      return busy.startsWith(SESSION_BUSY_MESSAGE) && busy.includes("If you are sure that process is gone");
  }
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
      usage: {
        input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
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
      assert(SESSION_LOCK_WAIT_MS === 0, "L1: same-session collisions do not wait by default");
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
      assert(busyAt(busy, lockDir, "alive"),
        "L2: a contender outliving the wait cap gets the session-busy error (got " + JSON.stringify(busy) + ")");
      assert(busy !== undefined && busy.includes("pid " + process.pid),
        "L2: the busy message names the holder's pid (got " + JSON.stringify(busy) + ")");
      assert(busy !== undefined && busy.includes("still running"),
        "L2: a holder this machine can see running is not offered a manual clear (got " + JSON.stringify(busy) + ")");

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
      assert(busyAt(busy, lockDir, "alive"),
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
      assert(busyAt(busy, foreign),
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
      assert(busyAt(busy, anonymous, "anonymous"),
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
      // A stale lock whose sweep cannot succeed, every poll, until the cap.
      // A read-only lock DIRECTORY does not stop the rename (the parent stays
      // writable on Linux and Windows), so the failure has to come from the
      // rename itself: remove the parent's write permission. That is the
      // portable lever for this platform pair — on a filesystem that ignores
      // mode bits the test still passes because the sweep then succeeds and
      // the acquisition is simply finite either way. Either outcome is
      // checked; what must never happen is waiting past the cap.
      const parent = join(workDir, "l7");
      const lockDir = join(parent, "s.lock");
      mkdirSync(lockDir, { recursive: true });
      backdate(lockDir, 10_000); // past any short stale window
      const waitMs = 400;
      let busy: string | undefined;
      let elapsed = 0;
      const started = Date.now();
      try { chmodSync(parent, 0o555); } catch { /* not enforced here */ }
      try {
        busy = await expectBusy(lockDir, 50, waitMs);
      } finally {
        try { chmodSync(parent, 0o755); } catch { /* best effort */ }
        elapsed = Date.now() - started;
      }
      // The cap is the contract: a failing sweep must return "session busy",
      // not retry forever (#266: the wait has an upper bound).
      assert(elapsed < waitMs + 2_000,
        "L7: the reclaim path never spins past the wait cap (waited " + elapsed + " ms, cap " + waitMs + " ms)");
      if (!existsSync(lockDir)) {
        // The sweep won: the lock was taken, which is also finite. Nothing
        // further to assert — the important case is the one below.
        assert(true, "L7: the sweep succeeded and the acquisition was bounded");
      } else {
        assert(busyAt(busy, lockDir, "anonymous"),
          "L7: when the sweep cannot remove the lock, the wait ends as session busy (got "
          + JSON.stringify(busy) + ")");
        assert(existsSync(lockDir), "L7: a lock the sweep could not remove still exists for the next waiter");
      }
      try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }

    // ---------- L8: a sweep that loses the race leaves the winner's lock intact ----------
    {
      // The interleaving this guards: waiter W reads the dead holder and
      // decides to sweep; before its rename lands, another waiter sweeps and
      // installs its own lock. W's rename must then fail with ENOENT and touch
      // nothing — the replacement keeps the session. Driving two real
      // processes into that gap needs a barrier between "decided" and "renamed"
      // (the MCP multi-process suite owns the honest version); here the same
      // end state is built directly: the lock that exists is not the one the
      // stale judgement was about.
      const lockDir = join(workDir, "l8", "s.lock");
      // A stale lock a waiter would sweep on age alone.
      mkdirSync(lockDir, { recursive: true });
      backdate(lockDir, 10_000);
      // The replacement: a foreign holder, so pid is unreadable here and only
      // age decides. Its heartbeat is fresh, so a correct waiter must not
      // sweep it — that is the state a lost rename race would otherwise
      // destroy.
      writeFakeOwner(lockDir, 888888, "another-machine");
      writeFileSync(heartbeatFile(lockDir), String(Date.now()));

      // stale 1 s vs wait 300 ms: the fresh heartbeat cannot age past the
      // window before this waiter gives up, so a sweep would be a bug.
      const busy = await expectBusy(lockDir, 1_000, 300);
      assert(busyAt(busy, lockDir),
        "L8: a fresh replacement lock is not swept by age (got " + JSON.stringify(busy) + ")");
      const ownerNow = JSON.parse(readFileSync(ownerFile(lockDir), "utf8"));
      assert(ownerNow.pid === 888888,
        "L8: the replacement holder's identity survives (got " + JSON.stringify(ownerNow) + ")");
      rmSync(lockDir, { recursive: true, force: true });
    }

    // ---------- L9: a probe that cannot confirm keeps a fresh lock ----------
    {
      // #570: only a same-host ESRCH proves the holder is gone. #576: a probe
      // that cannot classify the pid (ERR_INVALID_ARG_TYPE and the odd Windows
      // failures) is no evidence either way, so the heartbeat decides — a fresh
      // one is still proof of a running holder and the lock stays. What #576
      // changed is only what happens once that heartbeat goes stale (L10).
      const lockDir = join(workDir, "l9", "s.lock");
      writeFakeOwner(lockDir, process.pid, hostname());
      writeFileSync(heartbeatFile(lockDir), String(Date.now()));
      const realKill = process.kill;
      const unconfirmable: typeof process.kill = (pid, signal) => {
        if (pid === process.pid && signal === 0) {
          throw Object.assign(new Error("probe could not classify this pid"), { code: "ERR_INVALID_ARG_TYPE" });
        }
        return realKill(pid, signal);
      };
      process.kill = unconfirmable;
      try {
        const busy = await expectBusy(lockDir, 500, 300);
        assert(busyAt(busy, lockDir),
          "L9: an unconfirmable probe with a fresh heartbeat keeps the lock (got "
          + JSON.stringify(busy) + ")");
        assert(existsSync(ownerFile(lockDir)),
          "L9: the live owner's lock survives a probe the waiter cannot classify");
      } finally {
        process.kill = realKill;
        rmSync(lockDir, { recursive: true, force: true });
      }
    }

    // ---------- L10: an unclassifiable owner ages out like a foreign one ----------
    {
      // #576: a pid the probe cannot classify is no evidence either way, so the
      // heartbeat decides — the same window a foreign host gets. Without this,
      // a lock left behind by a crashed run on a host whose probe keeps failing
      // could only ever be cleared by hand.
      const lockDir = join(workDir, "l10", "s.lock");
      writeFakeOwner(lockDir, 777777777, hostname());
      writeFileSync(heartbeatFile(lockDir), String(Date.now()));
      backdate(heartbeatFile(lockDir), 1_500);
      const realKill = process.kill;
      const unconfirmable: typeof process.kill = (pid, signal) => {
        if (pid === 777777777 && signal === 0) {
          throw Object.assign(new Error("probe could not classify this pid"), { code: "ERR_INVALID_ARG_TYPE" });
        }
        return realKill(pid, signal);
      };
      process.kill = unconfirmable;
      try {
        const release = await expectAcquired(lockDir, 1_000, 2_000);
        const owner = JSON.parse(readFileSync(ownerFile(lockDir), "utf8"));
        assert(owner.pid === process.pid,
          "L10: an owner the probe cannot classify is reclaimed once the heartbeat is stale (got "
          + JSON.stringify(owner) + ")");
        release();
        assert(!existsSync(lockDir), "L10: the reclaimed lock is released cleanly");
      } finally {
        process.kill = realKill;
      }
    }

    // ---------- L11: a dead owner that could not be swept is not told to wait ----------
    {
      // The one path that carries a dead verdict into the busy message: the
      // owner is gone, so the sweep is allowed, but the rename fails (a locked
      // directory, permissions) and the waiter has to give up. "Retry after it
      // finishes" would name a process that no longer exists.
      const deadPid = await recentlyDeadPid();
      if (deadPid !== null) {
        const parent = join(workDir, "l11");
        const lockDir = join(parent, "s.lock");
        writeFakeOwner(lockDir, deadPid, hostname());
        writeFileSync(heartbeatFile(lockDir), String(Date.now()));
        try { chmodSync(parent, 0o555); } catch { /* not enforced here */ }
        let busy: string | undefined;
        try {
          busy = await expectBusy(lockDir, 50, 300);
        } finally {
          try { chmodSync(parent, 0o755); } catch { /* best effort */ }
        }
        if (!existsSync(lockDir)) {
          // The sweep won on this filesystem; there is no busy message to read.
          assert(true, "L11: the sweep succeeded, so no dead-owner message is produced");
        } else {
          assert(busyAt(busy, lockDir, "gone"),
            "L11: a dead owner whose lock could not be swept is told to clear it, not to wait (got "
            + JSON.stringify(busy) + ")");
        }
        try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* best effort */ }
      }
    }

    // ---------- L12: an unprintable lock time costs the message, not the answer ----------
    {
      // A hand-edited owner.json can hold any number. Formatting it must not
      // turn "session busy" into a RangeError the caller cannot recognise.
      const lockDir = join(workDir, "l12", "s.lock");
      mkdirSync(lockDir, { recursive: true });
      writeFileSync(ownerFile(lockDir),
        JSON.stringify({ pid: process.pid, host: hostname(), lockedAt: 1e300 }));
      writeFileSync(heartbeatFile(lockDir), String(Date.now()));
      const busy = await expectBusy(lockDir, 1_000, 300);
      assert(busyAt(busy, lockDir, "alive"),
        "L12: an out-of-range lock time still answers session busy (got " + JSON.stringify(busy) + ")");
      assert(busy !== undefined && !busy.includes("lock taken at"),
        "L12: an out-of-range lock time is left out of the message");
      rmSync(lockDir, { recursive: true, force: true });
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
      const immediate = new PiAgentRuntime({
        retriever: new NoopRetriever() as any,
        domain, model, streamFn: slowProvider("W2-DEFAULT", 50) as any,
        sessionId: "w2-session",
        getApiKey: async () => "probe-key",
      });
      const before = Date.now();
      const refused = await drain(immediate.run("W2-DEFAULT-QUESTION"));
      assert(refused.some(e => e.type === "error" && e.message === SESSION_BUSY_MESSAGE),
        "W2/#317: the same-process runtime refuses by default");
      assert(Date.now() - before < 300, "W2/#317: the default refusal does not queue");
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
