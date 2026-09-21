// R75 T2 (ADR-0076 / D-003): static guardrails for the transformers ghost-dep patch.
// The upstream trigger half-fired (4.3.0 still ships a top-level bare
// require("onnxruntime-common") with no manifest declaration), so the scoped
// Module._resolveFilename patch in src/index.ts stays — and the two invariants it
// depends on are asserted here instead of living as comments:
//   (a) no code path may load @huggingface/transformers except through
//       createRequire().require() — static import / import-from / export-from /
//       dynamic import() bypass the CJS-only patch and would hit the ghost dep
//       unguarded (the ESM resolver cannot be scoped without loader hooks);
//   (b) version-pairing contract — our self-declared optionalDependencies copy of
//       onnxruntime-common must equal the version the *effective* onnxruntime-node
//       embeds, or consumers get Tensor-class dual instances (drift, not a crash).
// Plain-script style matching embedding.test.ts (node --test treats the file as the test).
import assert from "node:assert";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(HERE, "..");
const SRC_DIR = join(PKG_DIR, "src");
const SPEC = "@huggingface/transformers";

// R75 audit F-3 hardening: quote class includes the template backtick
// (import(`…`) was an escape path), and the specifier tail accepts "/" so
// subpath specifiers (@huggingface/transformers/<sub>) can't slip past.
const QT = `["'\`]`; // ' " `
const SPEC_RE = SPEC.replace("/", "\\/"); // scope slash escaped once, reused below
const SPEC_TAIL = `(?:${QT}|/)`;
const BANNED: [RegExp, string][] = [
  [new RegExp(`\\bfrom\\s*${QT}${SPEC_RE}${SPEC_TAIL}`), "import/export … from"],
  [new RegExp(`\\bimport\\s*${QT}${SPEC_RE}${SPEC_TAIL}`), "side-effect import"],
  [new RegExp(`\\bimport\\s*\\(\\s*${QT}${SPEC_RE}${SPEC_TAIL}`), "dynamic import()"],
];
// R75 audit F-4: the export-* case needs no own pattern — `export * from "…"`
// already matches the `from` leg above.
// R75 audit F-5 (backlog, deliberate strictness): `import type … from` also goes
// red — type-level coupling routes through the exempted `typeof import("…")`
// query form (see TransformersModule in src/index.ts), keeping the invariant
// absolute: exactly one legal load entry, zero exceptions to reason about.

function listSrcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listSrcFiles(p));
    else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Strip line/block comments and `typeof import("…")` type queries (type-level,
// erased at compile time — the legal usage on the TransformersModule typedef).
// Known residual blind spot (R75 audit F-3, documented not fixed): a "//" inside
// a same-line string literal makes the naive stripper eat the rest of that line,
// hiding an import appended after it. Accepted deliberately — separating "//"
// from a /regex/ opener needs a real tokenizer, and this guard exists to catch
// the footgun (a contributor adding a transformers import), not an adversary
// evading a linter.
function stripInert(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/typeof\s+import\s*\(/g, "typeof (");
}

// Returns the violating form label, or null when the source is clean.
function findBareSpecifier(src: string): string | null {
  const stripped = stripInert(src);
  for (const [re, label] of BANNED) if (re.test(stripped)) return label;
  return null;
}

// Locate the installed @huggingface/transformers this workspace would load.
// Primary: the importer symlink (createRequire anchored at our package.json —
// the published-consumer shape). Fallback: scan the pnpm virtual store, because
// pnpm 11 does not materialize a workspace package's optionalDependencies into
// its own node_modules (observed: lockfile records them, .pnpm carries them,
// packages/embedding/node_modules lacks the link — R75 T2 empirical).
// R75 audit F-6 (backlog): the store scan takes the first directory match — with
// several transformers versions co-installed the pick is nondeterministic; fine
// while the workspace carries exactly one (the pairing leg asserts on whatever
// copy the store holds, which is the same copy the runtime patch would alias).
function transformersEntry(): string | null {
  const selfRequire = createRequire(join(PKG_DIR, "package.json"));
  try {
    return selfRequire.resolve(SPEC);
  } catch { /* fall through to virtual-store scan */ }
  const store = join(PKG_DIR, "..", "..", "node_modules", ".pnpm");
  try {
    for (const d of readdirSync(store)) {
      if (!d.startsWith("@huggingface+transformers@")) continue;
      const entry = join(store, d, "node_modules", SPEC, "dist", "transformers.node.cjs");
      if (existsSync(entry)) return entry;
    }
  } catch { /* no store — treat as absent */ }
  return null;
}

// Resolve the onnxruntime-node copy that the installed @huggingface/transformers
// would actually load (createRequire anchored at transformers' own entry — same
// scope the runtime patch reasons about), then walk up to its package.json.
// (F-6 backlog: the ≤6-level walk-up bound is a magic constant sized for the
// .pnpm layout — dist/index.js → package root is 2; 6 leaves headroom for
// nested entry shapes without unbounded ascent.)
function effectiveOrtCommonVersion(): string | null {
  const tfEntry = transformersEntry();
  if (!tfEntry) return null; // optional dep absent (e.g. --no-optional install) — invariant vacuous
  const tfRequire = createRequire(tfEntry);
  let ortEntry: string;
  try {
    ortEntry = tfRequire.resolve("onnxruntime-node");
  } catch {
    return null; // transformers present without onnxruntime-node — nothing to pair with
  }
  let dir = dirname(ortEntry);
  for (let i = 0; i < 6; i++) {
    const pj = join(dir, "package.json");
    if (existsSync(pj)) {
      const manifest = JSON.parse(readFileSync(pj, "utf8"));
      if (manifest.name === "onnxruntime-node") {
        return manifest.dependencies?.["onnxruntime-common"] ?? null;
      }
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

async function main(): Promise<void> {
  // Guard (a): no bare specifier anywhere under src/.
  const files = listSrcFiles(SRC_DIR);
  assert.ok(files.length > 0, "src tree must not be empty (guard would pass vacuously)");
  for (const f of files) {
    const label = findBareSpecifier(readFileSync(f, "utf8"));
    assert.ok(label === null, `${f}: bare ${label} "${SPEC}" is forbidden — the only legal entry is createRequire().require() (ADR-0076)`);
  }
  console.log(`ghost-dep guard (a): ${files.length} src file(s) clean — ${SPEC} reachable only via createRequire().require()`);

  // Guard (a′): violation corpus — every sample MUST be flagged, and the legal
  // forms MUST NOT. Permanent CI self-proof that the escapes go red (R75 audit
  // F-3 closed three escape paths found by a 14-case external probe).
  const violations: [string, string][] = [
    [`import { pipeline } from "${SPEC}";`, "static import-from"],
    [`import "${SPEC}";`, "side-effect import"],
    [`export * from "${SPEC}";`, "export * from"],
    [`const m = await import("${SPEC}");`, "dynamic import() double-quote"],
    ["const m = await import('" + SPEC + "');", "dynamic import() single-quote"],
    ["const m = await import(`" + SPEC + "`);", "dynamic import() template"],
    [`import { pipeline } from "${SPEC}/sub/path";`, "subpath import-from"],
    [`const m = await import("${SPEC}/node");`, "subpath dynamic import()"],
    [`import type { Pipeline } from "${SPEC}";`, "import type (deliberate strictness, F-5)"],
  ];
  for (const [src, name] of violations) {
    assert.ok(findBareSpecifier(src) !== null, `violation corpus not flagged: ${name}`);
  }
  const legal: [string, string][] = [
    [`type T = typeof import("${SPEC}");`, "typeof import() type query"],
    [`const m = selfRequire("${SPEC}");`, "createRequire entry"],
    [`// import x from "${SPEC}"`, "line comment mention"],
    [`/* import x from "${SPEC}" */`, "block comment mention"],
    [`import { x } from "@huggingface/transformers-other";`, "different package sharing the prefix"],
  ];
  for (const [src, name] of legal) {
    assert.ok(findBareSpecifier(src) === null, `legal form falsely flagged: ${name}`);
  }
  console.log(`ghost-dep guard (a′): ${violations.length} violation samples flagged, ${legal.length} legal forms clean`);

  // Guard (b): version-pairing contract.
  const manifest = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));
  const declared = manifest.optionalDependencies?.["onnxruntime-common"];
  assert.ok(declared, "optionalDependencies['onnxruntime-common'] must stay declared while the patch lives");
  const effective = effectiveOrtCommonVersion();
  if (effective === null) {
    // F-6 backlog: one SKIP line covers three distinct causes (transformers
    // absent / onnxruntime-node absent / manifest not found) — acceptable while
    // the message says which resolution chain was attempted.
    console.log("ghost-dep guard (b): SKIP — @huggingface/transformers/onnxruntime-node not installed (optional dep); pairing invariant vacuously held");
    return;
  }
  assert.strictEqual(
    declared,
    effective,
    `version-pairing contract broken: optionalDependencies['onnxruntime-common']=${declared} but the effective onnxruntime-node embeds onnxruntime-common@${effective} — re-pin to match (ADR-0076)`
  );
  console.log(`ghost-dep guard (b): declared ${declared} ≡ effective onnxruntime-node embedded ${effective}`);
  console.log("transformers-ghost-dep.test: all assertions passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
