// #301 acceptance — the user credential file: one key entered once, read by the
// CLI and by a GUI-style entry that inherits NO shell env, with the key bound
// to a provider (and, for model providers, an endpoint).
//
// The access-protection checks drive the REAL platform path: POSIX mode bits on
// POSIX, a parsed Windows DACL through icacls on Windows. The Windows cases are
// skipped off Windows instead of being faked, because a POSIX mode must never
// stand in for an ACL (spec S2).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CREDENTIAL_FILE_FAULT_ERRNOS,
  CREDENTIAL_PROVIDERS,
  credentialProtectionSeam,
  displayEndpoint,
  lookupModelCredential,
  normalizeBindingEndpoint,
  readUserCredentials,
  removeUserCredential,
  resolveSearchCredentials,
  SEARCH_PROVIDER_ENV_KEYS,
  SEARCH_PROVIDER_IDS,
  userCredentialsPath,
  verifyFileProtection,
  writeUserCredential,
} from "../src/credentials";
import { resolveLlmConfig, writeUserLlmConfig } from "../src/config-llm";

function tempRoot(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "ans-cred-"));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

const KEY = "sk-test-ABCDEFGHIJKLMNOP-zero-zero";

test("every search provider in the catalog is one this resolver actually fills", () => {
  // Adding a search provider to CREDENTIAL_PROVIDERS without adding it to
  // SEARCH_PROVIDER_IDS would leave it resolved by nobody and reported by
  // nothing: doctor would skip it silently. Fail here instead.
  const declared = CREDENTIAL_PROVIDERS.filter((p) => p.kind === "search").map((p) => p.id).sort();
  assert.deepEqual([...SEARCH_PROVIDER_IDS].sort(), declared);
  assert.deepEqual(Object.keys(SEARCH_PROVIDER_ENV_KEYS).sort(), declared);
});

test("a stored key is readable with NO environment at all (the GUI case)", () => {
  const { home, cleanup } = tempRoot();
  try {
    const path = writeUserCredential({ provider: "openai", apiKey: KEY }, { home });
    assert.equal(path, userCredentialsPath(home));
    // An empty env stands for a GUI host that inherited no shell variables.
    const resolved = resolveSearchCredentials({}, { home });
    assert.deepEqual(resolved.warnings, []);
    const file = readUserCredentials({ home });
    assert.equal(file.bindings.length, 1);
    assert.equal(file.bindings[0]?.provider, "openai");
    assert.equal(file.bindings[0]?.apiKey, KEY);
  } finally { cleanup(); }
});

test("search keys reach the three arms from the file, and env wins per provider", () => {
  const { home, cleanup } = tempRoot();
  try {
    writeUserCredential({ provider: "tavily", apiKey: "tvly-stored" }, { home });
    writeUserCredential({ provider: "exa", apiKey: "exa-stored" }, { home });
    writeUserCredential({ provider: "anysearch", apiKey: "as-stored" }, { home });

    const silent = resolveSearchCredentials({}, { home });
    assert.equal(silent.tavily?.apiKey, "tvly-stored");
    assert.equal(silent.tavily?.source, "user");
    assert.equal(silent.exa?.apiKey, "exa-stored");
    assert.equal(silent.anysearch?.apiKey, "as-stored");
    assert.equal(silent.anysearch?.source, "user");

    // One explicit env value overrides only its own provider.
    const mixed = resolveSearchCredentials({ EXA_API_KEY: "exa-from-env" }, { home });
    assert.equal(mixed.exa?.apiKey, "exa-from-env");
    assert.equal(mixed.exa?.source, "env");
    assert.equal(mixed.tavily?.apiKey, "tvly-stored");
    assert.equal(mixed.tavily?.source, "user");
  } finally { cleanup(); }
});

test("an endpoint-only ANYSEARCH_ENDPOINT still reaches the arm with no key", () => {
  const { home, cleanup } = tempRoot();
  try {
    const resolved = resolveSearchCredentials({ ANYSEARCH_ENDPOINT: "http://127.0.0.1:9/mcp" }, { home });
    assert.equal(resolved.anysearch?.apiKey, undefined);
    assert.equal(resolved.anysearch?.endpoint, "http://127.0.0.1:9/mcp");
    assert.equal(resolved.anysearch?.source, "env");
  } finally { cleanup(); }
});

