// ADR-0028 D3: containsSecret unit coverage — literal, i-flag, PEM-case, base64,
// JSON-escape, whitespace-split, NFKC fullwidth; plus negatives (truncation = known blind spot).
import assert from "node:assert/strict";
import { containsSecret, SECRET_PATTERNS } from "../src/secret";

const SK = "sk-testDEADBEEFcafebabe1234abcd1234";

assert.equal(containsSecret("plain " + SK), true, "literal sk-");
assert.equal(containsSecret("UP " + SK.toUpperCase()), true, "case-insensitive via i flag");
assert.equal(containsSecret("key AKIAIOSFODNN7EXAMPLE here"), true, "AKIA");
assert.equal(containsSecret("lower akiaiosfodnn7example"), true, "AKIA case-mixed");
assert.equal(containsSecret("-----BEGIN RSA PRIVATE KEY-----"), true, "PEM upper");
assert.equal(containsSecret("-----begin ec private key-----"), true, "PEM lower (i flag)");
assert.equal(containsSecret("b64 " + Buffer.from(SK, "utf8").toString("base64")), true, "base64-wrapped sk-");
assert.equal(containsSecret("b64 " + Buffer.from("AKIAIOSFODNN7EXAMPLE", "utf8").toString("base64")), true, "base64-wrapped AKIA");
assert.equal(containsSecret(String.raw`{"k": \""${SK}"\"}`), true, "JSON-escaped quotes restored");
assert.equal(containsSecret("split " + SK.slice(0, 12) + "  \n\t" + SK.slice(12)), true, "whitespace-split squashed");
assert.equal(containsSecret("\uFF21\uFF2B\uFF29\uFF21\uFF29\uFF2F\uFF33\uFF26\uFF2F\uFF24\uFF2E\uFF2E\uFF17\uFF25\uFF38\uFF21\uFF2D\uFF30\uFF2C\uFF25"), true, "fullwidth AKIA via NFKC");

// known blind spots (documented, honesty class "Some"):
assert.equal(containsSecret("sk-short"), false, "truncated sk below minimum length — known blind spot");
assert.equal(containsSecret("hello world nothing to see here"), false, "benign text clean");
assert.equal(containsSecret({ nested: { v: SK } }), true, "object input stringified");
assert.ok(typeof SECRET_PATTERNS === "string" && SECRET_PATTERNS.includes("AKIA"), "test seam exports pattern source");

console.log("secret-guard.test.ts: all assertions passed");

// r66 audit F-02: bounded decode — base64 candidates > 2048 chars are skipped (no decode).
const longB64 = Buffer.from(SK.repeat(80), "utf8").toString("base64");
assert.ok(longB64.length > 2048, "fixture exceeds cap");
assert.equal(containsSecret(longB64), false, "over-cap base64 skipped, no decode");
assert.equal(containsSecret(Buffer.from(SK, "utf8").toString("base64")), true, "under-cap base64 still decoded+caught");
