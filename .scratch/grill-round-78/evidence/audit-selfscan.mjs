// Audit self-scan: run the pathlint detector over the audit doc itself.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEnv, scanLines } from "../../../scripts/ship-gate-pathlint-detect.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "ship-gate-pathlint.config.json"), "utf8"));
const env = buildEnv(cfg, ROOT);
const target = path.join(ROOT, ".scratch/grill-round-78/handoffs/round-78-audit.md");
const { violations, infos } = scanLines(fs.readFileSync(target, "utf8").split("\n"), env);
console.log("violations:", violations.length);
for (const v of violations) console.log(" ", v.line, v.kind, v.detail.slice(0, 110));
console.log("infos:", infos.length);
for (const i of infos.slice(0, 12)) console.log(" info", i.line, i.detail.slice(0, 80));
