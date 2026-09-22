// R78 T1 warn-first sweep driver — runs the NEW pathlint detector
// (scripts/ship-gate-pathlint-detect.mjs) over the full registered doc sweep in
// collect mode (no fail), and writes t1-warn-sweep.md next to itself.
// Usage: node .scratch/grill-round-78/evidence/t1-warn-sweep.driver.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enumerateScopedMarkdown, buildEnv, scanLines, detectHits } from "../../../scripts/ship-gate-pathlint-detect.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "ship-gate-pathlint.config.json"), "utf8"));
const env = buildEnv(cfg, ROOT);
const inScope = enumerateScopedMarkdown(cfg, ROOT);

const rows = [];
const infoRows = [];
const byKind = {};
const byCls = {};
let scanned = 0;
for (const rel of inScope) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  scanned++;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const { violations, infos } = scanLines(lines, env);
  for (const v of violations) {
    byKind[v.kind] = (byKind[v.kind] || 0) + 1;
    rows.push({ rel, line: v.line, kind: v.kind, excerpt: l0(v.detail) });
  }
  for (const l of lines) for (const h of detectHits(l)) byCls[h.cls] = (byCls[h.cls] || 0) + 1;
  for (const inf of infos) infoRows.push({ rel, line: inf.line, detail: inf.detail });
}
function l0(s) { return s.length > 140 ? s.slice(0, 140) + "…" : s; }

const out = [];
out.push("# T1 warn-first sweep — 新判定器全量枚举（info 模式，未翻转 fail-closed）");
out.push("");
out.push("Date: 2026-09-22. Driver: `t1-warn-sweep.driver.mjs`（同目录，可复跑）。判定器=`scripts/ship-gate-pathlint-detect.mjs`，扫描面=config roots（`*.md`/`docs/**/*.md`/`.scratch/**/*.md`，含 untracked-non-ignored）。");
out.push("");
out.push("## 命中统计");
out.push("");
out.push("- 扫描文件数：" + scanned);
out.push("- 违例命中（翻转后将硬拦）：**" + rows.length + "** — by kind: " + JSON.stringify(byKind));
out.push("- token 类分布：" + JSON.stringify(byCls));
out.push("- info surfaced-skip（/x 单段 POSIX 根，不阻断）：**" + infoRows.length + "**");
out.push("");
out.push("## 违例命中清单");
out.push("");
if (rows.length === 0) {
  out.push("（零命中）");
} else {
  out.push("<!-- machine-local: 下列引用行为审计对象——机器路径摘录须原样呈现以可复核 @ 2026-09-22 -->");
  out.push("```text");
  for (const r of rows) out.push(r.rel + ":" + r.line + "  [" + r.kind + "]  " + r.excerpt);
  out.push("```");
}
out.push("");
out.push("## info surfaced-skip 清单（前 60 条）");
out.push("");
if (infoRows.length === 0) out.push("（零命中）");
else {
  // info 条目内不出现 hard-hit token——此处不加盖 fence marker（棘轮腿会把
  // 空守卫 marker 判 stale；首轮实录 .scratch/grill-round-78 自证过此例）。
  out.push("```text");
  for (const r of infoRows.slice(0, 60)) out.push(r.rel + ":" + r.line + "  " + r.detail);
  if (infoRows.length > 60) out.push("... and " + (infoRows.length - 60) + " more");
  out.push("```");
}
out.push("");
fs.writeFileSync(path.join(HERE, "t1-warn-sweep.md"), out.join("\n") + "\n");
console.log("scanned=" + scanned + " violations=" + rows.length + " infos=" + infoRows.length);
console.log("byKind=" + JSON.stringify(byKind));
console.log("byCls=" + JSON.stringify(byCls));
