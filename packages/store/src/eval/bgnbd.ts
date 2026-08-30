// ADR-0039 D2/D6: BG/NBD cohort readout behind the preregistered AND-gate.
// The Python fit is out-of-process (lifelines pinned, versioned JSON envelope); the TS side
// is a thin spawn wrapper that NEVER throws — every failure maps to an explicit-skip marker.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { skip, type SkipMarker } from "./explicit-skip";

// Preregistered AND-gate (ADR-0039 D6). Any unsatisfied condition -> skip, no fit runs.
export const TAU_FIT_GATE = {
  minActiveRows: 300,
  minFittableUnits: 100,
  psiMax: 0.25,
  minWindowDays: 90,
  minIntervalDays: 30,
} as const;

export interface TauFitGateInput {
  activeRows: number;
  fittableUnits: number;         // repeat-access sequences (>=1 re-access events)
  psi: number | null;            // baseline vs rolling-30d access-age histogram PSI
  windowDays: number;            // days since the observation layer shipped
  daysSinceLastFit: number | null;
}

export function evaluateTauFitGate(input: TauFitGateInput): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  // T1: T1 >= 300 active rows AND >= 100 fittable units.
  if (input.activeRows < TAU_FIT_GATE.minActiveRows || input.fittableUnits < TAU_FIT_GATE.minFittableUnits)
    failures.push("T1: " + input.activeRows + " active rows / " + input.fittableUnits + " fittable units < " + TAU_FIT_GATE.minActiveRows + "/" + TAU_FIT_GATE.minFittableUnits);
  // T2: PSI < 0.25 (baseline vs rolling 30d, D4 buckets, symmetric-KL). No histogram yet = block.
  if (input.psi === null || input.psi >= TAU_FIT_GATE.psiMax)
    failures.push(input.psi === null ? "T2: PSI unavailable (no access-age histogram pair yet)" : "T2: PSI " + input.psi.toFixed(4) + " >= " + TAU_FIT_GATE.psiMax);
  // T3: window >= 90d AND >= 30d between fits (anti-peeking).
  if (input.windowDays < TAU_FIT_GATE.minWindowDays)
    failures.push("T3: observation window " + input.windowDays + "d < " + TAU_FIT_GATE.minWindowDays + "d");
  if (input.daysSinceLastFit !== null && input.daysSinceLastFit < TAU_FIT_GATE.minIntervalDays)
    failures.push("T3: last fit " + input.daysSinceLastFit + "d ago < " + TAU_FIT_GATE.minIntervalDays + "d interval");
  return { ok: failures.length === 0, failures };
}

// PSI, symmetric-KL form with epsilon bucket smoothing (ADR-0039 D6 T2).
export function psi(base: readonly number[], current: readonly number[], eps = 1e-6): number {
  if (base.length !== current.length) throw new Error("PSI buckets must match");
  const sb = base.reduce((a, b) => a + b, 0);
  const sc = current.reduce((a, b) => a + b, 0);
  if (sb === 0 || sc === 0) return NaN;
  let s = 0;
  for (let i = 0; i < base.length; i++) {
    const p = base[i]! / sb + eps;
    const q = current[i]! / sc + eps;
    s += (p - q) * Math.log(p / q);
  }
  return s;
}

export interface BgnbdRow { frequency: number; recency: number; T: number }
export interface BgnbdEnvelope {
  ok: boolean;
  converged: boolean;
  params?: { r: number; alpha: number; a: number; b: number };
  palive?: number[];
  conditional_expected?: number[];
  validation?: { chi2: number; df: number; p: number };
  error?: string;
}

export type BgnbdResult = { status: "ok"; envelope: BgnbdEnvelope } | SkipMarker;

export interface RunBgnbdOptions {
  gate: TauFitGateInput;
  python?: string;        // default "python"; tests pass process.execPath with stub scripts
  scriptPath?: string;    // default scripts/tau/bgnbd_fit.py
  timeoutMs?: number;     // default 120_000
}

const DEFAULT_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "tau", "bgnbd_fit.py");

// Runs the fit only when the AND-gate is fully satisfied. NEVER throws (D7).
export async function runBgnbdFit(rows: BgnbdRow[], opts: RunBgnbdOptions): Promise<BgnbdResult> {
  const gate = evaluateTauFitGate(opts.gate);
  if (!gate.ok) return skip(gate.failures.join("; "), "gate-not-met");

  const python = opts.python ?? "python";
  const scriptPath = opts.scriptPath ?? DEFAULT_SCRIPT;
  const timeoutMs = opts.timeoutMs ?? 120_000;

  return await new Promise<BgnbdResult>((resolve) => {
    let child;
    try {
      child = spawn(python, [scriptPath], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        windowsHide: true,
      });
    } catch (e) {
      resolve(skip("spawn threw: " + String(e), "infra-failure"));
      return;
    }
    let out = "";
    let err = "";
    let settled = false;
    const finish = (r: BgnbdResult) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => {
      // Node kill semantics: SIGKILL maps to TerminateProcess on Windows (Best available; the
      // child is a leaf python process, no grandchildren spawned by bgnbd_fit.py).
      child.kill("SIGKILL");
      finish(skip("spawn timeout after " + timeoutMs + "ms (SIGKILL)", "infra-failure"));
    }, timeoutMs);
    child.on("error", (e) => finish(skip("spawn error: " + String((e && e.message) ?? e), "infra-failure")));
    child.stdout.on("data", (d) => {
      out += d;
      if (out.length > 4 * 1024 * 1024) { child.kill("SIGKILL"); finish(skip("stdout exceeded 4MB cap", "infra-failure")); }
    });
    child.stderr.on("data", (d) => { if (err.length < 64 * 1024) err += d; });
    child.on("close", (code) => {
      if (code !== 0) {
        finish(skip("python exited " + code + (err ? " stderr=" + err.slice(0, 300).trim() : ""), "infra-failure"));
        return;
      }
      let env: BgnbdEnvelope;
      try {
        env = JSON.parse(out);
      } catch {
        finish(skip("stdout is not valid JSON (" + out.slice(0, 120).trim() + ")", "infra-failure"));
        return;
      }
      if (!env || env.ok !== true) {
        finish(skip("envelope ok!=true: " + (env && env.error ? String(env.error).slice(0, 200) : "(missing ok)"), "infra-failure"));
        return;
      }
      if (env.converged !== true) {
        finish(skip("BetaGeoFitter did not converge (converged:false) — no placeholder params emitted", "gate-not-met"));
        return;
      }
      finish({ status: "ok", envelope: env });
    });
    try {
      child.stdin.write(JSON.stringify({ rows }));
      child.stdin.end();
    } catch (e) {
      child.kill("SIGKILL");
      finish(skip("stdin write failed: " + String(e), "infra-failure"));
    }
  });
}
