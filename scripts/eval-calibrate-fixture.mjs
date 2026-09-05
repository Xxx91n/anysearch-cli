// ADR-0049 D11: deterministic recorded-pairs judge. No network, no LLM, no random clock.
// Produces labels -> po/AC1/CI/decision/report and compares against a committed golden report.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);

function fail(code, detail) {
  process.stderr.write("eval-calibrate-fixture: " + detail + "\n");
  process.exit(code);
}

async function run() {
  const core = await import("../packages/store/src/eval/revision-core.ts");
  const args = process.argv.slice(2);
  const argValue = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
  const fixturePath = argValue("--fixture");
  const outPath = argValue("--out", ".ship-gate/calibration-l2-fixture-report.json");
  const goldPath = argValue("--gold");
  const boot = Number(argValue("--boot", "5000"));
  if (!fixturePath) fail(2, "--fixture is required");
  const fixture = JSON.parse(fs.readFileSync(path.resolve(fixturePath), "utf8"));
  if (fixture.schema !== "anysearch/calibration-l2-fixture@1") fail(2, "unknown fixture schema: " + fixture.schema);
  if (!Array.isArray(fixture.pairs) || !fixture.pairs.length) fail(2, "fixture pairs are required");
  const decision = core.evaluateL2(fixture.pairs, fixture.groups || [], fixture.thresholds || { ac1Lo: 0.7, po: 0.8, width: 0.4 });
  const report = {
    schema: "anysearch/calibration-l2-report@1",
    generatedAt: fixture.generatedAt || "deterministic",
    fixtureSchema: fixture.schema,
    boot,
    n: decision.n,
    rawAgreement: decision.rawAgreement,
    ac1: decision.ac1,
    ac1CI: decision.ac1CI,
    ciWidth: decision.ciWidth,
    kappa: decision.kappa,
    decision: decision.decision,
    groupRedFlags: decision.groupRedFlags,
    thresholds: decision.thresholds,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  if (goldPath) {
    const gold = JSON.parse(fs.readFileSync(path.resolve(goldPath), "utf8"));
    const normalize = (value) => JSON.stringify(value, Object.keys(value).sort());
    if (normalize(report) !== normalize(gold)) {
      process.stderr.write("eval-calibrate-fixture: golden report diff\n");
      process.exit(1);
    }
  }
  process.stdout.write("fixture judge: " + report.decision + " po=" + report.rawAgreement.toFixed(3) + " AC1=" + report.ac1.toFixed(3) + " CI=" + report.ac1CI.map((x) => Number.isFinite(x) ? x.toFixed(3) : "NaN").join(",") + " -> " + outPath + "\n");
}

if (process.env.ANS_EVAL_CALIBRATE_FIXTURE_TSX !== "1") {
  const loader = pathToFileURL(path.join(root, "packages", "store", "node_modules", "tsx", "dist", "loader.mjs")).href;
  const entry = path.relative(process.cwd(), scriptPath).split(path.sep).join("/");
  const child = spawnSync(process.execPath, ["--import", loader, entry, ...process.argv.slice(2)], {
    env: { ...process.env, ANS_EVAL_CALIBRATE_FIXTURE_TSX: "1" },
    stdio: "inherit",
  });
  process.exit(child.status ?? 2);
}

run().catch((error) => {
  console.error("eval-calibrate-fixture: internal error: " + String(error && error.stack || error));
  process.exit(2);
});
