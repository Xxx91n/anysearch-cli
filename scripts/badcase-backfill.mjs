// B4/T3: badcase -> golden 回灌闭环。
//
// node scripts/badcase-backfill.mjs --id docs-bc0001 --into docs-g0007
// attach 模式：把已观测 badcase 标记为 promoted，回指既有 golden 条目
// （同一真实提问的回归证据，不制造重复条目）。
// node scripts/badcase-backfill.mjs --id docs-bc0001 --new
// create 模式：为新提问生成下一条 docs-gNNNN golden 条目，并自动重算
// eval-looks.coverage.json 的 covered 维度计数。只接 answer+mustHit* 的提问（写
// live）；abstain 等需要 stub lane 的条目要有 kernel scenario fixture，本脚本不造，会直接拒绝。
//
// 禁合成护栏：badcase 必须携带 observed + evidence.command（真实观测），
// 否则拒绝回灌。完整 schema/词汇/交叉校验由 packages/store/test/
// eval-docs-golden.test.ts 在 CI 强制执行——本脚本只做结构前置检查。
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BADCASES = join(ROOT, "eval-badcases.json");
const GOLDEN = join(ROOT, "eval-golden.json");
const COVERAGE = join(ROOT, "eval-looks.coverage.json");

function fail(msg) {
  console.error("badcase-backfill: " + msg);
  process.exit(2);
}
function arg(name) {
  const i = process.argv.indexOf("--" + name);
  return i === -1 ? null : process.argv[i + 1];
}

const id = arg("id");
const into = arg("into");
const create = process.argv.includes("--new");
if (!id || (!into && !create)) fail("usage: --id <docs-bcNNNN> (--into <docs-gNNNN> | --new)");

const badcases = JSON.parse(readFileSync(BADCASES, "utf8"));
const bc = (badcases.badcases ?? []).find((b) => b.id === id);
if (!bc) fail("badcase not found: " + id);
if (bc.status !== "open") fail("badcase " + id + " is not open (status=" + bc.status + ")");
// 禁合成护栏：无真实观测不得回灌。
if (!bc.observed || typeof bc.observed.results !== "number") fail(id + " has no observed block — synthetic input refused");
if (!bc.evidence || typeof bc.evidence.command !== "string" || !bc.evidence.command.trim()) fail(id + " has no evidence.command — synthetic input refused");

const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
// Keep this schema literal in sync with DOCS_GOLDEN_SCHEMA in
// packages/store/src/eval/docs-golden.ts; this script runs as plain node.
if (!golden || golden.schema !== "anysearch/docs-golden@1") fail("eval-golden.json schema must be anysearch/docs-golden@1");
if (!Array.isArray(golden.entries) || golden.entries.length === 0) fail("eval-golden.json has no entries");
if (!golden.scopes || typeof golden.scopes !== "object" || Array.isArray(golden.scopes)) fail("eval-golden.json has no scopes object");
if (Object.keys(golden.scopes).length === 0) fail("eval-golden.json scopes must not be empty");
for (const [gid, scope] of Object.entries(golden.scopes)) {
  if (!["stub", "live", "both"].includes(scope)) fail("eval-golden.json scope for " + gid + " must be stub|live|both");
}

if (into) {
  const target = golden.entries.find((e) => e.id === into);
  if (!target) fail("golden target not found: " + into);
  if (target.question.trim() !== bc.question.trim()) fail("question mismatch — attach requires the same verbatim question");
  target.notes = (target.notes ? target.notes + " | " : "") + "badcase " + id + " observed " + bc.observed.results + " results (expected " + bc.expected.verdict + ")";
  bc.status = "promoted";
  bc.promotedTo = into;
  console.log("attached " + id + " -> " + into + " (same-question regression evidence)");
} else {
  // 禁分类编造：--new 不回填默认 intent/lang/dimensions——badcase 记录须自带
  // 八维切片归类，缺了就是不够格入 golden。
  for (const f of ["intent", "questionLang", "dimensions"]) {
    if (bc[f] === undefined) fail(id + " lacks '" + f + "' — record classification on the badcase before --new (no fabricated classification)");
  }
  // Next docs-g number only: vert-*/ctrl-* ids carry four-digit numbers too and
  // would otherwise push a docs row into the thousands.
  const nums = golden.entries
    .filter((e) => String(e.id).startsWith("docs-g"))
    .map((e) => Number(String(e.id).replace(/\D/g, "")))
    .filter((n) => Number.isFinite(n));
  const next = "docs-g" + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, "0");
  const entry = {
    id: next,
    domain: bc.domain ?? "docs",
    question: bc.question,
    questionLang: bc.questionLang,
    intent: bc.intent,
    expected: bc.expected,
    dimensions: bc.dimensions,
    provenance: { type: bc.provenance?.type ?? "internal-dogfood", ref: "eval-badcases.json#" + id, harvestedAt: bc.evidence.runAt ?? new Date().toISOString().slice(0, 10) },
    notes: "backfilled from badcase " + id + "; observed " + bc.observed.results + " results via '" + bc.evidence.command + "'",
  };
  const expected = entry.expected ?? {};
  const mustHit = (expected.mustHitHosts?.length ?? 0) > 0 || (expected.mustHitUrls?.length ?? 0) > 0;
  if (!(expected.verdict === "answer" && mustHit)) {
    fail("--new can only auto-scope an answer+mustHit* row (live); " + next + " needs the stub lane, which needs a kernel scenario fixture this script cannot invent — add the row and fixture by hand");
  }
  golden.entries.push(entry);
  // answer+mustHit* rows must be live-capable; a stub lane without a scenario
  // fixture would turn the kernel stub test red, so --new refuses it above.
  golden.scopes[next] = "live";
  bc.status = "promoted";
  bc.promotedTo = next;
  console.log("created " + next + " from " + id);
}

// Recount covered dimension counts AND class histograms so the manifest stays
// honest after backfill (count-only recount let classes drift).
const cov = JSON.parse(readFileSync(COVERAGE, "utf8"));
const counts = new Map();
const classHist = new Map();
for (const e of golden.entries) {
  for (const t of e.dimensions ?? []) {
    const s = String(t);
    const sep = s.indexOf(":");
    const d = s.slice(0, sep);
    counts.set(d, (counts.get(d) ?? 0) + 1);
    const h = classHist.get(d) ?? new Map();
    h.set(s.slice(sep + 1), (h.get(s.slice(sep + 1)) ?? 0) + 1);
    classHist.set(d, h);
  }
}
for (const d of cov.dimensions ?? []) {
  if (d.status === "covered") {
    const n = counts.get(d.dimension) ?? 0;
    if (n > 0) {
      d.count = n;
      if (d.classes) d.classes = Object.fromEntries(classHist.get(d.dimension) ?? []);
    }
  }
}
cov.recordedAt = new Date().toISOString().slice(0, 10);

// Repo convention: committed ledgers write atomically (tmp + rename).
function atomicWrite(path, content) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}
atomicWrite(GOLDEN, JSON.stringify(golden, null, 2) + "\n");
atomicWrite(BADCASES, JSON.stringify(badcases, null, 2) + "\n");
atomicWrite(COVERAGE, JSON.stringify(cov, null, 2) + "\n");
console.log("badcase-backfill: " + id + " promoted (" + (into ? "attach" : "create") + "); coverage recounted; run packages/store/test/eval-docs-golden.test.ts to verify");
