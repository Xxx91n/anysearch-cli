// ADR-0027 D6: `pnpm -C packages/store eval` — writes .ship-gate/eval-report.{json,md},
// applies the gate, exits with the partitioned code contract.
// ADR-0028 D1 / ADR-0029 D6: --calibrate only (50-run hard floor; CI never rewrites). The one-round --write-baseline alias was removed (ADR-0029 D6).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { GOLDEN_CASES, assertInjectSuite, OFFLINE_EXCLUDED_GROUPS } from "./golden-cases";
import { assertBackflowNoOverlap } from "./holdout";
import { runAll, type EvalReport } from "./runner";
import { isSkip, skipKey } from "./explicit-skip";
import { quarantineSkipLedger, recordSkips, skipMustFail, withSkipLedgerLock } from "./skip-ledger";
import { advanceSwitch, probeSwitchIntegrity } from "./switch-run";
import { fixtureDefinitionHash } from "./obs-fixtures";
import { evaluateGate, mdeFor, wilson95, GATE_FAMILY_SIZE, sigmaDUpper, lockN, RELATION_GAIN_MIN_GAIN, RELATION_GAIN_LOCKED_N_CAP, OF_K_MAX, ofTable, SHIP_OVERRIDE_REASON_CODES, type EvalBaseline, type GainConclusion } from "./gate";
import { appendLook, emptyLooksLedger, nextLook, readLooksLedger, writeLooksLedger } from "./looks-ledger";
import { activeIds, expiredEntries, readQuarantine } from "./quarantine-ledger";
import { SqliteObservationStore } from "../observation";

function repoRoot(): string {
  let d = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(d, "turbo.json"))) return d;
    const p = dirname(d);
    if (p === d) throw new Error("turbo.json not found walking up from " + d);
    d = p;
  }
}

