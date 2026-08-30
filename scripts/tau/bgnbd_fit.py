#!/usr/bin/env python3
# ADR-0039 D2: BG/NBD cohort lifetime fit, out-of-process (data contract over stdio).
# stdin:  {"rows": [{"frequency": float, "recency": float, "T": float}, ...]}
# stdout = single-line JSON envelope:
#   {"ok": true,  "converged": true, "params": {r, alpha, a, b}, "palive": [...],
#    "conditional_expected": [...], "validation": {"chi2":..., "df":..., "p":...}}
#   {"ok": true,  "converged": false, "error": ...}   <- data outcome, still exit 0
#   {"ok": false, "error": ...}                        <- infra/contract failure, exit 0
# Exit code 0 always; converged is independent of exit code (D7: TS side maps all to skip).
import json
import sys


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")


def main():
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
        rows = payload["rows"]
    except Exception as e:
        emit({"ok": False, "error": "input contract violation: " + str(e)})
        return
    try:
        import numpy as np
        from lifetimes import BetaGeoFitter
    except Exception as e:
        emit({"ok": False, "error": "import failed (frozen stack in scripts/tau/requirements.txt): " + str(e)})
        return
    try:
        frequency = np.array([float(r["frequency"]) for r in rows])
        recency = np.array([float(r["recency"]) for r in rows])
        period = np.array([float(r["T"]) for r in rows])
    except Exception as e:
        emit({"ok": False, "error": "row schema violation (frequency/recency/T required): " + str(e)})
        return

    try:
        fitter = BetaGeoFitter()
        fitter.fit(frequency, recency, period)
        params = {str(k): float(v) for k, v in fitter.params_.items()}
    except Exception as e:
        emit({"ok": True, "converged": False, "error": "fit did not converge: " + str(e)})
        return
    if not all(float(v) == float(v) and abs(float(v)) != float("inf") for v in params.values()):
        emit({"ok": True, "converged": False, "error": "non-finite parameters"})
        return

    palive = [float(x) for x in fitter.conditional_probability_alive(frequency, recency, period)]
    cexp = [float(x) for x in fitter.conditional_expected_number_of_purchases_up_to_time(30, frequency, recency, period)]

    # C6 self-validation (Fader-Hardie-Lee 2005): chi-square goodness-of-fit over the
    # frequency distribution 0/1/2/3+ (actual vs model-implied expectation at observed horizon).
    validation = {"chi2": None, "df": None, "p": None}
    try:
        import numpy as np
        expected = np.array([
            float(fitter.conditional_expected_number_of_purchases_up_to_time(t, f, r, tp) + f)
            for t, f, r, tp in zip(period, frequency, recency, period)
        ])
        obs = [int(np.sum(frequency == 0)), int(np.sum(frequency == 1)),
               int(np.sum(frequency == 2)), int(np.sum(frequency >= 3))]
        ehist = [float(np.sum(expected < 1)), float(np.sum((expected >= 1) & (expected < 2))),
                 float(np.sum((expected >= 2) & (expected < 3))), float(np.sum(expected >= 3))]
        tot = sum(ehist)
        exp_scaled = [max(1e-9, e / tot * sum(obs)) for e in ehist]
        chi2 = float(sum((o - e) ** 2 / e for o, e in zip(obs, exp_scaled)))
        df = len(obs) - 1
        from scipy.stats import chi2 as chi2dist
        p = float(chi2dist.sf(chi2, df))
        validation = {"chi2": chi2, "df": df, "p": p}
    except Exception as e:
        validation = {"error": "validation unavailable: " + str(e)}

    emit({"ok": True, "converged": True, "params": params, "palive": palive,
          "conditional_expected": cexp, "validation": validation})


if __name__ == "__main__":
    main()