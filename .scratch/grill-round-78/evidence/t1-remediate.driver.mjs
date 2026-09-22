// R78 T1 存量处置 driver — applies the registered remediation for every
// violation the warn-sweep enumerated: missing-marker → append governed marker
// (reason per first-hit class); stale-marker → strip the marker (line removed
// if it carried nothing else); malformed-marker → hand-edit list below.
// Writes t1-remediate.md (action log, itself marker-compliant) + prints summary.
// Usage: node .scratch/grill-round-78/evidence/t1-remediate.driver.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enumerateScopedMarkdown, buildEnv, scanLines, detectHits } from "../../../scripts/ship-gate-pathlint-detect.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "ship-gate-pathlint.config.json"), "utf8"));
const env = buildEnv(cfg, ROOT);
const inScope = enumerateScopedMarkdown(cfg, ROOT);
const DATE = "2026-09-22";
const REASON = {
  "win-envvar": "Windows env-var 路径引用（存量合规化）",
  "posix-envvar": "POSIX env-var 路径引用（存量合规化）",
  "tilde": "用户级 ~ 路径引用（存量合规化）",
  "unc": "UNC 路径引用（存量合规化）",
  "drive": "机器绝对路径引用（存量合规化）",
  "posix-home": "POSIX 绝对路径引用（存量合规化）",
  "appdata": "AppData 路径引用（存量合规化）",
};
const MARKER_STRIP = /\s*<!--\s*machine-local\s*:[^@<>]*?@\s*\d{4}-\d{2}-\d{2}\s*-->/g;
// malformed-marker line that needs a manual reword (quoting the marker template
// can never satisfy MARKER_OK — its placeholders contain <>). Keyed by
// rel:line at sweep time.
const MANUAL = {
  ".scratch/grill-round-78/q3-atomcode.md": (l) =>
    l.replace(/`<!--\s*machine-local:\s*\.\.\.\s*@\s*date\s*-->`/, "`machine-local` marker 注释（模板见 config）"),
};

const actions = [];
let touched = 0;
for (const rel of inScope) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const { violations } = scanLines(lines, env);
  if (!violations.length) continue;
  let changed = false;
  // apply bottom-up so line numbers stay valid
  for (const v of [...violations].sort((a, b) => b.line - a.line)) {
    const i = v.line - 1;
    if (v.kind === "missing-marker" || v.kind === "malformed-marker") {
      let l = lines[i];
      if (v.kind === "malformed-marker" && MANUAL[rel]) l = MANUAL[rel](l);
      const hits = detectHits(l);
      const cls = hits.length ? hits[0].cls : "drive";
      lines[i] = l + " <!-- machine-local: " + (REASON[cls] || REASON.drive) + " @ " + DATE + " -->";
      actions.push(rel + ":" + v.line + " append-marker(" + cls + ")");
      changed = true;
    } else if (v.kind === "stale-marker") {
      const stripped = lines[i].replace(MARKER_STRIP, "");
      if (stripped.trim() === "") { lines.splice(i, 1); actions.push(rel + ":" + v.line + " remove-stale-marker-line"); }
      else { lines[i] = stripped.replace(/\s+$/, ""); actions.push(rel + ":" + v.line + " strip-stale-marker-inline"); }
      changed = true;
    }
  }
  if (changed) { fs.writeFileSync(file, lines.join("\n")); touched++; }
}

// re-sweep to prove convergence
const residual = [];
for (const rel of inScope) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const { violations } = scanLines(fs.readFileSync(file, "utf8").split("\n"), env);
  for (const v of violations) residual.push(rel + ":" + v.line + " [" + v.kind + "] " + v.detail);
}

const out = [];
out.push("# T1 存量处置实录（driver=t1-remediate.driver.mjs，可复跑=幂等空跑）");
out.push("");
out.push("Date: 2026-09-22. 输入=warn-sweep 96 违例。规则：missing/malformed-marker→行尾追加治理 marker（reason 按首命中类）；stale-marker→剥除（孤行删除）。");
out.push("");
out.push("- 处置动作数：" + actions.length + "；触及文件数：" + touched);
out.push("- 复扫残存违例：**" + residual.length + "**");
out.push("");
if (actions.length) {
  // 动作日志行（rel:line action(cls)）不含 hard-hit token——此 fence 不加盖
  // marker，否则棘轮腿把它判 stale（本 driver 曾自食其果一回，实录保留）。
  out.push("```text");
  for (const a of actions) out.push(a);
  out.push("```");
}
if (residual.length) {
  out.push("");
  out.push("## 残存违例（须人工处置）");
  out.push("<!-- machine-local: 残存清单引用行摘录 @ 2026-09-22 -->");
  out.push("```text");
  for (const r of residual) out.push(r);
  out.push("```");
}
out.push("");
fs.writeFileSync(path.join(HERE, "t1-remediate.md"), out.join("\n") + "\n");
console.log("actions=" + actions.length + " filesTouched=" + touched + " residual=" + residual.length);
if (residual.length) console.log(residual.slice(0, 20).join("\n"));
