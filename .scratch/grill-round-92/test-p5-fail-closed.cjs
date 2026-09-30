const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

function runClaim(c) {
  const fp = path.join(ROOT, c.file || "README.md");
  if (!fs.existsSync(fp)) throw new Error('file missing');
  const text = fs.readFileSync(fp, "utf8");
  const host = c.host || "DeepSeek Harness";
  const hostLine = text.split("\n").find((l) => l.includes(host));
  if (!hostLine) throw new Error('host line missing');
  const m = hostLine.match(/\|\s*[^|]+\|\s*([^|\s]+)\s*\|/);
  const declaredVer = m ? m[1].trim() : null;
  if (!declaredVer) throw new Error('declared version missing');

  let expectedVer = c.expect;
  if (!expectedVer && c.command) {
    const r = spawnSync(c.command, { cwd: ROOT, encoding: "utf8", shell: true, timeout: 10000 });
    expectedVer = (r.stdout ?? "").trim();
  }
  if (!c.shadow && !expectedVer) {
    throw new Error('cannot resolve expected version (fail-closed)');
  }
  if (c.shadow) {
    const matchState = (expectedVer && declaredVer === expectedVer) ? "MATCH" : "MISMATCH";
    return { ok: true, shadow: true, matchState, declaredVer, expectedVer };
  } else {
    if (declaredVer !== expectedVer) {
      throw new Error(`declared version ${declaredVer} != expected ${expectedVer}`);
    }
    return { ok: true, shadow: false, declaredVer, expectedVer };
  }
}

// Test 1: strict mode with missing expectedVer -> must fail closed
let t1Failed = false;
try {
  runClaim({ file: "README.md", host: "DeepSeek Harness", shadow: false });
} catch (e) {
  if (e.message.includes('cannot resolve expected version (fail-closed)')) t1Failed = true;
}
console.log('Test 1 (missing expectedVer fails closed):', t1Failed);

// Test 2: strict mode with mismatching version -> must fail
let t2Failed = false;
try {
  runClaim({ file: "README.md", host: "DeepSeek Harness", shadow: false, expect: "9.9.9" });
} catch (e) {
  if (e.message.includes('!= expected 9.9.9')) t2Failed = true;
}
console.log('Test 2 (version mismatch fails):', t2Failed);

// Test 3: strict mode with matching version -> must pass
let t3Passed = false;
try {
  const res = runClaim({ file: "README.md", host: "DeepSeek Harness", shadow: false, expect: "0.1.5-rc.2" });
  if (res.ok) t3Passed = true;
} catch (e) {}
console.log('Test 3 (matching version passes):', t3Passed);

// Test 4: shadow mode with mismatch -> non-blocking, returns MISMATCH
const t4Res = runClaim({ file: "README.md", host: "DeepSeek Harness", shadow: true, expect: "0.1.7-rc.2" });
console.log('Test 4 (shadow mode non-blocking):', t4Res.ok, 'matchState:', t4Res.matchState);

if (!t1Failed || !t2Failed || !t3Passed || !t4Res.ok) {
  process.exit(1);
}
console.log('ALL P5 UNIT TESTS PASSED!');
