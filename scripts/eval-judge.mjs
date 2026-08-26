// ADR-0027 D2: LLM judge report channel (NOT a gate — never wired into ship-gate).
// Local DeepSeek over OpenAI-compatible /chat/completions. Fail-open:
// judge unreachable/error on a case => score 0 + error string, never crash.
// Enablement gate (D2 hard constraints) is manual: kappa >= 0.6 vs human gold-set before trusting reports.
//
// Usage: node scripts/eval-judge.mjs [--report .ship-gate/eval-report.json] [--out .ship-gate/judge-report.json]
// Env: JUDGE_BASE_URL (default http://127.0.0.1:20128/v1), JUDGE_API_KEY (required), JUDGE_MODEL (default deepseekpro).
// Exit codes: 0 ok (even if all scores 0), 2 report unreadable, 3 JUDGE_API_KEY missing.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : dflt;
};
const reportPath = argVal("--report", ".ship-gate/eval-report.json");
const outPath = argVal("--out", ".ship-gate/judge-report.json");
const baseUrl = (process.env.JUDGE_BASE_URL || "http://127.0.0.1:20128/v1").replace(/\/+$/, "");
const model = process.env.JUDGE_MODEL || "deepseekpro";
const apiKey = process.env.JUDGE_API_KEY || "";

if (!apiKey) {
  process.stderr.write("eval-judge: JUDGE_API_KEY not set (judging needs the local endpoint key)\n");
  process.exit(3);
}
if (!fs.existsSync(reportPath)) {
  process.stderr.write("eval-judge: report not found: " + reportPath + "\n");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
} catch (e) {
  process.stderr.write("eval-judge: report unreadable: " + String(e && e.message) + "\n");
  process.exit(2);
}

// Judge prompts only look at retrieve-stage samples — deterministic pass/fail stays the gate's job.
const judged = [];
for (const c of report.cases ?? []) {
  for (const op of c.ops ?? []) {
    if (op.kind !== "search" || !op.samples || op.samples.length === 0) continue;
    judged.push({ caseId: c.id, group: c.group, op: op.op, samples: op.samples });
  }
}

async function judgeOne(prompt) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: "system", content: "You are a strict retrieval-relevance judge. Answer with a single character: 1 if the returned snippet is relevant to the query, 0 otherwise." },
          { role: "user", content: prompt },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error("http " + res.status);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    const m = text.match(/[01]/);
    return { score: m ? Number(m[0]) : 0, error: m ? null : "unparseable: " + text.slice(0, 80) };
  } catch (e) {
    return { score: 0, error: String(e && e.message) };
  } finally {
    clearTimeout(timer);
  }
}

const entries = [];
for (const j of judged) {
  const sample = j.samples[0];
  const r = await judgeOne(
    `Query captured during case "${j.caseId}" (${j.group}):\nReturned title: ${sample.title}\nReturned snippet: ${sample.snippet}\nIs the returned snippet a plausible, relevant hit?`
  );
  entries.push({ caseId: j.caseId, group: j.group, op: j.op, score: r.score, error: r.error });
}

const scores = entries.map((e) => e.score);
const out = {
  schema: "anysearch/judge-report@1",
  generatedAt: new Date().toISOString(),
  model,
  baseUrl,
  note: "nightly/manual report channel (ADR-0027 D2). Not a gate. Enable only after kappa >= 0.6 calibration.",
  judgedSamples: entries.length,
  meanScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
  errors: entries.filter((e) => e.error).length,
  entries,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`eval-judge: ${entries.length} samples, mean=${out.meanScore.toFixed(3)}, errors=${out.errors}, model=${model} -> ${outPath}`);
process.exit(0);
