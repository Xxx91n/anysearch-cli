#!/usr/bin/env python3
"""ADR-0042 D2/D3 (r108 impl): offline generator for the four-fixture falsification matrix.

Pure stdlib, zero dependency on the frozen lifetimes stack: fixtures must regenerate
byte-identically on any Python 3 (CI guard: --check mode, exit 2 on drift, prisma-style),
so randomness is a self-contained mulberry32 (same algorithm as the TS side) instead of
numpy. Each fixture embeds seed / BG-NBD-shaped params / generator version / windowDays
metadata; a MANIFEST.json pins every snapshot with SHA-256 plus the definition hash that
joins the eval baseline fingerprint.

T2 contract mirrors ADR-0039 D6: PSI between the pinned baseline access-age histogram and
the current histogram (same five D4 buckets). The baseline histogram is embedded in the
fixture so the two-histogram comparison is exercised exactly as in production.

Output: packages/store/fixtures/obs-feed/{pass-stable,t1-fail,t2-fail,t3-fail}.json + MANIFEST.json
"""
import hashlib
import json
import os
import sys

GENERATOR_VERSION = 2
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(ROOT, "packages", "store", "fixtures", "obs-feed")

BUCKETS = ["0-1", "2-7", "8-30", "31-90", "91+"]


def bucket_of(age: float) -> str:
    if age < 2:
        return "0-1"
    if age < 8:
        return "2-7"
    if age < 31:
        return "8-30"
    if age < 91:
        return "31-90"
    return "91+"