test("a model key is bound to its provider and endpoint; another endpoint is refused", () => {
  const { home, cleanup } = tempRoot();
  try {
    writeUserCredential({ provider: "openai", apiKey: KEY }, { home });
    const file = readUserCredentials({ home });

    assert.deepEqual(lookupModelCredential("openai", null, file), { status: "found", apiKey: KEY });
    assert.deepEqual(lookupModelCredential("openai", "", file), { status: "found", apiKey: KEY });
    // Trailing slashes do not make a different endpoint.
    assert.deepEqual(lookupModelCredential("openai", "https://gw.example/v1/", {
      bindings: [{ provider: "openai", endpoint: "https://gw.example/v1", apiKey: KEY }],
    }), { status: "found", apiKey: KEY });
    assert.equal(lookupModelCredential("openai", "https://other.example/v1", file).status, "endpoint-mismatch");
    // A different provider never sees this key.
    assert.equal(lookupModelCredential("anthropic", null, file).status, "absent");
    assert.equal(lookupModelCredential(undefined, null, file).status, "absent");
  } finally { cleanup(); }
});

test("a key stored for one endpoint is replaced by, not merged with, a re-entry", () => {
  const { home, cleanup } = tempRoot();
  try {
    writeUserCredential({ provider: "openai", endpoint: "https://a.example/v1", apiKey: "key-a" }, { home });
    writeUserCredential({ provider: "openai", endpoint: "https://b.example/v1", apiKey: "key-b" }, { home });
    let file = readUserCredentials({ home });
    assert.equal(file.bindings.length, 2);

    writeUserCredential({ provider: "openai", endpoint: "https://a.example/v1", apiKey: "key-a2" }, { home });
    file = readUserCredentials({ home });
    assert.equal(file.bindings.length, 2);
    assert.equal(file.bindings.find((b) => b.endpoint === "https://a.example/v1")?.apiKey, "key-a2");
  } finally { cleanup(); }
});

test("removing one key keeps the others; removing the last deletes the file", () => {
  const { home, cleanup } = tempRoot();
  try {
    writeUserCredential({ provider: "openai", apiKey: "k1" }, { home });
    writeUserCredential({ provider: "anthropic", apiKey: "k2" }, { home });
    assert.equal(removeUserCredential({ provider: "openai" }, { home }), true);
    assert.deepEqual(readUserCredentials({ home }).bindings.map((b) => b.provider), ["anthropic"]);
    assert.equal(removeUserCredential({ provider: "openai" }, { home }), false);

    assert.equal(removeUserCredential({ provider: "anthropic" }, { home }), true);
    assert.equal(existsSync(userCredentialsPath(home)), false);
    } finally { cleanup(); }
});

test("a malformed file is never rewritten (that would drop the other keys)", () => {
  const { home, cleanup } = tempRoot();
  try {
    const path = userCredentialsPath(home);
    mkdirSync(join(home, ".ans"), { recursive: true });
    writeFileSync(path, "{ not json", "utf8");

    assert.throws(
      () => writeUserCredential({ provider: "openai", apiKey: KEY }, { home }),
      /not valid JSON/,
    );
    assert.equal(readFileSync(path, "utf8"), "{ not json");
    // Resolution reports the fault instead of pretending there are no keys.
    const resolved = resolveSearchCredentials({}, { home });
    assert.ok(resolved.warnings.some((w) => w.includes("not valid JSON")));
  } finally { cleanup(); }
});

test("a supplied parse result wins: the broken file on disk is never consulted again", () => {
  // #357: doctor and `ans auth status` parse the file once and hand the result
  // to the resolver. While the on-disk file is broken, the resolver works off
  // what it was given and stays silent about the file it never read - so no
  // consumer has to match error text to avoid a second copy.
  const { home, cleanup } = tempRoot();
  try {
    const path = userCredentialsPath(home);
    mkdirSync(join(home, ".ans"), { recursive: true });
    writeFileSync(path, "{ not json", "utf8");

    const supplied = { bindings: [{ provider: "exa", endpoint: null, apiKey: "exa-from-supplied" }] };
    const resolved = resolveSearchCredentials({}, { home, credentialsFile: supplied });
    assert.equal(resolved.exa?.apiKey, "exa-from-supplied");
    assert.equal(resolved.exa?.source, "user");
    assert.deepEqual(resolved.warnings, [], "文件读坏了只报一条，由调用方报；解析器不再说第二遍");

    // The same call WITHOUT a supplied result does report the broken file, so
    // the silence above comes from the input and not from a vanished check.
    const ownRead = resolveSearchCredentials({}, { home });
    assert.equal(ownRead.exa, undefined);
    assert.ok(ownRead.warnings.some((w) => w.includes("not valid JSON")));
  } finally { cleanup(); }
});

