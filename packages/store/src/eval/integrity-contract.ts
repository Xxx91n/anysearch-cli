// ADR-0044 D3 + r116: TS-friendly wrapper for the mjs integrity contract consumed by ship-gate.
// Resolves the mjs from the project root so the path does not depend on import.meta.url
// (which is brittle under tsx + CJS interop on Windows).
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..", "..");
const require = createRequire(root + "/");
const mjs = require(resolve(root, "scripts/eval-integrity-contract.mjs")) as {
  evalIntegrityCheck: (report: unknown) => { ok: boolean; detail: string };
};
export function evalIntegrityCheck(report: unknown): { ok: boolean; detail: string } {
  return mjs.evalIntegrityCheck(report);
}