class Mulberry32:
    """32-bit seeded PRNG (numerically identical to the TS mulberry32 in gate.ts)."""

    def __init__(self, seed: int):
        self.state = seed & 0xFFFFFFFF

    def next(self) -> float:
        self.state = (self.state + 0x6D2B79F5) & 0xFFFFFFFF
        t = self.state
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return (((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0)


def place_events(rng: Mulberry32, spec: dict) -> list:
    """Emit {unit, ageDays} events: <units> units, <repeatUnits> of them get a repeat
    access (fittable units), ages drawn so the requested bucket profile holds."""
    events = []
    lo, hi = spec["ageRange"]
    for i in range(spec["units"]):
        uid = "u%04d" % i
        events.append({"unit": uid, "ageDays": round(lo + rng.next() * (hi - lo), 2)})
        if i < spec["repeatUnits"]:
            events.append({"unit": uid, "ageDays": round(lo + rng.next() * (hi - lo), 2)})
    if spec.get("drift"):
        d = spec["drift"]
        for e in events:
            if e["ageDays"] <= 30 and rng.next() < d["p"]:
                e["ageDays"] = d["toYoung"]  # squeeze recent mass into the 0-1 bucket
    return events


def current_histogram(events: list) -> dict:
    h = {b: 0 for b in BUCKETS}
    for e in events:
        h[bucket_of(e["ageDays"])] += 1
    return h


def baseline_histogram(rng: Mulberry32, spec: dict, current: dict) -> dict:
    """Stable fixtures: mirror the current shape (scaled x2, deterministic ±2 jitter) so PSI
    stays far below 0.25. t2-fail: explicitly concentrated elsewhere so PSI blows over."""
    mode = spec.get("baseline")
    if isinstance(mode, dict):
        return mode
    return {b: current[b] * 2 + (1 if rng.next() < 0.5 else -1) for b in BUCKETS}


# Four-fixture matrix (ADR-0042 D3). params mirror the BG/NBD-shaped story (rate gamma r/a,
# dropout beta a/b) as embedded provenance; generation itself is profile-driven — the
# fixtures exercise the gate machinery (histogram -> PSI -> AND-gate), never a fit.
DEFS = [
    {
        "name": "pass-stable",
        "seed": 42,
        "windowDays": 120,
        "spec": {"units": 180, "repeatUnits": 140, "ageRange": [0.5, 119.5], "drift": None, "baseline": "mirror"},
        "params": {"r": 0.55, "alpha": 4.4, "a": 0.79, "b": 2.4},
        "expect": "gate ok (T1 active rows / T2 stable PSI / T3 window all satisfied)",
    },
    {
        "name": "t1-fail",
        "seed": 43,
        # 140*2 + 19 = 299 active rows: T1 activeRows clause fails, fittable units still pass.
        "windowDays": 120,
        "spec": {"units": 159, "repeatUnits": 140, "ageRange": [0.5, 119.5], "drift": None, "baseline": "mirror"},
        "params": {"r": 0.55, "alpha": 4.4, "a": 0.79, "b": 2.4},
        "expect": "skip gate-not-met with T1 (299 < 300 active rows)",
    },
    {
        "name": "t2-fail",
        "seed": 44,
        "windowDays": 120,
        "spec": {
            "units": 180,
            "repeatUnits": 140,
            "ageRange": [0.5, 119.5],
            "drift": {"p": 0.85, "toYoung": 0.5},
            # pinned baseline concentrated in mid/old buckets — current is squeezed young → PSI >= 0.25.
            "baseline": {"0-1": 8, "2-7": 40, "8-30": 120, "31-90": 360, "91+": 150},
        },
        "params": {"r": 0.9, "alpha": 2.1, "a": 0.5, "b": 1.7},
        "expect": "skip gate-not-met with T2 (PSI >= 0.25 vs pinned baseline histogram)",
    },
    {
        "name": "t3-fail",
        "seed": 45,
        "windowDays": 89,  # one day under the 90d observation window
        "spec": {"units": 180, "repeatUnits": 140, "ageRange": [0.5, 88.5], "drift": None, "baseline": "mirror"},
        "params": {"r": 0.55, "alpha": 4.4, "a": 0.79, "b": 2.4},
        "expect": "skip gate-not-met with T3 (89d < 90d simulated observation window)",
    },
]


def render_fixture(d: dict) -> bytes:
    rng = Mulberry32(d["seed"])
    events = place_events(rng, d["spec"])
    cur = current_histogram(events)
    doc = {
        "schema": "anysearch/obs-fixture@1",
        # ADR-0042 D1: explicit track marker — a miswired loader can never pass synthetic
        # rows off as the consumed track.
        "track": "synthetic",
        "name": d["name"],
        "meta": {
            "seed": d["seed"],
            "generator": "scripts/tau/generate_fixtures.py",
            "generatorVersion": GENERATOR_VERSION,
            "windowDays": d["windowDays"],  # simulated clock (D5) — report label required
            "params": d["params"],
            "expect": d["expect"],
        },
        "baselineHistogram": baseline_histogram(rng, d["spec"], cur),
        "events": events,
    }
    return (json.dumps(doc, indent=2, sort_keys=True) + "\n").encode("utf-8")


def build_defs() -> dict:
    files = {}
    for d in DEFS:
        body = render_fixture(d)
        files[d["name"] + ".json"] = {"bytes": body, "sha256": hashlib.sha256(body).hexdigest()}
    # r110 SA-F-04: the definition hash must change when the generator contract or the
    # emitted event bytes change — pin generatorVersion and the per-file SHA-256s into it
    # (seedfaker --fingerprint full-contract shape; mirrors this repo's r96 bucket-def fix).
    defhash = hashlib.sha256(
        json.dumps(
            {
                "generatorVersion": GENERATOR_VERSION,
                "defs": [{"name": d["name"], "seed": d["seed"], "windowDays": d["windowDays"], "spec": d["spec"], "params": d["params"]} for d in DEFS],
                "fileSha256": {k: v["sha256"] for k, v in files.items()},
            },
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()[:16]
    manifest = {
        "schema": "anysearch/obs-fixture-manifest@1",
        "generator": "scripts/tau/generate_fixtures.py",
        "generatorVersion": GENERATOR_VERSION,
        "definitionHash": defhash,
        "files": {k: v["sha256"] for k, v in files.items()},
    }
    mbytes = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode("utf-8")
    files["MANIFEST.json"] = {"bytes": mbytes, "sha256": hashlib.sha256(mbytes).hexdigest()}
    return files


def manifest_hash(files: dict) -> str:
    return json.loads(files["MANIFEST.json"]["bytes"].decode("utf-8"))["definitionHash"]


def main() -> int:
    check = "--check" in sys.argv
    files = build_defs()
    if check:
        drift = []
        for name, rec in files.items():
            path = os.path.join(OUT_DIR, name)
            if not os.path.exists(path):
                drift.append(name + " (missing)")
                continue
            with open(path, "rb") as fh:
                if fh.read() != rec["bytes"]:
                    drift.append(name)
        if drift:
            print("fixture drift: " + ", ".join(drift) + " — regenerate with: python scripts/tau/generate_fixtures.py")
            return 2
        print("fixtures byte-identical (sha256-pinned, definitionHash " + manifest_hash(files) + ")")
        return 0
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, rec in files.items():
        with open(os.path.join(OUT_DIR, name), "wb") as fh:
            fh.write(rec["bytes"])
        print("wrote " + name + " (" + str(len(rec["bytes"])) + " B, sha256 " + rec["sha256"][:16] + "…)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
