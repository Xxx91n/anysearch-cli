// R84 rework (audit F1 / ADR-0085 D6 addendum): composition-root fail-fast for
// malformed domain TOML — a `Domain schema:` error (e.g. an unknown key under
// sources.vertical) must propagate, not be swallowed into silent full-fanout.
// Missing domains stay fail-open (absent ≠ broken).
// ponytail: no test framework, assert-based demo.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEngine } from "../src/composition";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-composition-vertical-"));
try {
  // Malformed: unknown key under sources.vertical — the TOML leg of A-02.
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

  let threw = "";
  try { createEngine("badvert", { domainsDirs: [dir], dbPath: ":memory:" }); }
  catch (e) { threw = String(e); }
  assert.ok(threw.includes("Domain schema:") && threw.includes("sources.vertical"),
    "malformed sources.vertical propagates (got: " + threw.slice(0, 200) + ")");

  // Malformed urlAllowlist entry — same silent-drop class, now fail-fast too.
  fs.writeFileSync(path.join(dir, "badlist.toml"), [
    'name = "badlist"',
    '[sources]',
    'enabled = ["anysearch"]',
    'urlAllowlist = ["https://has-scheme.example.com"]',
    '[rag]',
    'adapter = "none"',
    "",
  ].join("\n"), "utf8");
  threw = "";
  try { createEngine("badlist", { domainsDirs: [dir], dbPath: ":memory:" }); }
  catch (e) { threw = String(e); }
  assert.ok(threw.includes("Domain schema:") && threw.includes("urlAllowlist"),
    "malformed urlAllowlist propagates (got: " + threw.slice(0, 200) + ")");

  // Missing domain stays fail-open full-fanout — absent ≠ broken.
  const r = createEngine("no-such-domain-here", { domainsDirs: [dir], dbPath: ":memory:" });
  assert.ok(r.retriever, "missing domain still resolves to full-fanout engine");
  (r.store as { close?: () => void }).close?.();
  r.observation.close();

  // Well-formed vertical TOML resolves cleanly.
  fs.writeFileSync(path.join(dir, "goodvert.toml"), [
    'name = "goodvert"',
    '[sources]',
    'enabled = ["anysearch"]',
    '[sources.vertical]',
    'domain = "finance"',
    'sub_domain = "quote"',
    '[rag]',
    'adapter = "none"',
    "",
  ].join("\n"), "utf8");
  const g = createEngine("goodvert", { domainsDirs: [dir], dbPath: ":memory:" });
  assert.ok(g.retriever, "well-formed vertical domain resolves to an engine");
  (g.store as { close?: () => void }).close?.();
  g.observation.close();
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log("composition-vertical.test: ok");
