// Audit-fix scan (F-1/F-2): run the pathlint detector over CHANGELOG.md and the
// green fixture — both must produce zero violations (infos are OK).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEnv, scanLines } from "../../../scripts/ship-gate-pathlint-detect.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "ship-gate-pathlint.config.json"), "utf8"));
const env = buildEnv(cfg, ROOT);
for (const rel of ["CHANGELOG.md", "packages/store/fixtures/pathlint/green.md"]) {
  const { violations, infos } = scanLines(fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n"), env);
  console.log(rel, "violations:", violations.length, "infos:", infos.length);
  for (const v of violations) console.log(" ", v.line, v.kind, v.detail.slice(0, 110));
}
