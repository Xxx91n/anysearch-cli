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

test("the incremental command runs the same turbo task and flags as the root test script", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const script = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts.test;
  const scriptArgs = script.split(/\s+/);
  const gateArgs = commandArgs({ mode: "incremental", packages: ["@anysearch-cli/cli"] }).filter(
    (part) => !part.startsWith("--filter="),
  );
  // "turbo run test" and every flag; only the filters are the gate's own.
  assert.deepEqual(gateArgs.slice(1), scriptArgs, "the gate must run the same turbo task and flags as `pnpm test`");
});
