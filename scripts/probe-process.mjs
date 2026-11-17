// Run one installation probe in its own process group. Only this probe and its
// descendants may be stopped; no machine-wide process discovery is involved.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PROBE_CLEANUP_FAILED = "ANS_PROBE_CLEANUP_FAILED";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for actual process/pipe closure without leaving a timer behind. */
async function waitClosed(closed) {
  let timer;
  try {
    return await Promise.race([
      closed,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("probe process tree did not close after termination")), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Stop this detached POSIX group, or this Windows process tree, and reap it. */
async function stopTree(child, closed) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve, reject) => {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          stdio: "ignore", signal: AbortSignal.timeout(5000),
        });
        killer.once("error", reject);
        killer.once("close", (code) => {
          if (code === 0 || child.exitCode !== null || child.signalCode !== null) resolve();
          else reject(new Error("could not terminate probe process tree (taskkill exit " + code + ")"));
        });
      });
    }
    await waitClosed(closed);
    return;
  }

  const signalGroup = (signal) => {
    try { process.kill(-child.pid, signal); return true; }
    catch (error) {
      if (error.code === "ESRCH") return false;
      // Design: retry Darwin EPERM as still present — killpg1 excludes zombie
      // members, so a draining group can return EPERM. Only ESRCH proves it gone;
      // persistent permission errors still fail the bounded cleanup below.
      if (process.platform === "darwin" && error.code === "EPERM") return true;
      throw error;
    }
  };
  if (signalGroup("SIGTERM")) {
    // A stopped MCP cannot act on SIGTERM until it resumes. Escalate as well,
    // so a descendant ignoring SIGTERM cannot outlive the timed-out probe.
    signalGroup("SIGCONT");
    await pause(100);
    signalGroup("SIGKILL");
  }
  await waitClosed(closed);
  const deadline = Date.now() + 5000;
  while (signalGroup(0)) {
    if (Date.now() >= deadline) throw new Error("probe process group did not exit after termination");
    await pause(25);
  }
}

/** Capture a probe result and finish tree cleanup before returning to its caller. */
export async function runProbeProcess(file, args = [], { cwd, env = process.env, timeoutMs = 90000 } = {}) {
  const windows = process.platform === "win32";
  const receiptDir = windows ? mkdtempSync(join(tmpdir(), "ans-probe-receipt-")) : undefined;
  const receiptPath = windows ? join(receiptDir, "result.json") : undefined;
  // Design: Windows probes use an owned job — taskkill loses descendants
  // after their parent exits; job ownership starts before the probe resumes.
  const executable = windows ? "powershell.exe" : process.execPath;
  const argv = windows ? [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
    fileURLToPath(new URL("./probe-job.ps1", import.meta.url)),
    "-NodeExe", process.execPath,
    "-Payload", Buffer.from(JSON.stringify([file, ...args])).toString("base64"),
    "-TimeoutMs", String(timeoutMs), "-ReceiptPath", receiptPath,
  ] : [file, ...args];
  const child = spawn(executable, argv, {
    cwd, env, detached: !windows, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => {
    child.once("error", (error) => resolve({ status: null, error }));
    child.once("exit", (status, signal) => resolve({ status, signal }));
  });
  const closed = new Promise((resolve) => child.once("close", resolve));
  let timer;
  let timedOut = false;
  let waitError;
  try {
    await Promise.race([
      // Exit starts cleanup; it is not proof the descendants or pipes closed.
      exited,
      new Promise((resolve) => {
        // The job enforces the probe deadline. Allow time to start PowerShell
        // and drain the job; an unresponsive supervisor is a cleanup failure.
        timer = setTimeout(() => { timedOut = true; resolve(); }, timeoutMs + (windows ? 20000 : 0));
      }),
    ]);
  } catch (error) {
    waitError = error;
  } finally {
    clearTimeout(timer);
  }
  // Cleanup uncertainty takes priority, but never throws from a finally block.
  try {
    await stopTree(child, closed);
  } catch (error) {
    throw Object.assign(new Error("probe cleanup could not be confirmed: " + error.message, { cause: error }), {
      code: PROBE_CLEANUP_FAILED,
    });
  }
  let result = await exited;
  if (windows) {
    // Design: a private result file carries the job receipt — stderr belongs
    // entirely to the probe and need not end in a newline or follow a schema.
    try {
      if (timedOut || result.status !== 0) throw new Error(stderr || "probe supervisor did not finish");
      const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
      if (!Number.isInteger(receipt.status) || receipt.status < 0 || receipt.status > 0xffffffff ||
          typeof receipt.timedOut !== "boolean") throw new Error("invalid job receipt");
      result = receipt;
      timedOut = receipt.timedOut;
    } catch (error) {
      throw Object.assign(new Error("Windows probe cleanup could not be confirmed: " + error.message, { cause: error }), {
        code: PROBE_CLEANUP_FAILED,
      });
    }
    rmSync(receiptDir, { recursive: true, force: true });
  }
  if (waitError) throw waitError;
  return {
    ...result, stdout, stderr, timedOut,
    ...(timedOut ? { status: null, error: Object.assign(new Error("protocol probe timed out"), { code: "ETIMEDOUT" }) } : {}),
  };
}
