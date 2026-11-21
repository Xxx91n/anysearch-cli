import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { commandArgs } from "../preflight-command.mjs";

test("the full suite uses the repo's pnpm test", () => {
  assert.deepEqual(commandArgs({ mode: "full" }), ["test"]);
});

test("an incremental run lists one filter per package, in order", () => {
  assert.deepEqual(commandArgs({ mode: "incremental", packages: ["@anysearch-cli/cli", "@anysearch-cli/kernel"] }), [
    "exec",
    "turbo",
    "run",
    "test",
    "--concurrency=2",
    "--filter=@anysearch-cli/cli",
    "--filter=@anysearch-cli/kernel",
  ]);
});

test("the incremental command carries the root test script's turbo flags", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const script = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts.test;
  const scriptFlags = script.split(/\s+/).filter((part) => part.startsWith("--"));
  const gateFlags = commandArgs({ mode: "incremental", packages: ["@anysearch-cli/cli"] }).filter(
    (part) => part.startsWith("--") && !part.startsWith("--filter="),
  );
  assert.deepEqual(gateFlags, scriptFlags, "the gate must run turbo with the same flags as `pnpm test`");
});
