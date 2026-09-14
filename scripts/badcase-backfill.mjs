// ADR-0061 B4/T3: badcase -> golden 回灌闭环。
//
//   node scripts/badcase-backfill.mjs --id docs-bc0001 --into docs-g0007
//     attach 模式：把已观测 badcase 标记为 promoted，回指既有 golden 条目
//     （同一真实提问的回归证据，不制造重复条目）。
//   node scripts/badcase-backfill.mjs --id docs-bc0001 --new
//     create 模式：为新提问生成下一条 docs-gNNNN golden 条目，并自动重算
//     eval-looks.coverage.json 的 covered 维度计数。
//
// 禁合成护栏：badcase 必须携带 observed + evidence.command（真实观测），
// 否则拒绝回灌。完整 schema/词汇/交叉校验由 packages/store/test/
// eval-docs-golden.test.ts 在 CI 强制执行——本脚本只做结构前置检查。
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BADCASES = join(ROOT, "eval-badcases.json");
const LOOKS = join(ROOT, "eval-looks.json");
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

const looks = JSON.parse(readFileSync(LOOKS, "utf8"));
const golden = looks.golden;
if (!golden || !Array.isArray(golden.entries)) fail("eval-looks.json has no golden collection");

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
  const nums = golden.entries.map((e) => Number(e.id.replace(/\D/g, ""))).filter((n) => Number.isFinite(n));
  const next = "docs-g" + String(Math.max(...nums) + 1).padStart(4, "0");
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
  golden.entries.push(entry);
  bc.status = "promoted";
  bc.promotedTo = next;
  console.log("created " + next + " from " + id);
}

// Recount covered dimension counts AND class histograms so the manifest stays
// honest after backfill (r60-audit F3: count-only recount let classes drift).
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
atomicWrite(LOOKS, JSON.stringify(looks, null, 2) + "\n");
atomicWrite(BADCASES, JSON.stringify(badcases, null, 2) + "\n");
atomicWrite(COVERAGE, JSON.stringify(cov, null, 2) + "\n");
console.log("badcase-backfill: " + id + " promoted (" + (into ? "attach" : "create") + "); coverage recounted; run packages/store/test/eval-docs-golden.test.ts to verify");
