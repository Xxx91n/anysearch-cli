// #610: the page-read arms are built in a fixed order (Exa, Tavily,
// AnySearch) and then filtered by the domain's enabled list — the order is not
// the TOML order, and a disabled arm is not built at all.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSearchCredentials } from "@anysearch-cli/store";
import { createEngine } from "../src/composition";

function closeResult(r: { store: unknown; observation: { close?: () => void } }) {
  (r.store as { close?: () => void }).close?.();
  r.observation.close?.();
}

const envCredentials = (e?: NodeJS.ProcessEnv) =>
  resolveSearchCredentials(e, { credentialsFile: { bindings: [] } });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-fetch-order-"));
const savedExaKey = process.env.EXA_API_KEY;

function writesDomain(name: string, enabled: string[]): void {
  fs.writeFileSync(path.join(dir, name + ".toml"), [
    'name = "' + name + '"',
    "[sources]",
    "enabled = [" + enabled.map((id) => JSON.stringify(id)).join(", ") + "]",
    "[rag]",
    'adapter = "none"',
    "",
  ].join("\n"), "utf8");
}

try {
  // ---- no domain: all three arms, fixed order -----------------------------
  {
    const engine = createEngine(undefined, { domainsDirs: [dir], dbPath: ":memory:", searchCredentials: envCredentials });
    try {
      assert.deepEqual(engine.fetchProviders?.map((provider) => provider.id), ["exa", "tavily", "anysearch"],
        "the default engine builds page reads Exa -> Tavily -> AnySearch");
    } finally { closeResult(engine); }
  }

  // ---- domain order is overridden by the fixed order ----------------------
  {
    writesDomain("reversed", ["anysearch", "tavily"]);
    const engine = createEngine("reversed", { domainsDirs: [dir], dbPath: ":memory:", searchCredentials: envCredentials });
    try {
      assert.deepEqual(engine.fetchProviders?.map((provider) => provider.id), ["tavily", "anysearch"],
        "the enabled set decides membership, not the TOML order");
    } finally { closeResult(engine); }
  }

  // ---- one enabled arm: the other two are not built -----------------------
  {
    writesDomain("solo", ["anysearch"]);
    const engine = createEngine("solo", { domainsDirs: [dir], dbPath: ":memory:", searchCredentials: envCredentials });
    try {
      assert.deepEqual(engine.fetchProviders?.map((provider) => provider.id), ["anysearch"],
        "a one-arm domain builds one page-read arm");
    } finally { closeResult(engine); }
  }

  // ---- a fetch construction failure is fail-open and named ----------------
  {
    const origStderrWrite = process.stderr.write;
    let captured = "";
    try {
      process.stderr.write = ((chunk: unknown) => { captured += String(chunk); return true; }) as typeof process.stderr.write;
      // The same unusable-key sample the search-side build-error test uses. It
      // makes createExaFetchProvider throw, so only the fetch arm is missing.
      process.env.EXA_API_KEY = "sk-secret-do-not-log\nheader-fault";
      const engine = createEngine(undefined, { domainsDirs: [dir], dbPath: ":memory:", searchCredentials: envCredentials });
      try {
        assert.deepEqual(engine.fetchProviders?.map((provider) => provider.id), ["tavily", "anysearch"],
          "a throwing fetch construction drops that arm only");
        assert.match(captured, /\[anysearch\] fetch provider exa construction failed: /,
          "the dropped fetch arm is named on stderr, never silently");
        assert.ok(!captured.includes("sk-secret"), "the key value never reaches stderr");
      } finally { closeResult(engine); }
    } finally {
      process.stderr.write = origStderrWrite;
      if (savedExaKey === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = savedExaKey;
    }
  }
  // ---- an unknown id in the domain is named, not swallowed silently ------
  {
    writesDomain("typo", ["tavily", "tavly"]);
    const origStderrWrite = process.stderr.write;
    let captured = "";
    try {
      process.stderr.write = ((chunk: unknown) => { captured += String(chunk); return true; }) as typeof process.stderr.write;
      const engine = createEngine("typo", { domainsDirs: [dir], dbPath: ":memory:", searchCredentials: envCredentials });
      try {
        assert.deepEqual(engine.fetchProviders?.map((provider) => provider.id), ["tavily"],
          "a misspelt id is not built and does not take the real arm with it");
        assert.match(captured, /读页没有信息源 id "tavly"/, "the misspelt id is named on stderr");
      } finally { closeResult(engine); }
    } finally { process.stderr.write = origStderrWrite; }
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
