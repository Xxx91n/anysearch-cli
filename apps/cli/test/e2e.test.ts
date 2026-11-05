import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// CLI exit-assertion e2e. Spawn the real dist/ bundle and
// assert process exit codes + minimal stdout invariants. No mocks — this is
// a public-contract surface. Run after 'build' (dist/index.js must exist).

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, "..", "dist", "index.js");

let passed = 0;
let failed = 0;

async function run(args: string[], env?: NodeJS.ProcessEnv, cwd?: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [DIST, ...args], { stdio: ["ignore", "pipe", "pipe"], ...(env ? { env } : {}), ...(cwd ? { cwd } : {}) });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code: code ?? 1, out }));
    p.on("error", reject);
    setTimeout(() => { p.kill(); reject(new Error("timeout " + args[0])); }, 15000);
  });
}

// Spawn and resolve once `pattern` appears in the combined output and the
// child has closed. Pre-flight assertions (domain/DB init warnings) must not
// wait for an LLM round-trip; the child is killed at the marker.
async function runUntil(args: string[], env: NodeJS.ProcessEnv, pattern: RegExp): Promise<{ out: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [DIST, ...args], { stdio: ["ignore", "pipe", "pipe"], env });
    let out = "";
    let matched = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Release the child on every failure path (timeout / unmatched close /
      // spawn error); kill is harmless once it has already exited.
      p.kill();
      reject(err);
    };
    timer = setTimeout(() => fail(new Error("timeout " + args[0])), 15000);
    const onData = (d: Buffer) => {
      out += d.toString();
      if (!settled && !matched && pattern.test(out)) {
        matched = true;
        p.kill();
        // The marker was observed; only the post-kill close needs a bound now.
        clearTimeout(timer);
        timer = setTimeout(() => fail(new Error("child did not close: " + args[0])), 5000);
      }
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    // Resolve only on a matched, clean close: an early crash that prints the
    // pre-marker warnings must reject instead of silently passing.
    p.on("close", () => {
      if (settled) return;
      if (!matched) return fail(new Error("marker never matched: " + args[0] + "\n" + out));
      settled = true;
      clearTimeout(timer);
      resolve({ out });
    });
    p.on("error", (e) => fail(e));
  });
}

// #180: spawn with stdout/stderr kept apart. For --json purity assertions the
// stdout stream alone must be a single JSON document — the kernel's
// construction diagnostic rides stderr and must never leak into stdout.
async function runSplit(args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [DIST, ...args], { stdio: ["ignore", "pipe", "pipe"], ...(env ? { env } : {}) });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    p.on("error", reject);
    setTimeout(() => { p.kill(); reject(new Error("timeout " + args[0])); }, 15000);
  });
}

async function t(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log("ok - " + name);
  } catch (e: any) {
    failed++;
    console.error("FAIL - " + name + ": " + (e?.message || String(e)));
  }
}