test("a broken file is classified, and the classification survives a supplied parse", () => {
  // #533: a machine-readable surface may not carry the sentence (it can quote
  // the file), so the reader records what kind of fault it was. The
  // classification travels even when the warning does not: a caller that parses
  // the file itself reports the sentence in its own shape, and its engine still
  // has to say the file is unusable.
  const { home, cleanup } = tempRoot();
  try {
    const path = userCredentialsPath(home);
    mkdirSync(join(home, ".ans"), { recursive: true });

    writeFileSync(path, "{ not json", "utf8");
    const notJson = readUserCredentials({ home });
    assert.equal(notJson.fault?.kind, "not-json");
    assert.equal(notJson.fault?.errno, undefined, "a parse fault carries no errno");

    writeFileSync(path, JSON.stringify({ keys: [] }), "utf8");
    assert.equal(readUserCredentials({ home }).fault?.kind, "invalid-structure", "no bindings list");
    writeFileSync(path, JSON.stringify({ bindings: [{ provider: "exa" }] }), "utf8");
    assert.equal(readUserCredentials({ home }).fault?.kind, "invalid-structure", "an entry with no key");

    // Present but unreadable: a directory where the file should be makes
    // readFileSync throw on every platform, without depending on mode bits
    // (which root ignores and Windows does not track). The errno it reports is
    // platform-dependent, so assert the closed set rather than one value.
    rmSync(path, { force: true });
    mkdirSync(path);
    const unreadable = readUserCredentials({ home });
    assert.equal(unreadable.fault?.kind, "unreadable");
    if (unreadable.fault?.errno) {
      assert.ok(
        (CREDENTIAL_FILE_FAULT_ERRNOS as readonly string[]).includes(unreadable.fault.errno),
        "the errno comes from the closed set: " + unreadable.fault.errno,
      );
    }
    rmSync(path, { recursive: true, force: true });

    // The supplied-parse path (#357): no warning, but the fault still rides out.
    writeFileSync(path, "{ not json", "utf8");
    const supplied = readUserCredentials({ home });
    const resolved = resolveSearchCredentials({}, { home, credentialsFile: supplied });
    assert.deepEqual(resolved.warnings, [], "the caller reports the sentence once");
    assert.equal(resolved.credentialFileFault?.kind, "not-json", "the classification still travels");

    // A healthy file reports no fault at all, and neither does a missing one.
    writeFileSync(path, JSON.stringify({ bindings: [] }), "utf8");
    assert.equal(readUserCredentials({ home }).fault, undefined);
    assert.equal(resolveSearchCredentials({}, { home }).credentialFileFault, undefined);
    rmSync(path, { force: true });
    assert.equal(readUserCredentials({ home }).fault, undefined, "a missing file is not a fault");
  } finally { cleanup(); }
});

test("the parse error never quotes the file's contents", () => {
  // SECURITY (spec S2: 秘密不出现在...错误详情). JSON.parse's own message
  // quotes ~10 characters around the error, and in this file those characters
  // are usually part of a key. A user hand-editing the file would otherwise get
  // their key echoed back by `ans auth list`, doctor, or the resolver's warning.
  const { home, cleanup } = tempRoot();
  try {
    const path = userCredentialsPath(home);
    mkdirSync(join(home, ".ans"), { recursive: true });
    // A realistic hand-edit accident: a missing quote right after the key.
    writeFileSync(path, '{ "bindings": [ { "provider": "openai", "apiKey": "sk-live-SECRET-DO-NOT-PRINT" } ]', "utf8");

    const file = readUserCredentials({ home });
    assert.ok(file.error, "a broken file reports an error");
    assert.ok(!file.error!.includes("SECRET"), "the error must not quote the key: " + file.error);
    assert.ok(!file.error!.includes("sk-live"), "not even the key prefix: " + file.error);
    assert.match(file.error!, /not valid JSON/);

    // And the same holds for the resolver's warning, which is what the CLI and
    // MCP entries print.
    const warnings: string[] = [];
    resolveLlmConfig({ home, cwd: home, env: {}, warn: (m) => warnings.push(m) });
    assert.ok(!warnings.join("\n").includes("SECRET"), "the resolver warning must not quote the key");
  } finally { cleanup(); }
});

