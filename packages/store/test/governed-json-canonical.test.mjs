// ADR-0077 (R76 T0 / D-003): governed-JSON canonical lock — fixture-level
// red/green contract for ship-gate step 1's stepGovernedJsonCanonical leg.
// Green = canonical bytes pass; red = reindented/reordered/trailing-garbage
// bytes fail with "first differs at line N" + the paste-able normalize command;
// invalid JSON reports on its own without the normalize pointer.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJsonBytes, firstDifferingLine, normalizeCommand, governedJsonViolation } from "../../../scripts/governed-json.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..", "..");

let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) { failed++; console.error("FAIL: " + msg); return; } passed++; }

// --- canonical roundtrip -----------------------------------------------------
const obj = { b: 1, a: { z: [1, 2], y: "x" } };
const canon = canonicalJsonBytes(JSON.stringify(obj));
assert(canon.equals(Buffer.from(JSON.stringify(obj, null, 1) + "\n")), "canonical form is JSON.stringify(_,null,1)+newline");
assert(canonicalJsonBytes(canon).equals(canon), "canonical form is a fixed point (roundtrip-stable)");
assert(canonicalJsonBytes(JSON.stringify(obj, null, 2)).equals(canon), "2-space input normalizes to the same canonical bytes");

// --- firstDifferingLine ------------------------------------------------------
assert(firstDifferingLine(Buffer.from("a\nb\nc"), Buffer.from("a\nB\nc")) === 2, "firstDifferingLine reports the diverging line");
assert(firstDifferingLine(Buffer.from("x"), Buffer.from("x\ny")) === 1, "length-difference divergence reports the last shared line");

// --- violation messages ------------------------------------------------------
assert(governedJsonViolation("f.json", canon) === null, "canonical bytes pass");

const reindented = Buffer.from(JSON.stringify(obj, null, 8) + "\n");
const v1 = governedJsonViolation("docs/deferred-registry.json", reindented);
assert(v1 !== null && v1.includes("not in canonical form"), "8-space reindent is red");
assert(v1.includes("first differs at line 2"), "8-space reindent reports first-differs line (got: " + v1 + ")");
assert(v1.includes(normalizeCommand("docs/deferred-registry.json")), "red message carries the paste-able normalize command");
assert(v1.includes("CANONICAL_JSON_FILES"), "red message names the governed-list constant (list-rot guard)");

// byte-level equality catches *format* rearrangement a semantic compare
// misses — the two real incidents were whole-file reindents (1->8, 1->4 space)
// that JSON.stringify deep-equality would call identical.
const reformatted = Buffer.from(JSON.stringify(obj, null, 4) + "\n");
const v2 = governedJsonViolation("f.json", reformatted);
assert(v2 !== null && v2.includes("first differs at line"), "same-JSON-different-bytes drift is red (semantic compare would miss it)");
assert(JSON.stringify(JSON.parse(String(reformatted))) === JSON.stringify(obj), "the red fixture is deep-equal to the canonical content — byte assertion caught what a semantic one cannot");
// key-order semantics (ADR-0077): canonicalization preserves the file's own
// V8 insertion order — it must NOT sort, or normalize would silently reorder.
assert(canonicalJsonBytes('{"b":1,"a":2}').toString().startsWith('{\n "b": 1,'), "canonicalization preserves insertion order (no sorted serialization)");

const v3 = governedJsonViolation("f.json", Buffer.from("{ not json"));
assert(v3 !== null && v3.includes("not valid JSON"), "invalid JSON is red");
assert(!v3.includes("normalize:"), "invalid JSON does not print the normalize pointer");

// --- the real governed file is canonical right now ---------------------------
const real = fs.readFileSync(path.join(root, "docs", "deferred-registry.json"));
assert(governedJsonViolation("docs/deferred-registry.json", real) === null, "docs/deferred-registry.json is canonical on disk");
assert(JSON.parse(String(real)).note.includes("Canonical form locked"), "registry note self-documents the lock");

// --- the leg is wired into ship-gate (a dropped assertion = a dropped gate) --
const sg = fs.readFileSync(path.join(root, "scripts", "ship-gate.mjs"), "utf8");
assert(sg.includes("stepGovernedJsonCanonical"), "ship-gate wires stepGovernedJsonCanonical");
assert(sg.includes('CANONICAL_JSON_FILES = ["docs/deferred-registry.json"]'), "ship-gate carries the hardcoded governed list");

console.log("governed-json-canonical.test: " + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
