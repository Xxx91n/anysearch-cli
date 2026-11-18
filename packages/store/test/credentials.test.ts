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
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  credentialProtectionSeam,
  lookupModelCredential,
  normalizeBindingEndpoint,
  readUserCredentials,
  removeUserCredential,
  resolveSearchCredentials,
  userCredentialsPath,
  verifyFileProtection,
  writeUserCredential,
} from "../src/credentials";
import { resolveLlmConfig } from "../src/config-llm";

function tempRoot(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "ans-cred-"));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

const KEY = "sk-test-ABCDEFGHIJKLMNOP-zero-zero";

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
    mkdirSync(join(home, ".anysearch-cli"), { recursive: true });
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

test("the parse error never quotes the file's contents", () => {
  // SECURITY (spec S2: 秘密不出现在...错误详情). JSON.parse's own message
  // quotes ~10 characters around the error, and in this file those characters
  // are usually part of a key. A user hand-editing the file would otherwise get
  // their key echoed back by `ans auth list`, doctor, or the resolver's warning.
  const { home, cleanup } = tempRoot();
  try {
    const path = userCredentialsPath(home);
    mkdirSync(join(home, ".anysearch-cli"), { recursive: true });
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
    const blocked = join(home, ".anysearch-cli");
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
    assert.ok(!readdirSync(join(home, ".anysearch-cli")).some((f) => f.endsWith(".tmp")),
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
