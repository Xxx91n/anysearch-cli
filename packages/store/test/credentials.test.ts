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
  clearUserCredentials,
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
    assert.equal(clearUserCredentials({ home }), false);
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

test("nothing is left behind when protection cannot be established", () => {
  const { home, cleanup } = tempRoot();
  const previousPlatform = credentialProtectionSeam.platform;
  const previousProtect = credentialProtectionSeam.protect;
  try {
    // The platform refuses to protect the file (the real shape: icacls exits
    // non-zero, or the filesystem has no permissions to speak of). The write
    // must fail and no secret may remain on disk.
    credentialProtectionSeam.platform = "linux";
    credentialProtectionSeam.protect = () => {
      throw new Error("this file system cannot restrict access to one account");
    };

    assert.throws(
      () => writeUserCredential({ provider: "openai", apiKey: KEY }, { home }),
      /refusing to write the credential file.*cannot restrict access/,
    );
    assert.equal(existsSync(userCredentialsPath(home)), false);
    // And the failure leaves no stray temp file with the key in it.
    const dir = join(home, ".anysearch-cli");
    if (existsSync(dir)) {
      const leftovers = readdirSync(dir).filter((f) => !f.startsWith("credentials"));
      assert.deepEqual(leftovers, [], "no temp file survived the failed write");
    }
  } finally {
    credentialProtectionSeam.platform = previousPlatform;
    credentialProtectionSeam.protect = previousProtect;
    cleanup();
  }
});

test("a file whose protection drifted after the write is reported, not trusted", () => {
  const { home, cleanup } = tempRoot();
  const previousPlatform = credentialProtectionSeam.platform;
  const previousVerify = credentialProtectionSeam.verify;
  try {
    credentialProtectionSeam.platform = "linux";
    let calls = 0;
    // First verification (before the secret is written) passes; the second
    // (after publishing) finds the file exposed — the write must fail closed.
    credentialProtectionSeam.verify = () => {
      calls++;
      if (calls > 1) throw new Error("its POSIX mode is 644, expected 600");
    };
    assert.throws(
      () => writeUserCredential({ provider: "openai", apiKey: KEY }, { home }),
      /refusing to write the credential file/,
    );
    assert.equal(existsSync(userCredentialsPath(home)), false,
      "a published file that failed the final check is removed");
  } finally {
    credentialProtectionSeam.platform = previousPlatform;
    credentialProtectionSeam.verify = previousVerify;
    cleanup();
  }
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
