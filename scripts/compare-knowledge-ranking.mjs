import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const [basePath, headPath] = process.argv.slice(2);
const base = JSON.parse(readFileSync(basePath, "utf8"));
const head = JSON.parse(readFileSync(headPath, "utf8"));
assert.deepEqual(Object.keys(head).sort(), ["en", "mixed", "zh"]);
for (const bucket of Object.keys(head)) {
  assert.equal(head[bucket].count, 4, `${bucket}: fixed sample count`);
  assert.equal(base[bucket].count, head[bucket].count);
  for (const metric of ["ndcgAt10", "mrrAt10", "recallAt10"]) {
    assert(Number.isFinite(head[bucket][metric]) && Number.isFinite(base[bucket][metric]));
    console.log(`${bucket} ${metric}: ${base[bucket][metric].toFixed(4)} -> ${head[bucket][metric].toFixed(4)}`);
    assert(head[bucket][metric] >= base[bucket][metric], `${bucket}: ${metric} regressed`);
  }
}
assert(head.mixed.ndcgAt10 > base.mixed.ndcgAt10, "mixed query ranking must improve");
