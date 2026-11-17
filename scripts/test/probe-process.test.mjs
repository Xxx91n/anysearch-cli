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

function assertExited(owned) {
  const alive = [];
  for (const pid of [owned.probe, owned.descendant]) {
    try { process.kill(pid, 0); alive.push(pid); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  // A failing regression must not leave its own fixture running in CI.
  for (const pid of alive) {
    try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
  }
  assert.deepEqual(alive, [], "probe left processes running: " + alive.join(", "));
}

for (const status of [0, 7]) {
  test("probe exit " + status + " removes a descendant whose stdio is closed", { timeout: 30000 }, async () => {
    await withScript(`
      import { spawn } from "node:child_process";
      import { fileURLToPath } from "node:url";
      if (process.argv[2] === "child") {
        process.on("SIGTERM", () => {});
        setInterval(() => {}, 1000);
        process.send("ready");
      } else {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "child"], {
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
        child.on("message", () => {
          console.log(JSON.stringify({ probe: process.pid, descendant: child.pid }));
          process.exit(${status});
        });
      }
    `, async (file) => {
      const result = await runProbeProcess(file);
      assert.equal(result.status, status);
      assert.equal(result.timedOut, false);
      assertExited(JSON.parse(result.stdout.trim()));
    });
  });
}

test("timeout removes the probe and its ready descendant, including a stopped POSIX child", { timeout: 45000 }, async () => {
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
    assertExited(owned);
  });
});
