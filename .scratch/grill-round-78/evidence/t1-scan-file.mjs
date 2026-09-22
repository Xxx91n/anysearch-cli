// One-off scanner: node t1-scan-file.mjs <repo-relative-md> — prints violations+infos
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEnv, scanLines } from "../../../scripts/ship-gate-pathlint-detect.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "ship-gate-pathlint.config.json"), "utf8"));
const env = buildEnv(cfg, ROOT);
const rel = process.argv[2];
const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n");
const r = scanLines(lines, env);
for (const v of r.violations) console.log("V", v.line, v.kind, "|", lines[v.line - 1].slice(0, 110));
for (const i of r.infos) console.log("I", i.line, i.detail.slice(0, 90));
console.log("violations=" + r.violations.length + " infos=" + r.infos.length);
