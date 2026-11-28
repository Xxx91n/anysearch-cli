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
// 否则拒绝回灌。脚本先挡一批会写出必红行的输入（schema、词表、domain、
// expected、mustHit* 配对、runAt 形状等）；完整 schema/词汇/交叉校验仍由
// packages/store/test/eval-docs-golden.test.ts 在 CI 兜底。
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import {
  GOLDEN_DIMENSION_VALUES,
  GOLDEN_FILE,
  GOLDEN_STABILITY_CLASSES,
  GOLDEN_TOLERATED_SEGMENTS,
  goldenShapeProblems,
} from "./golden-shape.mjs";

// Tests point ANS_BACKFILL_ROOT at a temp fixture tree.
const ROOT = process.env.ANS_BACKFILL_ROOT
  ? resolve(process.env.ANS_BACKFILL_ROOT)
  : resolve(fileURLToPath(new URL("..", import.meta.url)));
const BADCASES = join(ROOT, "eval-badcases.json");
const GOLDEN = join(ROOT, GOLDEN_FILE);
const COVERAGE = join(ROOT, "eval-looks.coverage.json");
const DOCS_TOML = join(ROOT, "domains", "docs.toml");
// The store validator the own-checks defer to; a test points this at a path that
// cannot load to prove the run stops instead of writing an unvalidated row.
const VALIDATOR_URL = process.env.ANS_BACKFILL_VALIDATOR
  ? new URL(process.env.ANS_BACKFILL_VALIDATOR, import.meta.url)
  : new URL("../packages/store/src/eval/docs-golden.ts", import.meta.url);

function fail(msg) {
  console.error("badcase-backfill: " + msg);
  process.exit(2);
}
function readJson(file, label) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    fail("cannot read " + label + ": " + (err.code ?? err.message));
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    fail("invalid JSON in " + label + ": " + err.message);
  }
}
function arg(name) {
  const i = process.argv.indexOf("--" + name);
  return i === -1 ? null : process.argv[i + 1];
}

const id = arg("id");
const into = arg("into");
const create = process.argv.includes("--new");
if (!id || (!into && !create)) fail("usage: --id <docs-bcNNNN> (--into <docs-gNNNN> | --new)");

const badcases = readJson(BADCASES, "eval-badcases.json");
// JSON.parse("null") hands back null; name that instead of a bare TypeError.
if (!badcases || typeof badcases !== "object" || Array.isArray(badcases)) fail("eval-badcases.json root must be an object");
if (!Array.isArray(badcases.badcases)) fail("eval-badcases.json: badcases must be an array");
if (!badcases.badcases.every((b) => b && typeof b === "object" && !Array.isArray(b))) fail("eval-badcases.json: badcases must contain objects");
const bc = badcases.badcases.find((b) => b.id === id);
if (!bc) fail("badcase not found: " + id);
if (bc.status !== "open") fail("badcase " + id + " is not open (status=" + bc.status + ")");
// 禁合成护栏：无真实观测不得回灌。
if (!bc.observed || typeof bc.observed.results !== "number") fail(id + " has no observed block — synthetic input refused");
if (!bc.evidence || typeof bc.evidence.command !== "string" || !bc.evidence.command.trim()) fail(id + " has no evidence.command — synthetic input refused");
if (typeof bc.question !== "string" || bc.question.trim().length < 8) fail(id + " question must be a string of at least 8 characters");
if (typeof bc.domain !== "string" || bc.domain.length === 0) fail(id + " has no domain — record it on the badcase before backfill");
if (!bc.expected || typeof bc.expected !== "object" || Array.isArray(bc.expected)) fail(id + " has no expected block");

const golden = readJson(GOLDEN, GOLDEN_FILE);
// Shape checks live in scripts/golden-shape.mjs, shared with ship-gate.
for (const problem of goldenShapeProblems(golden)) fail(GOLDEN_FILE + " " + problem);
const cov = readJson(COVERAGE, "eval-looks.coverage.json");
if (!cov || typeof cov !== "object" || Array.isArray(cov)) fail("eval-looks.coverage.json root must be an object");
if (!Array.isArray(cov.dimensions)) fail("eval-looks.coverage.json: dimensions must be an array");
// A row that is not an object cannot be covered or deferred; rejecting it here
// keeps the script from writing a manifest the store validator would refuse.
if (!cov.dimensions.every((d) => d && typeof d === "object" && !Array.isArray(d))) {
  fail("eval-looks.coverage.json: dimensions must contain objects");
}

