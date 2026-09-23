const { execSync } = require('child_process');
const fs = require('fs');
const ROOT = 'D:/Aworker/anysearch-cli';
const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n')
  .filter(f => f.endsWith('.md') && (f.startsWith('docs/') || f.startsWith('.scratch/') || !f.includes('/')));
const FENCE = /^\s*```/, MARK = /<!--\s*machine-local\s*:/;
const ABS = /[A-Za-z]:[\\/]|\/(?:Users|home|tmp)\//;
const REPOHINT = /aworker|anysearch-cli/i;
let covered = 0, unmarked = 0; const ex = [];
for (const f of files) {
  const ls = fs.readFileSync(ROOT + '/' + f, 'utf8').split('\n');
  let fenced = false, marked = false;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (FENCE.test(l)) { if (!fenced) marked = (i > 0 && MARK.test(ls[i - 1])) || MARK.test(l); fenced = !fenced; continue; }
    if (!fenced) continue;
    if (ABS.test(l) && REPOHINT.test(l)) {
      if (marked) { covered++; if (ex.length < 6) ex.push('marked   ' + f + ':' + (i + 1)); }
      else { unmarked++; if (ex.length < 12) ex.push('UNMARKED ' + f + ':' + (i + 1)); }
    }
  }
}
console.log('in-repo-ish abs paths inside MARKED fences:', covered);
console.log('inside UNMARKED fences:', unmarked);
ex.forEach(x => console.log(' ', x));
