// Write e2e .claude/settings.json variants for Claude Code official hooks schema.
// Usage: node write-settings.mjs <variant>
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
const v = process.argv[2];
const P = 'D:/Aworker/e2e-r66-claude/.claude/settings.json';
const NPMG = 'C:/Users/Administrator/AppData/Roaming/npm/node_modules';
const SCR = 'D:/Aworker/anysearch-cli/.scratch/grill-round-66/scripts';
const ADAPTER = NPMG + '/@anysearch-cli/plugin/dist/hooks/adapters/claude.cjs';
const SESS = NPMG + '/@anysearch-cli/plugin/dist/hooks/session-start.cjs';
const template = JSON.parse(readFileSync(NPMG + '/@anysearch-cli/plugin/configs/claude/hooks.json', 'utf8')).hooks;
const sentinel = { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'node "' + SCR + '/sentinel.cjs"' }] }] };
const official = {
  PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'node "' + ADAPTER + '"', timeout: 5 }] }],
  PostToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'node "' + ADAPTER + '"', timeout: 10 }] }],
  SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'node "' + SESS + '"', timeout: 5 }] }]
};
const deny = (f) => ({ PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'node "' + SCR + '/' + f + '"', timeout: 5 }] }] });
let out = null;
if (v === 'template') out = { hooks: template };
else if (v === 'sentinel') out = { hooks: sentinel };
else if (v === 'template+sentinel') out = { hooks: { PreToolUse: template.PreToolUse, PostToolUse: template.PostToolUse, SessionStart: [...template.SessionStart, ...sentinel.SessionStart] } };
else if (v === 'official') out = { hooks: official };
else if (v === 'official+sentinel') out = { hooks: { ...official, SessionStart: [...official.SessionStart, ...sentinel.SessionStart] } };
else if (v === 'deny-envelope') out = { hooks: deny('deny-envelope.cjs') };
else if (v === 'deny-toplevel') out = { hooks: deny('deny-toplevel.cjs') };
else if (v === 'deny-legacy') out = { hooks: deny('deny-legacy.cjs') };
else if (v === 'http-sentinel') out = { hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'http', url: 'http://127.0.0.1:33333/health', timeout: 5 }] }] } };
else if (v === 'none') { try { rmSync(P); console.log('removed'); } catch { console.log('absent'); } process.exit(0); }
writeFileSync(P, JSON.stringify(out, null, 2));
console.log('wrote ' + v + ' -> ' + P);
