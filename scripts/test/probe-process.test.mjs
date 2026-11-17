import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PROBE_CLEANUP_FAILED, runProbeProcess } from "../probe-process.mjs";

// Native process ownership checks only; no model/search response samples.
async function withScript(source, check) {
  const dir = mkdtempSync(join(tmpdir(), "ans-probe-tree-"));
  const file = join(dir, "probe.mjs");
  writeFileSync(file, source);
  let preserve = false;
  try { await check(file); }
  catch (error) { preserve = error.code === PROBE_CLEANUP_FAILED; throw error; }
  finally { if (!preserve) rmSync(dir, { recursive: true, force: true }); }
}

test("probe success preserves its output and exit status", async () => {
  await withScript('console.log("probe-ok");', async (file) => {
    const result = await runProbeProcess(file);
    assert.equal(result.status, 0);
    assert.equal(result.timedOut, false);
    assert.match(result.stdout, /probe-ok/);
  });
});

test("probe failure stays a failure", async () => {
  await withScript('process.exitCode = 7;', async (file) => {
    const result = await runProbeProcess(file);
    assert.equal(result.status, 7);
    assert.equal(result.timedOut, false);
  });
});

test("timeout removes the probe and its ready descendant, including a stopped POSIX child", { timeout: 20000 }, async () => {
  await withScript(`
    import { spawn } from "node:child_process";
    import { fileURLToPath } from "node:url";
    if (process.argv[2] === "child") {
      process.on("SIGTERM", () => {});
      setInterval(() => {}, 1000);
      process.send("ready");
    } else {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "child"], {
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      });
      child.on("message", () => {
        if (process.platform !== "win32") process.kill(child.pid, "SIGSTOP");
        console.log(JSON.stringify({ probe: process.pid, descendant: child.pid }));
      });
      setInterval(() => {}, 1000);
    }
  `, async (file) => {
    const result = await runProbeProcess(file, [], { timeoutMs: 5000 });
    assert.equal(result.timedOut, true);
    assert.equal(result.status, null);
    assert.equal(result.error?.code, "ETIMEDOUT");
    // The handshake proves the descendant existed before the timeout.
    const owned = JSON.parse(result.stdout.trim());
    for (const pid of [owned.probe, owned.descendant]) {
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    }
  });
});
