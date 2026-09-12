// ADR-0059 D7 (T-6.3): plugin server trust-boundary contract.
// Six measures: loopback Host whitelist, Origin check (no Origin = native client = allow),
// auto-generated 256-bit token, timing-safe compare, readBody <= 1MB, 403-before-401 ordering.
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.join(__dirname, "..");
const TOKEN = "sec-test-token";

let passed = 0, failed = 0;
function check(cond, msg) { if (!cond) { failed++; console.error("FAIL: " + msg); return; } passed++; }

const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const addr = probe.address();
    const p = addr && typeof addr === "object" ? addr.port : 0;
    probe.close(() => resolve(p));
  });
});

const proc = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
  cwd: PLUGIN_ROOT,
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32",
  env: { ...process.env, ANS_SERVER_PORT: String(port), ANS_SERVER_TOKEN: TOKEN },
});
const exited = new Promise((r) => proc.once("exit", () => r()));
const url = "http://127.0.0.1:" + port + "/health";

// raw HTTP over a socket so the Host header can be forged (fetch cannot set Host)
function rawRequest(lines) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    let buf = "";
    sock.setTimeout(5000, () => { sock.destroy(); resolve(buf); });
    sock.on("connect", () => sock.write(lines.join("\r\n") + "\r\n\r\n"));
    sock.on("data", (d) => { buf += d.toString("utf8"); });
    sock.on("end", () => resolve(buf));
    sock.on("error", () => resolve(buf));
  });
}
const statusOf = (raw) => { const m = raw.match(/^HTTP\/1\.\d (\d{3})/); return m ? Number(m[1]) : 0; };

try {
  let ready = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { headers: { Authorization: "Bearer " + TOKEN } });
      if (r.status === 200) { ready = true; break; }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  check(ready, "server became ready with a valid token");

  const okRes = await fetch(url, { headers: { Authorization: "Bearer " + TOKEN } });
  check(okRes.status === 200, "valid token -> 200 (got " + okRes.status + ")");
  check(okRes.headers.get("access-control-allow-origin") === null, "no Origin -> no CORS header (never *)");

  check((await fetch(url)).status === 401, "missing token -> 401");
  check((await fetch(url, { headers: { Authorization: "Bearer sec-test-tokeX" } })).status === 401, "same-length wrong token -> 401");
  check((await fetch(url, { headers: { Authorization: "Bearer sec-test-toke" } })).status === 401, "token prefix -> 401");

  const crossSite = await fetch(url, { headers: { Origin: "http://evil.example" } });
  check(crossSite.status === 403, "non-loopback Origin without token -> 403 before 401 (got " + crossSite.status + ")");

  const localOrigin = "http://localhost:5173";
  const okOrigin = await fetch(url, { headers: { Origin: localOrigin, Authorization: "Bearer " + TOKEN } });
  check(okOrigin.status === 200, "loopback Origin + valid token -> 200");
  check(okOrigin.headers.get("access-control-allow-origin") === localOrigin, "loopback Origin is reflected (not *)");

  const rebound = await rawRequest([
    "GET /health HTTP/1.1",
    "Host: evil.example",
    "Authorization: Bearer " + TOKEN,
    "Connection: close",
  ]);
  check(statusOf(rebound) === 403, "non-loopback Host -> 403 (got " + statusOf(rebound) + ")");

  const big = "x".repeat(1024 * 1024 + 64);
  const bigRes = await fetch("http://127.0.0.1:" + port + "/index", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: JSON.stringify({ projectPath: "/tmp", toolName: "t", entries: [{ title: big }] }),
  });
  check(bigRes.status === 413, "body > 1MB -> 413 (got " + bigRes.status + ")");
} finally {
  const pid = proc.pid;
  if (pid) {
    if (process.platform === "win32") {
      const { spawnSync } = await import("node:child_process");
      try { spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ }
    } else {
      try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
    }
  }
  await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
}

console.log("plugin-security.test: " + passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