test("the model resolver reports a broken file even when an env key supplied the key", () => {
  // #538: the credential file used to be read only as the LAST key source, so
  // `ANS_LLM_API_KEY` hid a broken file completely — no stderr line, no
  // record. A host reading the tool return saw a healthy call and nothing else.
  const { home, cleanup } = tempRoot();
  try {
    const path = userCredentialsPath(home);
    mkdirSync(join(home, ".ans"), { recursive: true });
    writeFileSync(path, "{ not json", "utf8");

    const warnings: string[] = [];
    const cfg = resolveLlmConfig({
      home, cwd: home,
      env: { ANS_LLM_API_KEY: "sk-env-supplied", ANS_LLM_PROVIDER: "openai", ANS_LLM_MODEL: "gpt-5" },
      warn: (m) => warnings.push(m),
    });
    assert.equal(cfg.apiKey, "sk-env-supplied", "the env key still wins");
    assert.equal(cfg.credentialFileFault?.kind, "not-json", "the fault travels anyway");
    assert.equal(cfg.credentialFileFault?.errno, undefined);
    assert.deepEqual(warnings, [], "stderr stays quiet when the key worked; the record is the report");

    // Healthy and missing files still carry nothing.
    writeFileSync(path, JSON.stringify({ bindings: [] }), "utf8");
    assert.equal(resolveLlmConfig({ home, cwd: home, env: {} }).credentialFileFault, undefined);
    rmSync(path, { force: true });
    assert.equal(resolveLlmConfig({ home, cwd: home, env: {} }).credentialFileFault, undefined);
  } finally { cleanup(); }
});

test("a TOML parse failure never quotes the offending line", () => {
  // Design: #538 — smol-toml appends the numbered source line to its message,
  // and a config.toml line can be `api_key = "sk-…"`. Both the read warning and
  // the write refusal can print or forward that text, so only the diagnostic
  // head may survive.
  const { home, cleanup } = tempRoot();
  try {
    mkdirSync(join(home, ".ans"), { recursive: true });
    writeFileSync(join(home, ".ans", "config.toml"), "[llm\napi_key = \"sk-live-SECRET-DO-NOT-PRINT\"\n", "utf8");
    const warnings: string[] = [];
    resolveLlmConfig({ home, cwd: home, env: {}, warn: (m) => warnings.push(m) });
    assert.ok(warnings.some((w) => w.includes("TOML parse failed")), "the fault is still reported");
    assert.ok(!warnings.join("\n").includes("SECRET"), "the warning must not quote the line: " + warnings.join("\n"));
    assert.ok(!warnings.join("\n").includes("sk-live"), "not even the key prefix");

    // `ans llm set` refuses to rewrite a malformed file; its sentence is shown
    // to the user too, so it takes the same rule.
    assert.throws(
      () => writeUserLlmConfig({ provider: "openai" }, home),
      (error: unknown) => {
        assert.ok(error instanceof Error, "the refusal is an Error");
        assert.match(error.message, /TOML parse failed/);
        assert.ok(!error.message.includes("SECRET"), "the refusal must not quote the line: " + error.message);
        return !error.message.includes("sk-live");
      },
    );
  } finally { cleanup(); }
});

test("the file says in plain words that it is plaintext", () => {
  const { home, cleanup } = tempRoot();
  try {
    writeUserCredential({ provider: "openai", apiKey: KEY }, { home });
    const raw = readFileSync(userCredentialsPath(home), "utf8");
    assert.match(raw, /Plain text/);
    assert.match(raw, /NOT encrypted/);
    assert.match(raw, /NOT a system keychain/);
  } finally { cleanup(); }
});

