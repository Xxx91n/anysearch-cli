// Write e2e .claude/settings.json variants. Usage: node write-settings.mjs <variant>
// variants: template | sentinel | template+sentinel | official-empty | none
import { writeFileSync, rmSync } from 'node:fs';
const v = process.argv[2];
const P = 'D:/Aworker/e2e-r66-claude/.claude/settings.json';
const NPMG = 'C:/Users/Administrator/AppData/Roaming/npm/node_modules';
const template = { PreToolUse: [{ name: 'anysearch-preheat', command: 'node', args: ['${CLAUDE_PLUGIN_DIR}/../dist/hooks/adapters/claude.cjs'], timeout: 5 }], PostToolUse: [{ name: 'anysearch-distill', command: 'node', args: ['${CLAUDE_PLUGIN_DIR}/../dist/hooks/adapters/claude.cjs'], timeout: 10 }], SessionStart: [{ name: 'anysearch-session-start', command: 'node', args: ['${CLAUDE_PLUGIN_DIR}/../dist/hooks/session-start.cjs'], timeout: 5 }] };
const sentinel = { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: "node -e \"console.log('ANS_SENTINEL_FIRED')\"" }] }] };
let out = null;
if (v === 'template') out = { hooks: template };
else if (v === 'sentinel') out = { hooks: sentinel };
else if (v === 'template+sentinel') out = { hooks: { PreToolUse: template.PreToolUse, PostToolUse: template.PostToolUse, SessionStart: [...template.SessionStart, ...sentinel.SessionStart] } };
else if (v === 'official-empty') out = { hooks: {} };
else if (v === 'none') { try { rmSync(P); console.log('removed'); } catch { console.log('absent'); } process.exit(0); }
writeFileSync(P, JSON.stringify(out, null, 2));
console.log('wrote ' + v + ' -> ' + P);