if (into) {
  const target = golden.entries.find((e) => e.id === into);
  if (!target) fail("golden target not found: " + into);
  if (target.tombstone) fail("golden target " + into + " is a tombstone — pick a live row");
  if (target.domain !== bc.domain) fail("domain mismatch — badcase " + id + " is " + bc.domain + ", target " + into + " is " + target.domain);
  if (typeof target.question !== "string") fail("golden target " + into + " has no string question — fix eval-golden.json first");
  if (target.question.trim() !== bc.question.trim()) fail("question mismatch — attach requires the same verbatim question");
  // An abstain observation attached to an answer row (or the reverse) would hang
  // the regression evidence on the opposite assertion, so refuse the mismatch.
  // The verdict itself is checked first: two absent verdicts compare equal.
  if (bc.expected.verdict !== "answer" && bc.expected.verdict !== "abstain") {
    fail(id + " expected.verdict must be answer|abstain (got " + String(bc.expected.verdict) + ")");
  }
  if (target.expected?.verdict !== bc.expected.verdict) {
    fail("verdict mismatch — badcase " + id + " expects " + bc.expected.verdict + ", target " + into + " expects " + String(target.expected?.verdict));
  }
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
  const domain = bc.domain;
  if (domain !== "docs") fail("--new only creates docs-domain rows; " + id + " is " + domain + " (cold domains are abstain-only)");
  if (golden.entries.some((e) => e && typeof e === "object" && e.tombstone === undefined && typeof e.question === "string" && e.question.trim() === bc.question.trim())) {
    fail(id + " question already exists in eval-golden.json; use --into to attach the regression evidence");
  }
  const tags = bc.dimensions;
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string" || !t.includes(":"))) {
    fail(id + " dimensions must be a string[] of dimension:value tags");
  }
  for (const tag of ["intent:" + bc.intent, "lang:" + bc.questionLang]) {
    if (!tags.includes(tag)) fail(id + " dimensions lack '" + tag + "' — --new would write a row the validator rejects");
  }
  const coveredDims = new Set(cov.dimensions.filter((d) => d && d.status === "covered").map((d) => d.dimension));
  for (const tag of tags) {
    const sep = tag.indexOf(":");
    const dim = tag.slice(0, sep);
    const val = tag.slice(sep + 1);
    const allowed = Object.hasOwn(GOLDEN_DIMENSION_VALUES, dim) ? GOLDEN_DIMENSION_VALUES[dim] : undefined;
    if (!allowed || !allowed.includes(val)) fail(id + " dimension tag outside the eight-dimension vocabulary: " + tag);
    if (!coveredDims.has(dim)) fail(id + " dimension '" + dim + "' is deferred in eval-looks.coverage.json; backfill cannot carry it until coverage marks it covered");
  }
  const provType = bc.provenance?.type ?? "internal-dogfood";
  if (provType !== "internal-dogfood") fail("--new only writes internal-dogfood provenance; " + id + " is " + provType);
  if (bc.stability_class !== undefined && !GOLDEN_STABILITY_CLASSES.includes(bc.stability_class)) {
    fail(id + " stability_class must be controlled|frozen-spec|external");
  }
  // Next docs-g number only: vert-*/ctrl-* ids carry four-digit numbers too and
  // would otherwise push a docs row into the thousands.
  const nums = golden.entries
    .filter((e) => String(e.id).startsWith("docs-g"))
    .map((e) => Number(String(e.id).replace(/\D/g, "")))
    .filter((n) => Number.isFinite(n));
  const next = "docs-g" + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, "0");
  // 禁合成护栏：harvestedAt 是真实观测的日期，缺了不许拿今天顶上。
  const harvestedAt = bc.evidence.runAt;
  if (typeof harvestedAt !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(harvestedAt)) {
    fail(id + " evidence.runAt must be the real ISO date (YYYY-MM-DD) of the observation, got: " + String(harvestedAt));
  }
  const entry = {
    id: next,
    domain,
    question: bc.question,
    questionLang: bc.questionLang,
    intent: bc.intent,
    expected: bc.expected,
    dimensions: tags,
    ...(bc.stability_class ? { stability_class: bc.stability_class } : {}),
    provenance: { type: "internal-dogfood", ref: "eval-badcases.json", harvestedAt },
    notes: "backfilled from badcase " + id + "; observed " + bc.observed.results + " results via '" + bc.evidence.command + "'",
  };
  const expected = entry.expected;
  if (expected.vertical !== undefined) fail(id + " carries expected.vertical — vertical rows need a kernel fixture and entry-level vertical spec; --new only builds docs rows");
  const mustNotHitPaths = expected.mustNotHitPaths;
  if (mustNotHitPaths !== undefined && (!Array.isArray(mustNotHitPaths) || mustNotHitPaths.length === 0 || mustNotHitPaths.some((u) => typeof u !== "string" || u.length === 0))) {
    fail(id + " mustNotHitPaths must be a non-empty string[]");
  }
  const mustHit = (expected.mustHitHosts?.length ?? 0) > 0 || (expected.mustHitUrls?.length ?? 0) > 0 || (expected.mustHitPaths?.length ?? 0) > 0;
  if (!(expected.verdict === "answer" && mustHit)) {
    fail("--new can only auto-scope an answer+mustHit* row (live); " + next + " needs the stub lane, which needs a kernel scenario fixture this script cannot invent — add the row and fixture by hand");
  }
  // Judge the values that go into the row, not `?? []` stand-ins: a null list
  // would pass that test and be written as null, which CI's validator rejects.
  if (expected.mustHitUrls !== undefined && !Array.isArray(expected.mustHitUrls)) fail(id + " mustHitUrls must be an array");
  if (expected.mustHitHosts !== undefined && !Array.isArray(expected.mustHitHosts)) fail(id + " mustHitHosts must be an array");
  const mustHitUrls = expected.mustHitUrls ?? [];
  const mustHitHosts = expected.mustHitHosts ?? [];
  // Element type before the allowlist lookup, or [123] reports "outside
  // urlAllowlist" and sends the reader to the wrong file.
  if (mustHitHosts.some((h) => typeof h !== "string")) fail(id + " mustHitHosts must be string[]");
  // ship-gate only lets a byte-exact URL anchor sit on a controlled|frozen-spec
  // target; "external" is a legal stability_class but not a controllable one.
  if (mustHitUrls.length > 0) {
    if (bc.stability_class === undefined) {
      fail(next + " carries mustHitUrls but no stability_class — set it explicitly to controlled or frozen-spec (ship-gate rejects the row without it)");
    }
    if (bc.stability_class !== "controlled" && bc.stability_class !== "frozen-spec") {
      fail(next + " carries mustHitUrls with stability_class '" + bc.stability_class + "' — ship-gate only accepts controlled|frozen-spec for a byte-exact URL anchor");
    }
  }
  let docsText;
  try {
    docsText = readFileSync(DOCS_TOML, "utf8");
  } catch (err) {
    fail("cannot read domains/docs.toml: " + (err.code ?? err.message));
  }
  let docsToml;
  try {
    docsToml = parseToml(docsText);
  } catch (err) {
    fail("invalid TOML in domains/docs.toml: " + err.message);
  }
  const allowlist = docsToml.sources?.urlAllowlist;
  if (!Array.isArray(allowlist) || allowlist.some((h) => typeof h !== "string")) {
    fail("cannot read sources.urlAllowlist from domains/docs.toml");
  }
  const allow = new Set(allowlist);
  for (const host of mustHitHosts) {
    if (!allow.has(host)) fail(id + " mustHitHost " + host + " outside domains/docs.toml urlAllowlist");
  }
  // Hostname only, the same comparison crossCheckDocsGolden makes. new URL()
  // lowercases the host but keeps "www.", so a "www." URL needs a "www." entry
  // in the allowlist — the bare domain will not match it.
  for (const url of mustHitUrls) {
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) fail(id + " mustHitUrl must be http(s): " + url);
    let host;
    try { host = new URL(url).hostname; } catch { fail(id + " mustHitUrl unparseable: " + url); }
    if (!allow.has(host)) fail(id + " mustHitUrl host " + host + " outside domains/docs.toml urlAllowlist");
  }
  const mustHitPaths = expected.mustHitPaths ?? [];
  if (!Array.isArray(mustHitPaths)) fail(id + " mustHitPaths must be {path,tolerate}[]");
  for (const pm of mustHitPaths) {
    if (!pm || typeof pm.path !== "string" || !pm.path.startsWith("/")) fail(id + " mustHitPaths pattern must start with /");
    if (!Array.isArray(pm.tolerate) || pm.tolerate.some((t) => !GOLDEN_TOLERATED_SEGMENTS.includes(t))) {
      fail(id + " mustHitPaths tolerate outside locale|version|dated: " + pm.path);
    }
  }
  if (mustHitPaths.length > 0 && (mustNotHitPaths?.length ?? 0) === 0) {
    fail(id + " mustHitPaths requires mustNotHitPaths negative pins");
  }
  // The checks above are this script's own reading of the contract. Where node
  // can load the TS module (type stripping, node >= 22.18), the real validator
  // gets the last word, so a rule added there cannot be missed here.
  const validatorProblems = await realValidatorProblems(entry);
  if (validatorProblems.length > 0) fail(next + " would fail the store validator: " + validatorProblems.join("; "));
  golden.entries.push(entry);
  golden.scopes[next] = "live";
  bc.status = "promoted";
  bc.promotedTo = next;
  console.log("created " + next + " from " + id);
}

async function realValidatorProblems(entry) {
  let validateDocsGoldenEntry;
  try {
    ({ validateDocsGoldenEntry } = await import(VALIDATOR_URL));
  } catch (err) {
    // node < 22.18 cannot load the .ts validator and reports the import as an
    // unknown extension, which reads as a pass unless it is said out loud. Any
    // other error means the validator could not run at all, so throw.
    if (err?.code !== "ERR_UNKNOWN_FILE_EXTENSION") throw err;
    console.error("badcase-backfill: skipped the store validator — node " + process.version + " cannot load the TS module; only this script's own checks ran");
    return [];
  }
  return validateDocsGoldenEntry(entry);
}

// Recount covered dimension counts AND class histograms so the manifest stays
// honest after backfill (count-only recount let classes drift).
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
for (const d of cov.dimensions) {
  if (d?.status === "covered") {
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