test("a bad provider, an empty key and a search-provider endpoint are refused", () => {
  const { home, cleanup } = tempRoot();
  try {
    assert.throws(() => writeUserCredential({ provider: "nope", apiKey: "k" }, { home }), /unknown provider/);
    assert.throws(() => writeUserCredential({ provider: "openai", apiKey: "   " }, { home }), /empty/);
    assert.throws(
      () => writeUserCredential({ provider: "tavily", endpoint: "https://x", apiKey: "k" }, { home }),
      /search provider/,
    );
    assert.throws(
      () => writeUserCredential({ provider: "openai", apiKey: "sk-a\nb" }, { home }),
      /control characters/,
    );
  } finally { cleanup(); }
});

test("an unusable ACL tool fails the write instead of publishing a readable file", () => {
  const { home, cleanup } = tempRoot();
  const previousRun = credentialProtectionSeam.run;
  try {
    // icacls is missing or refuses (no ACL support, insufficient rights). This
    // branch cannot be produced on a normal host, so the tool invocation is
    // stubbed - the point under test is what the WRITE does when protection
    // cannot be established, which is real code either way.
    credentialProtectionSeam.run = (file, args) => {
      if (file.toLowerCase().includes("icacls") && args.includes("/inheritance:r")) {
        throw new Error("icacls: access denied");
      }
      return previousRun ? previousRun(file, args) : "";
    };
    if (process.platform === "win32") {
      assert.throws(
        () => writeUserCredential({ provider: "openai", apiKey: KEY }, { home }),
        /refusing to write the credential file.*access denied/,
      );
      assert.equal(existsSync(userCredentialsPath(home)), false, "no readable copy was left behind");
    }
  } finally {
    credentialProtectionSeam.run = previousRun;
    cleanup();
  }
});

test("a file widened after publish is removed, not trusted", () => {
  const { home, cleanup } = tempRoot();
  const previousVerify = credentialProtectionSeam.verify;
  try {
    // Another process widens the file between the pre-write check and the final
    // one - a real race with no deterministic trigger. The verifier is stubbed
    // to fail only on its second call, so the write's fail-closed branch (the
    // one that deletes the published file) is the code under test.
    let calls = 0;
    credentialProtectionSeam.verify = () => {
      calls++;
      if (calls > 1) throw new Error("it is group-readable");
    };
    assert.throws(
      () => writeUserCredential({ provider: "openai", apiKey: KEY }, { home }),
      /refusing to write the credential file/,
    );
    assert.ok(calls >= 2, "the write checked twice: before the secret and after publishing");
    assert.equal(existsSync(userCredentialsPath(home)), false,
      "the published file was removed rather than left readable");
  } finally {
    credentialProtectionSeam.verify = previousVerify;
    cleanup();
  }
});

test("nothing is left behind when the config root cannot be created", () => {
  const { home, cleanup } = tempRoot();
  try {
    // A real, unavoidable failure: the config root is occupied by a regular
    // FILE, so mkdir cannot create the directory the credential file needs.
    const blocked = join(home, ".ans");
    writeFileSync(blocked, "this is a file, not a directory", "utf8");

    assert.throws(
      () => writeUserCredential({ provider: "openai", apiKey: KEY }, { home }),
      /refusing to write the credential file/,
    );
    // The blocker is untouched and no key was written anywhere.
    assert.equal(readFileSync(blocked, "utf8"), "this is a file, not a directory");
    assert.ok(!readFileSync(blocked, "utf8").includes(KEY), "the failure did not write the key into the blocker");
  } finally { cleanup(); }
});

test("the temp file is protected before the key goes into it", () => {
  const { home, cleanup } = tempRoot();
  try {
    const path = writeUserCredential({ provider: "openai", apiKey: KEY }, { home });
    verifyFileProtection(path);
    assert.ok(!readdirSync(join(home, ".ans")).some((f) => f.endsWith(".tmp")),
      "no temp file survived a successful write");
    if (process.platform !== "win32") {
      // A 0600 file from the first byte means no other account could read the
      // key at any point, including between create and publish.
      assert.equal(statSync(path).mode & 0o777, 0o600);
    }
  } finally { cleanup(); }
});

test("POSIX: the file is 0600 and the verifier rejects anything looser", () => {
  if (process.platform === "win32") return; // the Windows DACL path is the case below
  const { home, cleanup } = tempRoot();
  try {
    const path = writeUserCredential({ provider: "openai", apiKey: KEY }, { home });
    assert.equal(statSync(path).mode & 0o777, 0o600);
    verifyFileProtection(path, "linux");

    chmodSync(path, 0o644);
    assert.throws(() => verifyFileProtection(path, "linux"), /POSIX mode is 644/);
  } finally { cleanup(); }
});

