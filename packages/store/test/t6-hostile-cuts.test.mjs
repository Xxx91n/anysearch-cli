// ADR-0059 D7 (T-6): the four hostile-review cuts, asserted at the seam each one moved.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) { failed++; console.error("FAIL: " + msg); return; } passed++; }

// --- cut 1: engine dead config fixed by DOCUMENTATION + a wiring assertion ---
const engine = read("packages/kernel/src/engine.ts");
assert(engine.includes("graceWindowMs"), "engine still declares graceWindowMs");
assert(engine.includes("Full grace-window abort would need a custom race"), "engine keeps its honest debt note (ADR-0014)");
assert(!/够数即收[\s\u00a0]*[+＋][\s\u00a0]*grace window/.test(read("CONTEXT.md")), "CONTEXT.md no longer claims an implemented grace window");
assert(read("CONTEXT.md").includes("grace-window 早停尚未接线"), "CONTEXT.md states the deferral honestly");
assert(read("docs/adr/0005-architecture-grill-round-2.md").includes("r58 Text Errata"), "ADR-0005 carries the append-only errata");
assert(read("scripts/ship-gate.mjs").includes("stepDocClaims"), "ship-gate wires the dead-config wiring assertion");

// --- cut 2: doctor prints the real version ---
const doctor = read("apps/cli/src/commands/doctor.ts");
assert(doctor.includes("__PACKAGE_VERSION__"), "doctor uses the tsup build-time define");
assert(!doctor.includes('path.resolve(here, "..", "..", "package.json")'), "doctor no longer reads package.json at runtime");

// --- cut 3: plugin server trust boundary (six measures) ---
const server = read("apps/plugin/src/server/index.ts");
assert(server.includes("hostIsLoopback") && server.includes("originIsLoopback"), "loopback Host + Origin whitelist wired");
assert(server.includes("timingSafeEqual"), "constant-time bearer compare wired");
assert(server.includes("MAX_BODY_BYTES = 1024 * 1024"), "1MB body cap wired");
assert(server.indexOf("403") < server.indexOf("401"), "403 check precedes the 401 challenge");
assert(!server.includes('Access-Control-Allow-Origin", "*"'), "no wildcard CORS");
assert(read("apps/plugin/src/server/token.ts").includes("randomBytes(32)"), "256-bit token generated when ANS_SERVER_TOKEN is unset");
assert(fs.existsSync(path.join(root, "apps/plugin/test/plugin-security.test.mjs")), "security contract test exists");

// --- cut 4: api.anysearch.com deferred WITH a deadline, owner, and monitoring channel ---
const provider = read("packages/retriever/src/providers/anysearch.ts");
assert(provider.includes("DEFERRED-WITH-DEADLINE"), "anysearch.ts carries the deferral annotation");
const reg = JSON.parse(read("docs/deferred-registry.json"));
const entry = reg.entries.find((e) => e.id === "defer-anysearch-domain-ownership");
assert(!!entry, "deferred registry records the domain-ownership item");
assert(!!entry && !!entry.owner && !!entry.deadline && !!entry.review_cadence, "the deferral names an owner, a deadline, and a review cadence");
assert(!!entry && !!entry.monitoring_channel, "the deferral names a monitoring channel");

console.log("t6-hostile-cuts.test: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