function toMarkdown(report: EvalReport, baseline: EvalBaseline | null, failures: string[], warnings: string[], gain?: GainConclusion): string {
  const m = report.metrics;
  const verdict = failures.length ? "FAIL" : warnings.length ? "WARN" : "PASS";
  const lines: string[] = [
    "# Memory Eval Report (ADR-0027 / ADR-0028)",
    "",
    `- generated: ${report.generatedAt}`,
    `- dataset fingerprint: ${report.datasetFingerprint}`,
    `- verdict: ${verdict}`,
    `- note: allowance band is advisory at current sample sizes (allowance/n < MDE); the only hard gate is passRate == 1 (ADR-0028 D1; r66 audit F-03)`,
    "",
    "## Metrics (gate)",
    "",
    "| metric | value | gate |",
    "|---|---|---|",
    `| passRate | ${m.passRate.toFixed(3)} | == 1.000 (hard) |`,
    `| supersessionFails | ${m.counts.supExpected - m.counts.supPassed}/${m.counts.supExpected} | <= allowance ${baseline ? baseline.allowance.supersessionFails : "n/a"} |`,
    `| quarantineFp | ${m.counts.fpCount}/${m.counts.fpEligible} | <= allowance ${baseline ? baseline.allowance.quarantineFp : "n/a"} |`,
    "",
    "## Observational (never gated)",
    "",
    "| metric | value |",
    "|---|---|",
    // ADR-0042 D5: synthetic runs must carry the simulated-observation-window label (ADR-0039 r108 errata D6).
    `| observation track | ${m.observational?.track ?? "consumed"}${m.observational?.simulatedObservationWindow ? " (simulated-observation-window)" : ""} |`,
    `| mrr (rank-of-relevant) | ${m.mrr.toFixed(3)} |`,
    `| answerableFalseRefusalRate | ${m.answerableFalseRefusalRate.toFixed(3)} |`,
    // r74 audit E1: entity-arm telemetry (report-only; D2 <0.5 advisory, never gated)
    ...(m.entityArm ? [`| entity rule-hitRate | ${m.entityArm.hitRate.toFixed(3)} |`,`| entity activationRate | ${m.entityArm.activationRate.toFixed(3)} |`,`| entity avgArmHits | ${m.entityArm.avgArmHits.toFixed(2)} |`] : []),
    // ADR-0032 D5: merge/review telemetry — report-only, NEVER gated (Goodhart clause).
    ...(m.entityMerge ? [
      '| entity auto_merged | ' + m.entityMerge.auto_merged + ' |',
      '| entity review_pending | ' + m.entityMerge.review_pending + ' |',
      '| entity review confirmed | ' + m.entityMerge.confirmed + ' |',
      '| entity review rejected | ' + m.entityMerge.rejected + ' |',
      '| entity candidates_truncated | ' + m.entityMerge.candidates_truncated + ' |',
      '| entity unmerged | ' + m.entityMerge.unmerged + ' |',
    ] : []),
    ...(m.entityArm && m.entityArm.hitRate < 0.5 ? [`| WARNING | entity rule-hitRate < 0.5 — ADR-0031 D2: re-evaluate dual-layer extraction with fastCRW (report-only) |`] : []),
    // ADR-0036: Track-A paired RoR block (report shape; the gate decision lives in gate.verdict).
    ...(m.relationGain ? [
      "",
      "## Relation-arm gain (ADR-0036 D3-D5)",
      `- pairs n=${m.relationGain.n}, excluded=${m.relationGain.excluded} (round-WARN above 20%)`,
      `- mean RoR delta: ${m.relationGain.meanDelta.toFixed(4)} of the RRF window (>0 = relation arm pulls the target earlier)`,
      baseline?.relationGain
        ? `- preregistered: minGain(MEI)=${baseline.relationGain.minGain}, sigmaDU=${baseline.relationGain.sigmaDU}, lockedN=${baseline.relationGain.lockedN} (rawN=${baseline.relationGain.rawN})`
        : "- preregistered: MISSING — baseline has no relationGain block; run eval --calibrate",
    ] : []),
    "",
    "## Statistical power (ADR-0028 D1)",
    "",
    `- preregistered gated family size: ${GATE_FAMILY_SIZE} fraction metrics + hard passRate (aievals.co reporting discipline)`,
  ];
  for (const [label, k, n, allowance] of [
    ["supersession", m.counts.supPassed, m.counts.supExpected, baseline?.allowance.supersessionFails ?? null],
    ["quarantineFp", m.counts.fpEligible - m.counts.fpCount, m.counts.fpEligible, baseline?.allowance.quarantineFp ?? null],
  ] as Array<[string, number, number, number | null]>) {
    const [lo, hi] = wilson95(k, n);
    const mde = mdeFor(n);
    const frac = allowance !== null && n > 0 ? allowance / n : null;
    lines.push(`- ${label}: Wilson95 [${lo.toFixed(3)}, ${hi.toFixed(3)}], MDE ${mde.toFixed(3)}` + (frac === null ? "" : `, allowance fraction ${frac.toFixed(3)}` + (frac < mde ? " (UNDER-POWERED: FAILs downgrade to WARN)" : "")));
  }
  lines.push("", "## Rank gate (ADR-0028 D2)", "", "| case | op | rank | max |", "|---|---|---|---|");
  for (const c of report.cases) {
    for (const r of c.ops) {
      if (r.rank !== undefined) lines.push(`| ${c.id} | ${r.op} | ${r.rank === 0 ? "absent" : r.rank} | gate |`);
    }
  }
  // ADR-0038 D2: three-tier gain-gate section (GREEN/WARN/RED; ship-gate reads the same JSON field).
  if (gain) {
    const f = gain.full;
    lines.push("", "## Gain three-tier gate (ADR-0038 D2, look " + gain.look + "/" + gain.kMax + ")", "",
      "- tier: " + gain.tier.toUpperCase(),
      "- spent alpha: " + gain.spentAlpha.toFixed(6) + " (preregistered OF table, k_max=" + gain.kMax + ")",
      ...(f ? ["- full sample: n=" + f.n + " mean=" + f.mean.toFixed(4) + " BCa=[" + f.bcaLo.toFixed(4) + ", " + f.bcaHi.toFixed(4) + "] signFlipP=" + f.signFlipP.toFixed(5) + " harmP=" + f.signFlipHarmP.toFixed(5) + " passAtLook=" + f.passAtLook] : []),
      ...(gain.holdout ? ["- holdout: n=" + gain.holdout.n + " mean=" + gain.holdout.mean.toFixed(4) + " mde=" + gain.holdout.mde.toFixed(3) + (gain.holdout.underpowered ? " (UNDER-POWERED)" : "")] : []),
      ...gain.reasons.map((r) => "- " + r));
  }
  // ADR-0038 D7: graded-relevance nDCG table (report-only).
  if (report.metrics.ndcg) {
    const nd = report.metrics.ndcg;
    lines.push("", "## Graded relevance nDCG (ADR-0038 D7, report-only)", "", "- n graded cases: " + nd.n, "- nDCG@5: " + nd.at5.toFixed(4) + "  nDCG@10: " + nd.at10.toFixed(4) + "  nDCG@20: " + nd.at20.toFixed(4));
  }

  lines.push("", "## Difficulty tiers (ADR-0028 D4, report-only)", "", "| tier | cases | passed | passRate |", "|---|---|---|---|");
  for (const [tier, t] of Object.entries(report.tierBreakdown)) lines.push(`| ${tier} | ${t.cases} | ${t.passed} | ${t.passRate.toFixed(3)} |`);
  lines.push("", "## Stage attribution (failed cases)", "", "```json", JSON.stringify(report.stageBreakdown), "```", "", "## Cases", "", "| case | group | tier | stage | result |", "|---|---|---|---|---|");
  for (const c of report.cases) lines.push(`| ${c.id} | ${c.group} | ${c.difficulty} | ${c.failedStage ?? "-"} | ${c.passed ? "PASS" : "FAIL"} |`);
  if (warnings.length) lines.push("", "## Gate warnings (non-blocking)", "", ...warnings.map((w) => "- " + w));
  if (failures.length) lines.push("", "## Gate failures", "", ...failures.map((x) => "- " + x));
  // ADR-0039 E3: observational zone rendered even when empty/skipped (report-as-contract).
  const ob = report.metrics.observational;
  lines.push("", "## Observational (ADR-0039 — report-only, never gated)", "");
  if (!ob) { lines.push("MISSING: metrics.observational zone (ship-gate fails on this)"); }
  else {
    lines.push("- dayBucketDefinition: " + ob.dayBucketDefinition);
    for (const [k, v] of Object.entries(ob)) {
      if (k === "schema" || k === "dayBucketDefinition") continue;
      const sv = v as { status?: string; tier?: string; reason?: string } | null;
      lines.push("- " + k + ": " + (sv && sv.status === "skipped" ? "skipped (" + sv.tier + ") — " + sv.reason : JSON.stringify(v)));
    }
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<number> {
  // ADR-0029 D5: hard wall-clock watchdog (default 600s, EVAL_TIMEOUT_MS overrides).
  const envTimeout = process.env.EVAL_TIMEOUT_MS;
  const timeoutMs = envTimeout === undefined ? 600_000 : Number(envTimeout);
  // audit r67: an invalid override must fail loudly, not silently unset the watchdog.
  if (envTimeout !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    console.error("EVAL_TIMEOUT_MS invalid: " + JSON.stringify(envTimeout));
    process.exit(2);
  }
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    setTimeout(() => {
      console.error("[eval] TIMEOUT: exceeded " + timeoutMs + "ms (ADR-0029 D5)");
      process.exit(124);
    }, timeoutMs).unref();
  }
  // ADR-0038 D5: backflow slice family must never intersect the frozen baseline — fail fast (exit 12).
  try {
    assertBackflowNoOverlap(GOLDEN_CASES);
    assertInjectSuite(GOLDEN_CASES);
  } catch (e) {
    console.error("[eval] backflow overlap: " + (e instanceof Error ? e.message : String(e)));
    process.exit(12);
  }
  const args = process.argv.slice(2);
  const calibrateIdx = args.indexOf("--calibrate");
  const decisionIdx = args.indexOf("--decision");
  const overrideIdx = args.indexOf("--override");
  // ADR-0060 D7 / ADR-0057 r59 errata: --offline drops the vector-arm group (needs the model).
  const offline = args.includes("--offline");
  const overrideReason = overrideIdx >= 0 ? args[overrideIdx + 1] : undefined;
  const outIdx = args.indexOf("--out");
  const root = repoRoot();
  // ADR-0059 D2: the OF look ledger lives at the repo root as a git-committed file, so a clean
  // clone (no .ship-gate/) still carries the preregistration state.
  const LOOKS_LEDGER_PATH = join(root, "eval-looks.json");
  const outDir = outIdx >= 0 ? resolve(args[outIdx + 1]!) : join(root, ".ship-gate");
  const baselinePath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "eval-baseline.json");
  // ADR-0027 D8 / ADR-0059 D3: flaky-case quarantine ledger (policy layer, next to the baseline).
  const quarantinePath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "eval-quarantine.json");
  const quarantine = readQuarantine(quarantinePath);
  const quarantineActive = activeIds(quarantine, new Date().toISOString());
  const quarantineExpired = expiredEntries(quarantine, new Date().toISOString()).map((e) => e.id);

  if (overrideIdx >= 0 && (!overrideReason || !(SHIP_OVERRIDE_REASON_CODES as readonly string[]).includes(overrideReason))) {
    console.error("[eval] --override requires one of: " + SHIP_OVERRIDE_REASON_CODES.join(", "));
    process.exit(2);
  }

  if (calibrateIdx >= 0) {
    // ADR-0028 D1: 50-run hard floor. Any run with passRate < 1 aborts calibration (exit 2):
    // a flaky-case floor is a quarantine signal, not a baseline. Idempotent; safe to re-run.
    const nArg = args[calibrateIdx + 1];
    const runs = nArg && /^\d+$/.test(nArg) ? Number(nArg) : 50;
    console.log(`[eval:calibrate] running ${runs} seeded runs...`);
    let worstSupFails = 0;
    let worstFp = 0;
    let last: EvalReport | null = null;
    for (let i = 0; i < runs; i++) {
      const r = await runAll(GOLDEN_CASES);
      const qFailed = r.cases.filter((c) => quarantineActive.includes(c.id) && !c.passed).length;
      const eff = r.cases.length ? (r.metrics.counts.casesPassed + qFailed) / r.metrics.counts.cases : r.metrics.passRate;
      if (eff < 1) {
        console.error(`[eval:calibrate] ABORT run ${i + 1}/${runs}: passRate ${eff.toFixed(3)} < 1 — quarantine the flaky case before calibrating (ADR-0027 D7)`);
        return 2;
      }
      worstSupFails = Math.max(worstSupFails, r.metrics.counts.supExpected - r.metrics.counts.supPassed);
      worstFp = Math.max(worstFp, r.metrics.counts.fpCount);
      last = r;
    }
    const next: EvalBaseline = {
      schema: "anysearch/eval-baseline@1",
      fingerprint: last!.datasetFingerprint,
      metrics: last!.metrics,
      allowance: { supersessionFails: worstSupFails + 1, quarantineFp: worstFp + 1 },
      // ADR-0036 D2/D4 below
      relationGain: undefined as EvalBaseline["relationGain"],
      holdoutFingerprint: last!.holdoutFingerprint,
      updatedAt: new Date().toISOString().slice(0, 10),
      note: "ADR-0028 D1 calibration (runs=" + runs + "); integer allowance = worst-observed failures + 1 op. CI never writes this file (ADR-0027 D9).",
    };
    // ADR-0036 D2/D4: pilot deltas -> sigma_d upper 95% CI -> Sakai n (locked ONCE, cap 80).
    const pilotDeltas = last!.metrics.relationGain?.deltas ?? [];
    if (pilotDeltas.length < 2) {
      console.error("[eval:calibrate] ABORT: relation-gain pilot has " + pilotDeltas.length + " RoR pair(s) < 2 — expand/instrument the golden first (ADR-0036 D2)");
      return 2;
    }
    // Degenerate pilot (sd=0): the pilot never exercised the arm — Webber 2008 rule: never
    // shrink n on a zero-variance pilot; lock n at the cap instead (ADR-0036 D2 anti-top-up).
    const degenerate = pilotDeltas.every((d) => d === pilotDeltas[0]);
    const sigmaDU = degenerate ? 0 : sigmaDUpper(pilotDeltas);
    const { rawN, lockedN } = degenerate
      ? { rawN: RELATION_GAIN_LOCKED_N_CAP, lockedN: RELATION_GAIN_LOCKED_N_CAP }
      : lockN(sigmaDU, RELATION_GAIN_MIN_GAIN);
    if (degenerate) console.log("[eval:calibrate] pilot sd=0 — sigmaDU=0 placeholder, n locked at cap " + RELATION_GAIN_LOCKED_N_CAP + " (ADR-0036 D2; recalibrate after RoR-heavy expansion)");
    next.relationGain = { sigmaDU: Number(sigmaDU.toFixed(6)), rawN, lockedN, minGain: RELATION_GAIN_MIN_GAIN };
    writeFileSync(baselinePath, JSON.stringify(next, null, 2) + "\n", "utf8");
    // ADR-0059 D2: calibration flips the fingerprint pair, so the pre-registered OF look ledger
    // resets. The ledger is the git-committed repo-root file; commit the reset with the baseline.
    writeLooksLedger(LOOKS_LEDGER_PATH, emptyLooksLedger());
    console.log(`[eval:calibrate] baseline written: fingerprint=${next.fingerprint} allowance sup<=${next.allowance.supersessionFails} qfp<=${next.allowance.quarantineFp} relationGain sigmaDU=${next.relationGain!.sigmaDU} lockedN=${next.relationGain!.lockedN} (rawN=${next.relationGain!.rawN}, pilot n=${pilotDeltas.length})`);
    return 0;
  }

  // ADR-0029 D5 test hook: synthetic delay so the watchdog has something to kill.
  if (process.env.EVAL_SLOW_MS) await new Promise((r) => setTimeout(r, Number(process.env.EVAL_SLOW_MS)));
  const report = await runAll(GOLDEN_CASES, offline ? { excludeGroups: OFFLINE_EXCLUDED_GROUPS } : undefined);
  if (offline) console.error("[eval] OFFLINE: vector-arm group excluded (" + OFFLINE_EXCLUDED_GROUPS.join(",") + ") - degraded run; full coverage lives behind test:online (ADR-0060 D7)");
  mkdirSync(outDir, { recursive: true });

  let baseline: EvalBaseline | null = null;
  if (existsSync(baselinePath)) baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as EvalBaseline;

  // ADR-0038 D4 + ADR-0059 D2: per-fingerprint OF look ledger — the git-committed repo-root
  // eval-looks.json. Reading always happens so the next look number comes from committed state;
  // the append happens AFTER evaluateGate (below) so each row can carry its verdict.
  const looksPath = LOOKS_LEDGER_PATH;
  const lookKey = report.datasetFingerprint + ":" + report.holdoutFingerprint;
  mkdirSync(outDir, { recursive: true });
  let looks = readLooksLedger(looksPath);
  const look = nextLook(looks, lookKey);
  const g = evaluateGate(report, baseline, { look, quarantineActiveIds: quarantineActive });
  const exitCode = g.exitCode;

  // ADR-0052 D5: persist the evaluation result as a representation-only
  // observation. This write is deliberately after evaluateGate and never feeds
  // the decision path above it.
  try {
    const observationDb = process.env.ANS_DB_PATH && process.env.ANS_DB_PATH.trim()
      ? process.env.ANS_DB_PATH
      : join(os.homedir(), ".anysearch", "anysearch.db");
    mkdirSync(dirname(observationDb), { recursive: true });
    const observation = new SqliteObservationStore(observationDb);
    observation.recordEvaluationTrace({
      runId: `eval:${report.datasetFingerprint}:${report.holdoutFingerprint}:${look}`,
      name: "memory-eval",
      attributes: {
        "eval.datasetFingerprint": report.datasetFingerprint,
        "eval.holdoutFingerprint": report.holdoutFingerprint,
        "eval.verdict": g.verdict,
        "eval.look": look,
      },
      evaluation: {
        name: "memory-eval",
        scoreValue: report.metrics.passRate,
        scoreLabel: g.verdict,
      },
      scores: [
        { rubricItem: "passRate", value: report.metrics.passRate },
        { rubricItem: "supersessionFails", value: report.metrics.counts.supExpected - report.metrics.counts.supPassed },
        { rubricItem: "quarantineFp", value: report.metrics.counts.fpCount },
      ],
    });
    observation.close();
  } catch (e) {
    console.error("[eval] observation write failed (fail-open): " + String((e as Error).message ?? e));
  }

  // ADR-0039 D7: every observational explicit-skip lands in the WARN ledger (share schema with
  // gain-ledger so the existing resolve tool handles escalation). Exit stays 0; 3 consecutive
  // identical skip-key sets escalate to forced human review (surfaced by ship-gate step 7).
  const ob = report.metrics.observational;
  if (ob) {
    const keys: string[] = [];
    for (const [k, v] of Object.entries(ob)) {
      if (k === "schema" || k === "dayBucketDefinition") continue;
      if (isSkip(v)) keys.push(skipKey(k, v));
    }
    // ADR-0042 D4 + r110 SP-F-01: structural data absence (no events at all, or events but
    // no fit-eligible units) records reason-code data-absent — never builds the 3-streak.
    const obTrack = (ob as { track?: "consumed" | "synthetic" }).track ?? "consumed";
    const dataAbsent = keys.length > 0 && obTrack === "consumed" && ((ob as { dataAbsent?: boolean }).dataAbsent === true || isSkip(ob.accessAge));
    let streak = 0;
    try {
      withSkipLedgerLock(outDir, (sl) => {
        streak = recordSkips(sl, keys, new Date().toISOString(), { track: obTrack, reasonCode: dataAbsent ? "data-absent" : "gate-not-met" });
        if (skipMustFail(sl)) {
          console.error("[eval] OBSERVATIONAL skip streak " + streak + " >= 3 — forced human review: node scripts/gain-warn-resolve.mjs --decision stay-warn --note observational-skip --ledger " + join(outDir, "skip-ledger.json") + " (ADR-0039 D7)");
        }
        return streak;
      });
    } catch (e) {
      const quarantined = quarantineSkipLedger(outDir, new Date().toISOString());
      console.error("[eval] OBSERVATIONAL skip-ledger fails the ledger contract — quarantined to " + quarantined + " and restarted empty (" + String((e as Error).message ?? e) + ")");
      withSkipLedgerLock(outDir, (sl) => {
        streak = recordSkips(sl, keys, new Date().toISOString(), { track: obTrack, reasonCode: dataAbsent ? "data-absent" : "gate-not-met" });
        return streak;
      });
    }
  }

  // ADR-0043 impl-plan 3/8: advance the consumed/synthetic switch state machine.
  // Reads the durable DB (ANS_DB_PATH or ~/.anysearch/anysearch.db), never the eval temp DB.
  // IO failures are loud stderr but never crash the run (exit-code contract unchanged);
  // the chain verifier at ship-gate step 1 remains the authority on chain health.
  try {
    const swDb = process.env.ANS_DB_PATH && process.env.ANS_DB_PATH.trim()
      ? process.env.ANS_DB_PATH
      : join(os.homedir(), ".anysearch", "anysearch.db");
    const gateBoundary = decisionIdx >= 0 || overrideIdx >= 0;
    const probe = gateBoundary ? probeSwitchIntegrity(outDir, swDb) : null;
    // r115 audit S1: build the verdict AFTER the probe runs and AFTER advanceSwitch has
    // returned. Default the verdict to failed for decision-grade runs and to pass for
    // observational runs; advanceSwitch only ever flips a decision-grade verdict to
    // failed on its own failure paths.
    const sw = advanceSwitch({
      outDir,
      dbPath: swDb,
      mode: "real",
      integrityFailed: probe && !probe.ok ? probe.detail : null,
      untrustworthyEvidence: gateBoundary && ob?.eventWriteFailures && ob.eventWriteFailures.count > 0,
    });
    // r116 fix: decision-grade runs default to failed and only flip to pass when BOTH
    // the chain probe succeeds AND advanceSwitch returns no integrity error. This closes
    // the S1 P0 finding that the verdict producer could default to pass without a
    // concrete publish-red signal.
    const decisionProbeOk = probe ? probe.ok : false;
    const integrityVerdict = gateBoundary
      ? (sw.integrityError || !decisionProbeOk ? "failed" : "pass")
      : "pass";
    report.integrity = {
      verdict: integrityVerdict,
      runPurpose: overrideIdx >= 0 ? "override" : decisionIdx >= 0 ? "decision" : "observational",
      ...(overrideIdx >= 0 && overrideReason ? { overrideReasonCode: overrideReason as (typeof SHIP_OVERRIDE_REASON_CODES)[number] } : {}),
    };
    if (sw.decision.record || sw.integrityError) console.error("[switch] " + sw.decision.reason + (sw.integrityError ? " [FAIL-CLOSED]" : ""));
  } catch (e) {
    console.error("[switch] advance failed (eval continues; integrity checks live in ship-gate): " + String((e as Error).message ?? e));
    const gateBoundary = decisionIdx >= 0 || overrideIdx >= 0;
    report.integrity = {
      verdict: gateBoundary ? "failed" : "pass",
      runPurpose: overrideIdx >= 0 ? "override" : decisionIdx >= 0 ? "decision" : "observational",
      ...(overrideIdx >= 0 && overrideReason ? { overrideReasonCode: overrideReason as (typeof SHIP_OVERRIDE_REASON_CODES)[number] } : {}),
    };
  }

  // r110 SP-F-03: if the fixture manifest is absent the fingerprint carries the explicit
  // "no-fixtures" marker — surface it instead of letting the fingerprint silently drift.
  if (fixtureDefinitionHash() === "no-fixtures") console.error("[eval] WARN: obs-feed MANIFEST.json absent — datasetFingerprint includes the explicit 'no-fixtures' marker; repack fixtures or expect a fingerprint flip on restore");
  // ADR-0059 D2: a preregistered OF look is spent ONLY by a release-grade peek. Merge-gate/CI runs
  // set ANS_EVAL_NO_LOOK=1; ordinary runs read the ledger but never append (ANS_EVAL_LOOKS_WRITE unset).
  if (process.env.ANS_EVAL_NO_LOOK !== "1" && process.env.ANS_EVAL_LOOKS_WRITE === "1") {
    const at = new Date().toISOString();
    looks = appendLook(looks, {
      key: lookKey,
      at,
      look,
      verdict: g.verdict,
      exitCode,
      ...(report.integrity ? { integrity: report.integrity.verdict } : {}),
    }, at);
    writeLooksLedger(looksPath, looks);
  }
  const enriched = {
    ...report,
    baselineFingerprint: baseline?.fingerprint ?? null,
    gate: { verdict: g.verdict, exitCode, failures: g.failures, warnings: g.warnings, gainConclusion: g.gainConclusion ?? null },
    // ADR-0059 D3: quarantine disclosure (policy layer; dataset fingerprint deliberately unchanged).
    quarantine: { active: quarantineActive, expired: quarantineExpired, schema: quarantine.schema },
  };
  writeFileSync(join(outDir, "eval-report.json"), JSON.stringify(enriched, null, 2) + "\n", "utf8");
  writeFileSync(join(outDir, "eval-report.md"), toMarkdown(report, baseline, g.failures, g.warnings, g.gainConclusion), "utf8");

  console.log(
    `[eval] cases ${report.totals.passed}/${report.totals.cases} pass, fingerprint=${report.datasetFingerprint}, ` +
      `passRate=${report.metrics.passRate.toFixed(3)} supFails=${report.metrics.counts.supExpected - report.metrics.counts.supPassed} qfp=${report.metrics.counts.fpCount} mrr=${report.metrics.mrr.toFixed(3)} verdict=${g.verdict} exit=${exitCode}`
  );
  console.log("[eval] note: allowance band advisory at current n (allowance/n < MDE) — hard gate is passRate==1 (ADR-0028 D1)");
  for (const w of g.warnings) console.warn("[eval] WARN: " + w);
  for (const x of g.failures) console.error("[eval] gate: " + x);
  // F-17 diagnosability: name the failing cases so a CI log identifies an environment flake
  // without needing the report artifact (ADR-0059 D3).
  const failedCases = report.cases.filter((c) => !c.passed);
  if (failedCases.length) console.error("[eval] failed cases: " + failedCases.map((c) => c.id + "(" + (c.failedStage ?? "-") + ")").join(", "));
  // ADR-0047 D1: --override bypasses only a publish-red gate (exit 1), never
  // fingerprint mismatch (12) or unverifiable/internal failure (2).
  return overrideIdx >= 0 && exitCode === 1 ? 0 : exitCode;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error("[eval] internal error: " + String((e as Error)?.stack ?? e));
    process.exit(2);
  }
);