test("Windows: the DACL is checked as an ACL, not as a POSIX mode", () => {
  if (process.platform !== "win32") return;
  const { home, cleanup } = tempRoot();
  try {
    const path = writeUserCredential({ provider: "openai", apiKey: KEY }, { home });
    // The real check: parsed DACL, protected, no inherited or foreign entry.
    verifyFileProtection(path);

    // /grant R widens the file to the Authenticated Users group. Verification
    // must catch that, and the POSIX mode is irrelevant on Windows - which is
    // exactly the distinction the ticket requires.
    const icacls = join(process.env.SystemRoot || "C:\\Windows", "System32", "icacls.exe");
    execFileSync(icacls, [path, "/grant", "*S-1-5-11:(R)"], { windowsHide: true });
    assert.throws(() => verifyFileProtection(path), /Windows DACL still allows/);
  } finally { cleanup(); }
});

test("Windows: a DACL that still inherits is rejected even when every entry looks fine", () => {
  if (process.platform !== "win32") return;
  const { home, cleanup } = tempRoot();
  try {
    const path = writeUserCredential({ provider: "openai", apiKey: KEY }, { home });
    const icacls = join(process.env.SystemRoot || "C:\\Windows", "System32", "icacls.exe");
    // /inheritance:e re-enables inheritance from the temp folder: the file is
    // no longer protected, and the parent's entries must decide access again.
    execFileSync(icacls, [path, "/inheritance:e"], { windowsHide: true });
    assert.throws(() => verifyFileProtection(path), /inherits permissions|inherited entry/);
  } finally { cleanup(); }
});

test("an endpoint carrying credentials is shown without them", () => {
  // `ans auth list` prints the binding. A base URL can carry userinfo or a
  // secret in the query, and spec S2 forbids a secret in terminal output, so the
  // display form is stripped while the stored value stays exact.
  assert.equal(displayEndpoint(null), "(provider default endpoint)");
  assert.equal(displayEndpoint("https://gw.example/v1"), "https://gw.example/v1");
  assert.equal(displayEndpoint("https://user:s3cret@Gw.Example/v1/"), "https://gw.example/v1");
  assert.equal(displayEndpoint("https://gw.example/v1?key=sk-secret"), "https://gw.example/v1");
  assert.ok(!displayEndpoint("https://gw.example/v1?api_key=sk-live").includes("sk-live"));
  // Not a parseable URL: keep the host part only.
  assert.ok(!displayEndpoint("gw.example/v1?token=sk-x").includes("sk-x"));
  assert.ok(!displayEndpoint("user:pass@gw.example/v1").includes("pass"));
});

// ---------------------------------------------------------------------------
// Review findings on PR #333 — each one is a regression test, written so
// re-breaking the fix fails here rather than in production.
// ---------------------------------------------------------------------------

test("a record missing apiKey is reported, never silently dropped on the next write", () => {
  const { home, cleanup } = tempRoot();
  try {
    const path = userCredentialsPath(home);
    mkdirSync(join(home, ".ans"), { recursive: true });
    // Valid JSON, one good record and one broken: a rewrite that kept only the
    // good one would permanently erase the other (review P1).
    writeFileSync(path, JSON.stringify({
      bindings: [
        { provider: "openai", apiKey: "good-key" },
        { provider: "anthropic" },
      ],
    }), "utf8");

    const file = readUserCredentials({ home });
    assert.ok(file.error, "the broken record is reported");
    assert.match(file.error!, /entry 2 \(anthropic\) has no apiKey/);
    assert.deepEqual(file.bindings, [], "no partial view is handed out");

    assert.throws(
      () => writeUserCredential({ provider: "google", apiKey: "g-key" }, { home }),
      /has no apiKey.*fix or remove the file/,
    );
    // The file is untouched: the broken record (and anything beside it) survives.
    assert.match(readFileSync(path, "utf8"), /anthropic/);
  } finally { cleanup(); }
});

