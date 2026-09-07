// ADR-0049 D4-D9: revision lifecycle CLI over the pure core.
// The script re-enters under workspace-local tsx for extensionless TS imports.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(code, detail) {
  process.stderr.write("eval-revisions: " + detail + "\n");
  process.exit(code);
}

async function run() {
  const core = await import("../packages/store/src/eval/revision-core.ts");
  const labelsCore = await import("../packages/store/src/eval/calibration-labels.ts");
  const seed = await import("../packages/store/src/eval/calibration-cases.ts");

  // ADR-0050 D6: line is a first-class namespace. --line attribution-gold shares
  // the rev verbs but stores revisions under an isolated root; label lifecycle
  // for that line lives in scripts/attribution-gold-labels.mjs.
  const line = argValue("--line") || "calibration";
  if (!/^[a-z][a-z0-9-]*$/.test(line)) fail(2, "--line must be a slug");
  const rootEnv = line === "attribution-gold" ? "ANS_ATTRIBUTION_GOLD_REVISION_ROOT" : "ANS_CALIBRATION_REVISION_ROOT";
  const defaultRoot = line === "attribution-gold" ? "attribution-gold-revisions" : "calibration-revisions";
  const revisionRoot = process.env[rootEnv]
    ? path.resolve(process.env[rootEnv])
    : path.join(root, "packages", "store", defaultRoot);
  const statePath = path.join(revisionRoot, "state.json");
  const registryPath = path.join(revisionRoot, "registry.json");
  const journalPath = path.join(revisionRoot, "journal.jsonl");
  const tombstonesPath = path.join(revisionRoot, "tombstones.jsonl");
  const revisionsDir = path.join(revisionRoot, "revisions");
  const seedsDir = path.join(revisionRoot, "seeds");

  function mkdirs() {
    fs.mkdirSync(revisionRoot, { recursive: true });
    fs.mkdirSync(revisionsDir, { recursive: true });
    fs.mkdirSync(seedsDir, { recursive: true });
  }

  function readJson(file, fallback) {
    if (!fs.existsSync(file)) return fallback;
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { fail(2, "invalid JSON: " + file); }
  }

  function readRegistry() {
    return readJson(registryPath, { schema: core.CALIBRATION_REGISTRY_SCHEMA, entries: [] });
  }

  function readState() {
    return readJson(statePath, null);
  }

  function readJournal() {
    if (!fs.existsSync(journalPath)) return [];
    return fs.readFileSync(journalPath, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  }

  function readTombstones() {
    if (!fs.existsSync(tombstonesPath)) return [];
    return fs.readFileSync(tombstonesPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }

  function durableWrite(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(file, "w");
    try { fs.writeSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }

  function durableAppend(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(file, "a");
    try { fs.writeSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }

  function atomicState(state) {
    const tmp = path.join(revisionRoot, ".state." + process.pid + "." + Date.now() + ".json");
    durableWrite(tmp, JSON.stringify(state, null, 2) + "\n");
    try { fs.renameSync(tmp, statePath); } catch (error) { try { fs.rmSync(tmp, { force: true }); } catch { } fail(1, "atomic state rename failed: " + String(error && error.message || error)); }
  }

  function writeRegistry(registry) {
    durableWrite(registryPath, JSON.stringify(registry, null, 2) + "\n");
  }

  function appendJournal(event) {
    const events = readJournal();
    event.seq = (events.reduce((max, item) => Math.max(max, item.seq || 0), 0) + 1);
    durableAppend(journalPath, JSON.stringify(event) + "\n");
  }

  function nextVersion(registry) {
    const max = registry.entries.reduce((acc, entry) => {
      const match = /^v(\d+)$/.exec(entry.version);
      return Math.max(acc, Number(match?.[1] || 0));
    }, 0);
    return "v" + (max + 1);
  }

  function revisionPath(version) { return path.join(revisionsDir, version, "labels.jsonl"); }
  function readRevision(version) {
    const file = revisionPath(version);
    if (!fs.existsSync(file)) fail(2, "revision missing: " + version);
    try { return core.parseRevisionLabels(fs.readFileSync(file, "utf8")); } catch (error) { fail(error.code || 2, error.message); }
  }

  function writeRevision(version, records) {
    durableWrite(revisionPath(version), records.length ? records.map((r) => JSON.stringify(r)).join("\n") + "\n" : "");
  }

  function upsertRegistry(registry, entry) {
    const next = { ...registry, entries: registry.entries.filter((item) => item.version !== entry.version).concat(entry).sort((a, b) => Number(/^v(\d+)$/.exec(a.version)?.[1] || 0) - Number(/^v(\d+)$/.exec(b.version)?.[1] || 0)) };
    writeRegistry(next);
    return next;
  }

  function withLock(fn) {
    mkdirs();
    const lock = path.join(revisionRoot, ".lock");
    let fd;
    try { fd = fs.openSync(lock, "wx"); } catch { fail(2, "revision store is locked by another mutation"); }
    try { return fn(); } finally { try { fs.closeSync(fd); fs.rmSync(lock, { force: true }); } catch { } }
  }

  function requireStateForMutation() {
    const state = readState();
    if (!state) fail(2, "state.json missing; run migrate or open first");
    return state;
  }

  function currentSeedRef(state, registry) {
    if (state?.seedRef) return state.seedRef;
    const current = state?.labels ? registry.entries.find((e) => e.version === state.labels) : null;
    return current?.seedRef || core.seedRefName(seed.CALIBRATION_CASES);
  }

  function ensureSeedSnapshot(seedRef) {
    const file = path.join(seedsDir, seedRef + ".json");
    if (fs.existsSync(file)) return;
    durableWrite(file, JSON.stringify({ schema: core.CALIBRATION_SEED_SCHEMA, seedRef, fingerprint: core.seedFingerprint(seed.CALIBRATION_CASES), cases: seed.CALIBRATION_CASES }, null, 2) + "\n");
  }

  function appendTombstone(tombstone) {
    durableAppend(tombstonesPath, JSON.stringify(tombstone) + "\n");
  }

  function verifySeedSnapshot(seedRef, allowFlip) {
    const file = path.join(seedsDir, seedRef + ".json");
    if (!fs.existsSync(file)) return;
    const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
    const current = core.seedFingerprint(seed.CALIBRATION_CASES);
    if (snapshot.fingerprint !== current && !allowFlip) fail(12, "seed drift without declared flip: " + current + " != " + snapshot.fingerprint);
  }

  function commitLabels(state, registry, records, mutation) {
    const target = mutation.version || state.labels;
    if (!target) fail(2, "--version is required when no mutable labels pointer exists");
    const entry = registry.entries.find((item) => item.version === target);
    if (!entry) fail(2, "unknown revision: " + target);
    if (state.head === target) fail(2, "revision is promoted/frozen; fork a new revision first");
    const current = readRevision(target);
    const next = labelsCore.setLabel(current, mutation.label, seed.CALIBRATION_CASES);
    if (!next.ok || !next.records) fail(next.code, next.detail);
    writeRevision(target, next.records);
    const digest = core.revisionDigest(next.records);
    const now = new Date().toISOString();
    upsertRegistry(registry, { ...entry, digest, labelsFingerprint: digest });
    appendJournal({ type: "label_commit", at: now, version: target, digest, detail: next.detail });
    return { version: target, records: next.records, digest };
  }

  function parsePairs() {
    const raw = argValue("--pairs");
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { fail(2, "--pairs must be JSON array of [human, judge] tuples"); }
  }

  function promoteVersion(state, registry, version) {
    const entry = registry.entries.find((item) => item.version === version);
    if (!entry) fail(2, "unknown revision: " + version);
    const records = readRevision(version);
    const l0 = core.l0Invariants(records, seed.CALIBRATION_CASES, entry.digest);
    if (!l0.ok) fail(l0.code, l0.detail);
    const headRecords = state.head ? readRevision(state.head) : [];
    const noOp = core.rejectNoOpPromote(headRecords, records);
    if (!noOp.ok) fail(noOp.code, noOp.detail);
    const bridge = core.diffLabels(headRecords, records);
    const pairs = parsePairs();
    let l2 = null;
    if (pairs) l2 = core.evaluateL2(pairs);
    else if (argValue("--l2-report")) {
      const report = readJson(path.resolve(argValue("--l2-report")), null);
      if (!report) fail(2, "--l2-report is missing");
      l2 = report.decision === "pass" ? report : report;
    }
    if (!l2) fail(2, "promote requires --pairs or --l2-report (L2 gate)");
    if (l2.decision !== "pass") fail(l2.decision === "insufficient" ? 2 : 1, "L2 gate: " + l2.decision + " (AC1 CI=" + l2.ac1CI.map((x) => Number.isFinite(x) ? x.toFixed(3) : "NaN").join(",") + ", po=" + l2.rawAgreement.toFixed(3) + ")");
    const now = new Date().toISOString();
    const nextState = { schema: core.CALIBRATION_STATE_SCHEMA, head: version, labels: version, seedRef: entry.seedRef, schemaVersion: 1 };
    atomicState(nextState);
    appendJournal({ type: "promote", at: now, version, digest: entry.digest, detail: "L0/L1/L2 pass; bridge=" + JSON.stringify(bridge.mcnemar) });
    appendJournal({ type: "head_move", at: now, from: state.head, to: version });
    appendJournal({ type: "labels_move", at: now, from: state.labels, to: version });
    process.stdout.write("promoted " + version + " (" + entry.digest + ")\n");
  }

  function printVersion(version) { process.stdout.write(version + "\n"); }

  function doOpen(parent) {
    return withLock(() => {
      const state = requireStateForMutation();
      const registry = readRegistry();
      const baseVersion = parent || (state.labels || state.head);
      const records = baseVersion ? readRevision(baseVersion) : [];
      const version = nextVersion(registry);
      const now = new Date().toISOString();
      const seedRef = currentSeedRef(state, registry);
      ensureSeedSnapshot(seedRef);
      writeRevision(version, records);
      const digest = core.revisionDigest(records);
      const entry = { schema: core.CALIBRATION_REVISION_SCHEMA, version, digest, createdAt: now, parent: baseVersion || null, seedRef, labelsFingerprint: digest, archivedAt: null };
      upsertRegistry(registry, entry);
      const nextState = { ...state, labels: version };
      atomicState(nextState);
      appendJournal({ type: "revision_open", at: now, version, digest, parent: baseVersion || null, seedRef });
      appendJournal({ type: "labels_move", at: now, from: state.labels, to: version });
      printVersion(version);
    });
  }

  function doMigrate(apply) {
    return withLock(() => {
      const labelsPath = process.env.ANS_CALIBRATION_LABELS_PATH ? path.resolve(process.env.ANS_CALIBRATION_LABELS_PATH) : path.join(root, "packages", "store", "calibration-labels.jsonl");
      const manifestPath = process.env.ANS_CALIBRATION_MANIFEST_PATH ? path.resolve(process.env.ANS_CALIBRATION_MANIFEST_PATH) : path.join(root, "packages", "store", "calibration-manifest.json");
      if (!fs.existsSync(manifestPath)) fail(2, "old manifest missing: " + manifestPath);
      const parsed = labelsCore.parseManifest(fs.readFileSync(manifestPath, "utf8"));
      if (parsed.error || !parsed.manifest) fail(2, parsed.error || "manifest missing");
      const labelsText = fs.existsSync(labelsPath) ? fs.readFileSync(labelsPath, "utf8") : "";
      const labelResult = labelsCore.parseLabelLines(labelsText);
      if (labelResult.errors.length) fail(2, labelResult.errors.join("; "));
      const oldValidation = labelsCore.validateCalibrationState(labelResult.records, parsed.manifest, seed.CALIBRATION_CASES);
      if (!oldValidation.ok) fail(oldValidation.code, oldValidation.detail);
      const replay = core.shadowReplay(labelResult.records, parsed.manifest);
      if (!replay.ok) fail(replay.code, replay.detail);
      const plan = core.migrationPlan(labelResult.records, seed.CALIBRATION_CASES);
      if (!apply) {
        process.stdout.write(JSON.stringify({ dryRun: true, version: plan.version, digest: plan.digest, seedRef: plan.seedRef, state: plan.state, journal: plan.journal }, null, 2) + "\n");
        return;
      }
      mkdirs();
      writeRevision(plan.version, plan.records);
      durableWrite(registryPath, JSON.stringify(plan.registry, null, 2) + "\n");
      atomicState(plan.state);
      for (const event of plan.journal) appendJournal(event);
      ensureSeedSnapshot(plan.seedRef);
      process.stdout.write("migrated " + plan.version + "\n");
    });
  }

  function doPrune() {
    return withLock(() => {
      const state = requireStateForMutation();
      const registry = readRegistry();
      const plan = core.prunePlan(registry.entries, { heads: [state.head], labels: [state.labels], seedRefs: [state.seedRef] }, new Date().toISOString(), 30);
      if (process.argv.includes("--dry-run")) { process.stdout.write(JSON.stringify(plan, null, 2) + "\n"); return; }
      for (const version of plan.prune) {
        fs.rmSync(path.join(revisionsDir, version), { recursive: true, force: true });
      }
      writeRegistry({ ...registry, entries: registry.entries.filter((entry) => !plan.prune.includes(entry.version)) });
      appendJournal({ type: "archive", at: new Date().toISOString(), detail: "prune " + plan.prune.join(",") });
      process.stdout.write("pruned " + plan.prune.length + " revision(s)\n");
    });
  }

  const verb = process.argv[2];
  if (!verb) fail(2, "verb is required: rev <open|fork|commit|promote|rollback|switch|list|archive|prune|verify|migrate>");

  if (verb === "rev") {
    const sub = process.argv[3];
    if (!sub) fail(2, "rev subcommand is required");
    const state = (sub === "verify" || sub === "list" || sub === "migrate" || sub === "open" || sub === "fork") ? readState() : requireStateForMutation();
    const registry = readRegistry();
    if (sub === "open" || sub === "fork") { doOpen(sub === "fork" ? argValue("--from") || argValue("--parent") : argValue("--parent")); }
    else if (sub === "commit") {
      withLock(() => {
        if (argValue("--retire-case")) {
          const target = argValue("--version") || state.labels;
          const entry = registry.entries.find((item) => item.version === target);
          if (!target || !entry) fail(2, "--version is required for retire-case");
          if (state.head === target) fail(2, "revision is promoted/frozen; fork a new revision first");
          const reason = argValue("--reason");
          if (!reason) fail(2, "--reason is required for retire-case");
          appendTombstone(core.makeCaseRetireTombstone(argValue("--retire-case"), argValue("--at") || new Date().toISOString(), reason, argValue("--superseded-by")));
          appendJournal({ type: "case_retire", at: new Date().toISOString(), version: target, caseId: argValue("--retire-case"), reason, supersededBy: argValue("--superseded-by") });
          process.stdout.write("retired " + argValue("--retire-case") + "\n");
          return;
        }
        const mutation = {
          version: argValue("--version") || state.labels,
          label: {
            schema: "anysearch/calibration-label@1",
            caseId: argValue("--case"),
            label: Number(argValue("--label")),
            annotator: argValue("--annotator"),
            annotatedAt: argValue("--at") || new Date().toISOString(),
            ...(argValue("--note") ? { note: argValue("--note") } : {}),
          },
        };
        if (!mutation.label.caseId) fail(2, "--case is required");
        if (!mutation.label.annotator) fail(2, "--annotator is required");
        if (mutation.label.label !== 0 && mutation.label.label !== 1) fail(2, "--label must be 0 or 1");
        const result = commitLabels(state, registry, [], mutation);
        process.stdout.write(result.version + " " + result.digest + "\n");
      });
    }
    else if (sub === "promote") { withLock(() => promoteVersion(state, registry, argValue("--version") || state.labels)); }
    else if (sub === "rollback" || sub === "switch") {
      withLock(() => {
        const target = argValue("--to") || argValue("--version");
        if (!target) fail(2, "--to is required");
        if (!registry.entries.some((entry) => entry.version === target)) fail(2, "unknown revision: " + target);
        atomicState({ ...state, head: target, labels: target });
        appendJournal({ type: "head_move", at: new Date().toISOString(), from: state.head, to: target });
        process.stdout.write("head=" + target + "\n");
      });
    }
    else if (sub === "list") {
      const lines = registry.entries.map((entry) => [entry.version, entry.digest, entry.createdAt, state.head === entry.version ? "head" : "", state.labels === entry.version ? "labels" : "", entry.archivedAt || ""].join("\t"));
      process.stdout.write(lines.length ? lines.join("\n") + "\n" : "no revisions\n");
    }
    else if (sub === "archive") {
      withLock(() => {
        const target = argValue("--version");
        if (!target) fail(2, "--version is required");
        if (state.head === target || state.labels === target) fail(2, "cannot archive pinned revision");
        const entry = registry.entries.find((item) => item.version === target);
        if (!entry) fail(2, "unknown revision: " + target);
        upsertRegistry(registry, { ...entry, archivedAt: new Date().toISOString() });
        appendJournal({ type: "archive", at: new Date().toISOString(), version: target });
        process.stdout.write("archived " + target + "\n");
      });
    }
    else if (sub === "prune") doPrune();
    else if (sub === "verify") {
      if (!state) fail(2, "state.json missing");
      if (state.schema !== core.CALIBRATION_STATE_SCHEMA) fail(2, "unknown state schema: " + state.schema);
      if (registry.schema !== core.CALIBRATION_REGISTRY_SCHEMA) fail(2, "unknown registry schema: " + registry.schema);
      for (const tombstone of readTombstones()) {
        if (tombstone.schema !== core.CALIBRATION_TOMBSTONE_SCHEMA) fail(2, "unknown tombstone schema: " + tombstone.schema);
      }
      verifySeedSnapshot(state.seedRef, process.argv.includes("--seed-flip"));
      for (const version of [state.head, state.labels].filter(Boolean)) {
        const entry = (registry.entries || []).find((item) => item.version === version);
        if (!entry) fail(2, "pointer references missing revision " + version);
        const records = readRevision(version);
        const l0 = core.l0Invariants(records, seed.CALIBRATION_CASES, entry.digest);
        if (!l0.ok) fail(l0.code, l0.detail);
      }
      process.stdout.write("verify: pass\n");
    }
    else if (sub === "migrate") doMigrate(process.argv.includes("--apply"));
    else fail(2, "unknown rev subcommand: " + sub);
  } else {
    fail(2, "first verb must be rev");
  }
}

if (process.env.ANS_EVAL_REVISIONS_TSX !== "1") {
  const loader = pathToFileURL(path.join(root, "packages", "store", "node_modules", "tsx", "dist", "loader.mjs")).href;
  const entry = path.relative(process.cwd(), scriptPath).split(path.sep).join("/");
  const child = spawnSync(process.execPath, ["--import", loader, entry, ...process.argv.slice(2)], {
    env: { ...process.env, ANS_EVAL_REVISIONS_TSX: "1" },
    stdio: "inherit",
  });
  process.exit(child.status ?? 2);
}

run().catch((error) => {
  console.error("eval-revisions: internal error: " + String(error && error.stack || error));
  process.exit(2);
});