(async () => {
  await t("--help exits 0 and lists all 9 commands", async () => {
    const r = await run(["--help"]);
    assert.equal(r.code, 0);
    for (const cmd of ["doctor", "auth", "llm", "skill", "search", "chat", "recommend", "domain", "mcp"]) {
      assert.ok(r.out.includes(cmd), "missing " + cmd);
    }
  });

  await t("--version prints pinned version (not 0.0.0)", async () => {
    const r = await run(["--version"]);
    assert.equal(r.code, 0);
    // version pinned to package.json (currently 0.0.1);
    // assert it is NOT the 0.0.0 placeholder and matches SemVer-ish shape.
    assert.doesNotMatch(r.out, /\b0\.0\.0\b/);
    assert.match(r.out, /\d+\.\d+\.\d+(-[\w.]+)?/);
  });

  await t("unknown command exits 2 with error message", async () => {
    const r = await run(["not-a-command"]);
    assert.equal(r.code, 2);
    assert.match(r.out, /unknown command/);
  });

  await t("doctor runs smoke suite and exits 0", async () => {
    const r = await run(["doctor"]);
    assert.equal(r.code, 0, "doctor stdout: " + r.out.slice(0, 500));
    for (const marker of ["[OK]", "Result:", "passed"]) {
      assert.ok(r.out.includes(marker), "missing " + marker);
    }
    // B1: doctor surfaces the real domains section + the docs domain.
    assert.ok(r.out.includes("[5] Domains"), "missing domains section");
    assert.ok(r.out.includes("docs"), "docs domain not listed");
  });

  await t("llm (no args) prints provider list, exit 0", async () => {
    const r = await run(["llm"]);
    assert.equal(r.code, 0);
    for (const p of ["openai", "anthropic", "google"]) assert.ok(r.out.includes(p), "missing " + p);
  });

  await t("llm bogus subcommand exits 2", async () => {
    const r = await run(["llm", "bogus"]);
    assert.equal(r.code, 2);
  });

  await t("llm models openai lists models", async () => {
    const r = await run(["llm", "models", "openai"]);
    assert.equal(r.code, 0);
    assert.ok(r.out.includes("gpt-5"));
  });

  await t("chat without LLM env exits 3", async () => {
    // nit fix: sanitize ambient ANS_LLM_* — the test asserts the
    // no-LLM-env behavior, so a developer machine with a configured provider
    // must not leak it into the child process.
    const cleanEnv = { ...process.env };
    for (const k of Object.keys(cleanEnv)) if (k.startsWith("ANS_LLM_")) delete cleanEnv[k];
    const r = await run(["chat", "hello"], cleanEnv);
    assert.equal(r.code, 3);
    assert.match(r.out, /LLM provider not configured|ANS_LLM_PROVIDER/);
  });

  // #162: a configured-but-broken domain must fail closed. `ans chat` used to
  // warn and fall back to the default domain, silently discarding the
  // operator's validated policy (allowlist / weights / compaction).
  await t("chat with malformed domain TOML fails fast on Domain schema", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-e2e-chat-bad-domain-"));
    try {
      fs.writeFileSync(path.join(dir, "badlow.toml"), [
        'name = "badlow"',
        "[rag]",
        'adapter = "none"',
        "[compaction]",
        "lowWatermark = 49999",
        "",
      ].join("\n"), "utf8");
      // Sanitize ambient LLM config; explicit flags + a dead local endpoint are
      // enough to build the session (no network happens before the domain load).
      const env = { ...process.env };
      for (const k of Object.keys(env)) if (k.startsWith("ANS_LLM_")) delete env[k];
      const r = await run([
        "chat", "hello",
        "--llm.provider", "openai",
        "--llm.model", "gpt-5",
        "--llm.base-url", "http://127.0.0.1:1/v1",
        "--llm.api", "chat",
      ], {
        ...env,
        ANS_DOMAINS_DIR: dir,
        ANS_DOMAIN: "badlow",
        ANS_DB_PATH: path.join(dir, "anysearch.db"),
      });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /Domain schema: compaction\.lowWatermark/);
      assert.doesNotMatch(r.out, /using fallback/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // #162: the availability fallback for an unusable durable DB is deliberate and
  // must stay. A file where the DB parent directory should be makes both the
  // initial and the fallback persistent-engine builds fail deterministically
  // (no SQLite path quirks). The child is killed at the post-fallback banner
  // (`ans chat: hello`): the banner proves the in-memory engine and runtime
  // were constructed, while the provider round-trip that follows is irrelevant
  // to this contract.
  await t("chat keeps in-memory fallback when the durable DB is unavailable", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-e2e-chat-nodb-"));
    try {
      const blocker = path.join(dir, "not-a-dir");
      fs.writeFileSync(blocker, "x", "utf8");
      const env = { ...process.env };
      for (const k of Object.keys(env)) if (k.startsWith("ANS_LLM_")) delete env[k];
      const r = await runUntil([
        "chat", "hello",
        "--llm.provider", "openai",
        "--llm.model", "gpt-5",
        "--llm.base-url", "http://127.0.0.1:1/v1",
        "--llm.api", "chat",
      ], {
        ...env,
        ANS_DB_PATH: path.join(blocker, "anysearch.db"),
      }, /ans chat: hello/);
      assert.match(r.out, /Durable database unavailable/);
      assert.match(r.out, /in-memory store/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t("mcp --help exits 0 (mcp subcommand dependency smoke)", async () => {
    const r = await run(["mcp", "--help"]);
    assert.equal(r.code, 0);
  });

  await t("pref review lists quarantine state, exit 0", async () => {
    const r = await run(["pref", "review"]);
    assert.equal(r.code, 0);
    assert.ok(/quarantine|entity=/.test(r.out), "unexpected out: " + r.out.slice(0, 300));
  });

  await t("pref review --keep unknown id exits 1", async () => {
    const r = await run(["pref", "review", "--keep", "999999"]);
    assert.equal(r.code, 1);
  });

  // malformed vertical input is fail-fast at the CLI boundary —
  // aligned with the MCP schema-rejection direction (draft).
  await t("search --vertical-domain '' exits 2 (empty domain)", async () => {
    const r = await run(["search", "q", "--vertical-domain", ""]);
    assert.equal(r.code, 2);
    assert.match(r.out, /non-empty string/);
  });

  await t("search --vertical-domain (bare, no value) exits 2", async () => {
    const r = await run(["search", "q", "--vertical-domain"]);
    assert.equal(r.code, 2);
    assert.match(r.out, /requires a value/);
  });

  await t("search --vertical-domain --json exits 2 (flag-as-value)", async () => {
    const r = await run(["search", "q", "--vertical-domain", "--json"]);
    assert.equal(r.code, 2);
    assert.match(r.out, /requires a value/);
  });

  await t("search --vertical-sub-domain '' exits 2 (empty sub)", async () => {
    const r = await run(["search", "q", "--vertical-domain", "finance", "--vertical-sub-domain", ""]);
    assert.equal(r.code, 2);
    assert.match(r.out, /non-empty string/);
  });

  await t("search --vertical-params '[1]' exits 2 (non-Record)", async () => {
    const r = await run(["search", "q", "--vertical-domain", "finance", "--vertical-params", "[1]"]);
    assert.equal(r.code, 2);
    assert.match(r.out, /must be a JSON object/);
  });

  await t("search --vertical-params without --vertical-domain exits 2", async () => {
    const r = await run(["search", "q", "--vertical-params", "{\"type\":\"earnings\"}"]);
    assert.equal(r.code, 2);
    assert.match(r.out, /require --vertical-domain/);
    // ③: golden — the require-domain error line is
    // byte-identical across the a06 consolidation (assertion carrier for
    // the frozen error shape; exact line, not a regex window).
    assert.ok(
      r.out.split("\n").includes("ans search: --vertical-sub-domain/--vertical-params require --vertical-domain"),
      "byte-identical golden: require-domain stderr line",
    );
  });

  await t("search --vertical-sub-domain without --vertical-domain exits 2 (golden)", async () => {
    const r = await run(["search", "q", "--vertical-sub-domain", "earnings"]);
    assert.equal(r.code, 2);
    assert.ok(
      r.out.split("\n").includes("ans search: --vertical-sub-domain/--vertical-params require --vertical-domain"),
      "byte-identical golden: require-domain stderr line",
    );
  });

  // positional flag-value consumption — a query term
  // identical to a flag value must survive; the old flagValueSet heuristic
  // swallowed it via set-membership removal. --json echoes the cleaned query.
  await t("search q finance --vertical-domain finance keeps the query word (a03 no-swallow)", async () => {
    const r = await run(["search", "q", "finance", "--vertical-domain", "finance", "--json"]);
    assert.match(r.out, /"query": "q finance"/);
  });

  await t("search q deep --mode deep keeps the query word (a03 no-swallow)", async () => {
    const r = await run(["search", "q", "deep", "--mode", "deep", "--json"]);
    assert.match(r.out, /"query": "q deep"/);
    assert.match(r.out, /"mode": "deep"/);
  });

  // audit: the spec's literal case — lone word identical to the flag value
  // collapses under the old heuristic (query would be empty), survives now.
  await t("search --vertical-domain finance finance keeps the lone identical word (a03 spec case)", async () => {
    const r = await run(["search", "--vertical-domain", "finance", "finance", "--json"]);
    assert.match(r.out, /"query": "finance"/);
  });

  // rework: the TOML leg of —
  // a domain file with a malformed sources.vertical must fail fast at the
  // user surface (explicit error, non-zero exit), not silently fall back to
  // full-fanout with the whole domain dropped.
  await t("search with malformed sources.vertical TOML fails fast", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-e2e-badtoml-"));
    try {
      fs.writeFileSync(path.join(dir, "badvert.toml"), [
        'name = "badvert"',
        '[sources]',
        'enabled = ["anysearch"]',
        '[sources.vertical]',
        'domain = "finance"',
        'bogus_key = "x"',
        '[rag]',
        'adapter = "none"',
        "",
      ].join("\n"), "utf8");
      const r = await run(["search", "q", "--json"], { ...process.env, ANS_DOMAINS_DIR: dir, ANS_DOMAIN: "badvert" });
      assert.notEqual(r.code, 0);
      assert.match(r.out, /sources\.vertical|Domain schema/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // #167: syntax error TOML must also fail fast (same Domain schema: family
  // as the validation fault above, but via smol-toml parse, not validate).
  // The file exists but is unparseable (missing quote/bracket), so the CLI
  // must not silently fall back to full fanout.
  await t("search with malformed syntax TOML fails fast", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-e2e-badsyntax-"));
    try {
      fs.writeFileSync(path.join(dir, "badsyntax.toml"), 'name = "oops\n[rag]\nadapter = "none"\n', "utf8");
      const r = await run(["search", "q", "--json"], { ...process.env, ANS_DOMAINS_DIR: dir, ANS_DOMAIN: "badsyntax" });
      assert.notEqual(r.code, 0);
      assert.match(r.out, /Domain schema/i);
      assert.match(r.out, /Invalid TOML|badsyntax\.toml/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // #167: inheritance chain broken (base missing) is a configuration error,
  // same fail-fast family as validation/parse. Absent domain (Domain not found)
  // stays fallback, but a present file whose base points nowhere must error.
  await t("search with missing base domain fails fast", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-e2e-badbase-"));
    try {
      fs.writeFileSync(path.join(dir, "child.toml"), 'name = "child"\nbase = "missingbase"\n[rag]\nadapter = "none"\n', "utf8");
      const r = await run(["search", "q", "--json"], { ...process.env, ANS_DOMAINS_DIR: dir, ANS_DOMAIN: "child" });
      assert.notEqual(r.code, 0);
      assert.match(r.out, /Domain schema.*Base domain not found/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // #180: provider construction absences surface in the existing command
  // output — which provider is missing from the fanout and under which safe
  // category (CWE-532 wording rides verbatim; raw error text never does).
  // EXA_API_KEY is set to an explicit empty string: rehydrateConfigEnv never
  // overwrites explicit values (not even empty ones), so a developer's
  // persisted key cannot re-arm exa mid-test.
  //
  // All-absent arm case: with every enabled arm failing construction the
  // kernel engine throws "No providers registered" (pinned contract,
  // engine.test.ts) before any envelope exists — the runtime chain lines never
  // render, so the absence note rides the error path instead (stderr, keeping
  // the --json stdout contract pure even on the error path). Zero network.
  await t("search error path prints provider build-failure absence line (all arms absent)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-e2e-builderr-"));
    try {
      fs.writeFileSync(path.join(dir, "exaonly.toml"), [
        'name = "exaonly"',
        "[sources]",
        'enabled = ["exa"]',
        "[rag]",
        'adapter = "none"',
        "",
      ].join("\n"), "utf8");
      const env: NodeJS.ProcessEnv = { ...process.env, ANS_DOMAINS_DIR: dir, ANS_DOMAIN: "exaonly", ANS_DB_PATH: path.join(dir, "anysearch.db") };
      env.EXA_API_KEY = "";
      // Sanitize the eval-channel provider filter: a shell-leftover value
      // (e.g. ANS_PROVIDERS=exa) would fan the engine down to zero arms and
      // turn this fixture red. Explicit empty string — rehydrateConfigEnv
      // never overwrites explicit values.
      env.ANS_PROVIDERS = "";
      const r = await run(["search", "q"], env);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /ans search error: No providers registered/);
      assert.ok(
        r.out.split("\n").includes("Providers absent (build failure): exa — permanent: missing/invalid credential — set the provider's API key env"),
        "absence line names the provider and its safe category on the error path; got: " + r.out.slice(-400),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Partial absence (the presentation path that completes): exa fails
  // construction while anysearch (optional key) constructs fine, so the run
  // reaches the abstain branch — the urlAllowlist gate deterministically
  // empties the pool whatever anysearch returns. The absence line renders on
  // stdout next to the runtime chain lines.
  await t("search prints provider build-failure absence line (abstain branch)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-e2e-builderr2-"));
    try {
      fs.writeFileSync(path.join(dir, "partial.toml"), [
        'name = "partial"',
        "[sources]",
        'enabled = ["exa", "anysearch"]',
        'urlAllowlist = ["nonexistent.invalid"]',
        "[rag]",
        'adapter = "none"',
        "",
      ].join("\n"), "utf8");
      const env: NodeJS.ProcessEnv = { ...process.env, ANS_DOMAINS_DIR: dir, ANS_DOMAIN: "partial", ANS_DB_PATH: path.join(dir, "anysearch.db") };
      env.EXA_API_KEY = "";
      env.ANS_PROVIDERS = "";
      // Hermetic allowlist: an ambient ANS_URL_ALLOWLIST (union-only, gated by
      // ANS_ALLOW_ENV_OVERRIDE) could let anysearch results survive the gate
      // and flip this abstain fixture. "0" disables env override — the TOML
      // allowlist stays authoritative.
      env.ANS_ALLOW_ENV_OVERRIDE = "0";
      // Dead-port fault injection (CodeRabbit Major, PR #194; the
      // install-smoke pattern): keeps this fixture independent of the live
      // AnySearch endpoint — the arm still constructs and is still queried,
      // it just fails fast with ECONNREFUSED instead of depending on
      // live-endpoint timing.
      env.ANYSEARCH_ENDPOINT = "http://127.0.0.1:9";
      const r = await run(["search", "q"], env);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /abstain: no results within allowed partial domain/);
      assert.match(r.out, /Providers queried: anysearch/);
      assert.ok(
        r.out.split("\n").includes("Providers absent (build failure): exa — permanent: missing/invalid credential — set the provider's API key env"),
        "absence line on the abstain branch; got: " + r.out.slice(-400),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // --json contract for the same partial-absence domain: stdout is a single
  // JSON document (the kernel's construction diagnostic rides stderr and
  // never leaks into stdout); the structured field carries the safe category.
  // providersFailed is NOT asserted — the pairing surface under test is the
  // build-absence record; the anysearch arm rides the same dead-port fault
  // injection as the abstain fixture above.
  await t("search --json carries providerBuildErrors with stdout purity", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-e2e-builderr3-"));
    try {
      fs.writeFileSync(path.join(dir, "partial.toml"), [
        'name = "partial"',
        "[sources]",
        'enabled = ["exa", "anysearch"]',
        'urlAllowlist = ["nonexistent.invalid"]',
        "[rag]",
        'adapter = "none"',
        "",
      ].join("\n"), "utf8");
      const env: NodeJS.ProcessEnv = { ...process.env, ANS_DOMAINS_DIR: dir, ANS_DOMAIN: "partial", ANS_DB_PATH: path.join(dir, "anysearch.db") };
      env.EXA_API_KEY = "";
      env.ANS_PROVIDERS = "";
      env.ANS_ALLOW_ENV_OVERRIDE = "0";
      // Same dead-port fault injection as the abstain fixture above — no
      // live-endpoint dependency (CodeRabbit Major, PR #194).
      env.ANYSEARCH_ENDPOINT = "http://127.0.0.1:9";
      const r = await runSplit(["search", "q", "--json"], env);
      const doc = JSON.parse(r.stdout);
      assert.equal(doc.providerBuildErrors.exa, "permanent: missing/invalid credential — set the provider's API key env",
        "structured field carries the safe category verbatim");
      assert.match(r.stderr, /\[anysearch\] provider exa construction failed: /);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Error-path --json purity (the sibling of the success-path test above):
  // with every arm absent the engine throws before any envelope exists, so
  // stdout must stay empty — the error line AND the absence note ride stderr.
  // Pinned because "--json stdout purity holds on the error path too" is an
  // explicit contract claim of #180 (search.ts catch + CHANGELOG).
  await t("search --json error path keeps stdout pure (all arms absent)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-e2e-builderr4-"));
    try {
      fs.writeFileSync(path.join(dir, "exaonly.toml"), [
        'name = "exaonly"',
        "[sources]",
        'enabled = ["exa"]',
        "[rag]",
        'adapter = "none"',
        "",
      ].join("\n"), "utf8");
      const env: NodeJS.ProcessEnv = { ...process.env, ANS_DOMAINS_DIR: dir, ANS_DOMAIN: "exaonly", ANS_DB_PATH: path.join(dir, "anysearch.db") };
      env.EXA_API_KEY = "";
      env.ANS_PROVIDERS = "";
      const r = await runSplit(["search", "q", "--json"], env);
      assert.equal(r.code, 1, r.stderr + r.stdout);
      assert.equal(r.stdout, "", "error path keeps --json stdout pure (empty, no absence line)");
      assert.match(r.stderr, /ans search error: No providers registered/);
      assert.ok(
        r.stderr.split("\n").includes("Providers absent (build failure): exa — permanent: missing/invalid credential — set the provider's API key env"),
        "absence note rides stderr on the --json error path; got: " + r.stderr.slice(-400),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Healthy path + the failure-surface discriminator: a dummy key lets exa
  // CONSTRUCT (kernel contract: presence, not reachability) — the record
  // empties and the absence line must not print (zero noise). The runtime 401
  // failure then rides the sibling "Providers failed" line instead: the two
  // failure surfaces (build absence vs runtime failure) stay discriminated.
  // No urlAllowlist: the 0-results run renders through the results branch.
  await t("search stays zero-noise on provider absence when every arm built", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-e2e-buildok-"));
    try {
      fs.writeFileSync(path.join(dir, "exaonly.toml"), [
        'name = "exaonly"',
        "[sources]",
        'enabled = ["exa"]',
        "[rag]",
        'adapter = "none"',
        "",
      ].join("\n"), "utf8");
      const env: NodeJS.ProcessEnv = { ...process.env, ANS_DOMAINS_DIR: dir, ANS_DOMAIN: "exaonly", ANS_DB_PATH: path.join(dir, "anysearch.db") };
      env.EXA_API_KEY = "test-dummy-key";
      env.ANS_PROVIDERS = "";
      // Same hermetic-allowlist guard as the partial-absence fixtures: exa
      // builds here, so policy is parsed — an ambient URL-policy env override
      // would flip the abstain/results branch and with it the exit code.
      env.ANS_ALLOW_ENV_OVERRIDE = "0";
      const r = await run(["search", "q"], env);
      assert.equal(r.code, 1, r.out);
      assert.ok(!r.out.includes("Providers absent"), "healthy build: no absence line (zero noise)");
      assert.ok(r.out.includes("Providers failed: exa"), "runtime failure rides the failed line, not the absence line");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t("chat with malformed syntax TOML fails fast", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-e2e-chat-badsyntax-"));
    try {
      fs.writeFileSync(path.join(dir, "badsyntax.toml"), 'name = "oops\n[rag]\nadapter = "none"\n', "utf8");
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const k of Object.keys(env)) if (k.startsWith("ANS_LLM_")) delete env[k];
      const r = await run(["chat", "hello", "--llm.provider", "openai", "--llm.model", "gpt-5", "--llm.base-url", "http://127.0.0.1:1/v1", "--llm.api", "chat"], { ...env, ANS_DOMAINS_DIR: dir, ANS_DOMAIN: "badsyntax", ANS_DB_PATH: path.join(dir, "anysearch.db") });
      assert.equal(r.code, 1);
      assert.match(r.out, /Domain schema/i);
      assert.doesNotMatch(r.out, /using fallback/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t("chat with missing base domain fails fast", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-e2e-chat-badbase-"));
    try {
      fs.writeFileSync(path.join(dir, "child.toml"), 'name = "child"\nbase = "missingbase"\n[rag]\nadapter = "none"\n', "utf8");
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const k of Object.keys(env)) if (k.startsWith("ANS_LLM_")) delete env[k];
      const r = await run(["chat", "hello", "--llm.provider", "openai", "--llm.model", "gpt-5", "--llm.base-url", "http://127.0.0.1:1/v1", "--llm.api", "chat"], { ...env, ANS_DOMAINS_DIR: dir, ANS_DOMAIN: "child", ANS_DB_PATH: path.join(dir, "anysearch.db") });
      assert.equal(r.code, 1);
      assert.match(r.out, /Domain schema.*Base domain not found/i);
      assert.doesNotMatch(r.out, /using fallback/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t("skill install → validate → list → uninstall on the shipped bundle (#109)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const { execFileSync } = await import("node:child_process");
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ans-skill-e2e-"));
    const home = path.join(base, "home");
    const cwd = path.join(base, "project");
    const source = path.join(base, "source");
    try {
      for (const dir of [home, cwd, source]) fs.mkdirSync(dir, { recursive: true });
      const git = (args: string[]) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      git(["init", "--quiet"]);
      git(["config", "user.name", "Skill E2E"]);
      git(["config", "user.email", "skill-e2e@example.invalid"]);
      git(["config", "commit.gpgsign", "false"]);
      fs.writeFileSync(path.join(source, "SKILL.md"), "---\nname: e2e-skill\ndescription: Bundled CLI test\n---\nInstructions.\n");
      git(["add", "SKILL.md"]);
      git(["commit", "--quiet", "-m", "skill"]);
      git(["tag", "v1.0.0"]);
      fs.mkdirSync(path.join(cwd, "domains"));
      const domainPath = path.join(cwd, "domains", "research.toml");
      const domain = '[skills]\nactive = ["existing"]\n';
      fs.writeFileSync(domainPath, domain);
      const env = { ...process.env, HOME: home, USERPROFILE: home };
      const installed = await run(["skill", "install", source, "--project"], env, cwd);
      assert.equal(installed.code, 0, installed.out);
      assert.equal(fs.readFileSync(domainPath, "utf8"), domain);
      const validated = await run(["skill", "validate", "--project"], env, cwd);
      assert.equal(validated.code, 0, validated.out);
      assert.match(validated.out, /\[OK\] e2e-skill/);
      const listed = await run(["skill", "list", "--project"], env, cwd);
      assert.equal(listed.code, 0, listed.out);
      assert.match(listed.out, /e2e-skill.*v1\.0\.0/);
      const manifestPath = path.join(cwd, ".anysearch", "skills", "synced", "installed.json");
      fs.writeFileSync(manifestPath, "{broken");
      const refused = await run(["skill", "uninstall", "e2e-skill", "--project"], env, cwd);
      assert.equal(refused.code, 1, refused.out);
      assert.ok(fs.existsSync(path.join(cwd, ".anysearch", "skills", "synced", "e2e-skill", "SKILL.md")));
      fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, skills: {
        "e2e-skill": { name: "e2e-skill", source, commit: git(["rev-parse", "HEAD"]), tag: "v1.0.0", dirty: false },
      } }));
      const removed = await run(["skill", "uninstall", "e2e-skill", "--project"], env, cwd);
      assert.equal(removed.code, 0, removed.out);
      assert.equal(fs.existsSync(path.join(cwd, ".anysearch", "skills", "synced", "e2e-skill")), false);
      assert.equal(fs.readFileSync(domainPath, "utf8"), domain);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  console.log("---");
  console.log("CLI e2e: " + passed + " passed, " + failed + " failed");
  process.exit(failed === 0 ? 0 : 1);
})();