test("a non-string endpoint is reported instead of being reshaped to the default", () => {
  const { home, cleanup } = tempRoot();
  try {
    const path = userCredentialsPath(home);
    mkdirSync(join(home, ".ans"), { recursive: true });
    // An endpoint of the wrong type must not silently become "the provider
    // default" - that would change which host the key is sent to.
    writeFileSync(path, JSON.stringify({ bindings: [{ provider: "openai", apiKey: "k", endpoint: 42 }] }), "utf8");
    const file = readUserCredentials({ home });
    assert.ok(file.error);
    assert.match(file.error!, /non-string endpoint/);
  } finally { cleanup(); }
});

test("two concurrent writers both keep their key (the lock covers read-modify-write)", async () => {
  const { home, cleanup } = tempRoot();
  try {
    // Distinct providers, started at the same time. Without the cross-process
    // lock each reads the empty file, adds its own entry and replaces the whole
    // file - the loser's key vanishes while both report success (review P1).
    const path = userCredentialsPath(home);
    mkdirSync(join(home, ".ans"), { recursive: true });
    const script = join(home, "writer.mjs");
    writeFileSync(script, [
      'import { writeUserCredential } from ' + JSON.stringify(
        new URL("../src/credentials.ts", import.meta.url).href,
      ) + ";",
      "const [home, provider, key] = process.argv.slice(2);",
      "writeUserCredential({ provider, apiKey: key }, { home });",
    ].join("\n"), "utf8");

    const { spawn } = await import("node:child_process");
    const runs = [
      ["tavily", "tvly-child-1"],
      ["exa", "exa-child-2"],
    ].map(([provider, key]) => new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", script, home, provider, key], {
        env: { ...process.env, NODE_OPTIONS: "" },
        stdio: "ignore",
      });
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    }));
    const codes = await Promise.all(runs);
    assert.deepEqual(codes, [0, 0], "both writers succeeded");

    const file = readUserCredentials({ home });
    assert.equal(file.error, undefined);
    const providers = file.bindings.map((b) => b.provider).sort();
    assert.deepEqual(providers, ["exa", "tavily"], "neither writer's key was lost");
  } finally { cleanup(); }
});

test("a stuck lock reports who is holding it instead of writing anyway", () => {
  const { home, cleanup } = tempRoot();
  try {
    const path = userCredentialsPath(home);
    mkdirSync(join(home, ".ans"), { recursive: true });
    // A fresh lock (well inside the stale window) belongs to a live process.
    writeFileSync(path + ".lock", "12345", "utf8");
    assert.throws(
      () => writeUserCredential({ provider: "openai", apiKey: "k" }, { home }),
      /refusing to write the credential file.*another ans process is writing it/,
    );
    assert.equal(existsSync(path), false, "nothing was written while the lock was held");
  } finally { cleanup(); }
});

test("an abandoned lock is reclaimed so a killed process cannot wedge the file", () => {
  const { home, cleanup } = tempRoot();
  try {
    const path = userCredentialsPath(home);
    mkdirSync(join(home, ".ans"), { recursive: true });
    writeFileSync(path + ".lock", "99999", "utf8");
    // Age it past the stale window: a lock older than that means its owner died.
    const old = new Date(Date.now() - 60_000);
    utimesSync(path + ".lock", old, old);
    const written = writeUserCredential({ provider: "openai", apiKey: "k" }, { home });
    assert.equal(written, path);
    assert.deepEqual(readUserCredentials({ home }).bindings.map((b) => b.provider), ["openai"]);
    assert.equal(existsSync(path + ".lock"), false, "the lock was released");
  } finally { cleanup(); }
});

test("a read-only config directory fails with the actionable sentence, not a bare EACCES", () => {
  // This is the case the installed-product lane hit in CI: the directory exists
  // but refuses new files, so the lock file itself cannot be created. The user
  // must see "refusing to write the credential file", not an errno.
  if (process.platform === "win32") return; // directory modes do not restrict writes this way on Windows
  const { home, cleanup } = tempRoot();
  const dir = join(home, ".ans");
  try {
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o500);
    assert.throws(
      () => writeUserCredential({ provider: "openai", apiKey: KEY }, { home }),
      /refusing to write the credential file.*(EACCES|cannot take the write lock)/,
    );
    assert.equal(existsSync(join(dir, "credentials.json")), false);
    // Nothing was left behind, not even a lock file.
    assert.equal(existsSync(join(dir, "credentials.json.lock")), false);
  } finally {
    try { chmodSync(dir, 0o700); } catch { /* already restored */ }
    cleanup();
  }
});
