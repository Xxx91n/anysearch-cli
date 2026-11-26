// redactSecrets: key shapes go; paths stay readable by default, and reply text
// can opt out of keeping them.
// redactPaths: a host-facing line may name a relative file, never a machine's.
import { redactPaths, redactSecrets } from "../src/redact";

let passed = 0, failed = 0;
function expect(got: string, cond: boolean, msg: string) {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL " + msg + ": " + JSON.stringify(got));
}

const KEY = "sk-live-abcdefghijklmnopqrstuvwxyz012345";
const LONG_PATH = "/home/me/verylongdirectorynameabcdefghijklmnop/credentials.json";

const keyDefault = redactSecrets("value was " + KEY);
expect(keyDefault, !keyDefault.includes(KEY) && keyDefault.includes("[redacted]"), "a prefixed key is redacted");
const keyReply = redactSecrets("value was " + KEY, { keepPaths: false });
expect(keyReply, !keyReply.includes(KEY), "keepPaths:false still redacts the key");

const pathDefault = redactSecrets("could not read " + LONG_PATH);
expect(pathDefault, pathDefault.includes(LONG_PATH), "default keeps the path readable");
const pathReply = redactSecrets("could not read " + LONG_PATH, { keepPaths: false });
expect(pathReply, !pathReply.includes("verylongdirectorynameabcdefghijklmnop"), "reply text redacts a long path segment");

const posix = redactPaths("could not read /home/ana/.ans/config.toml: EACCES");
expect(posix, posix === "could not read [path]: EACCES", "an absolute POSIX path is replaced");
const drive = redactPaths("failed at C:\\Users\\ana\\.ans\\config.toml.");
expect(drive, drive === "failed at [path].", "a drive-letter path is replaced, full stop stays");
const unc = redactPaths("share \\\\host\\share\\a.toml unreachable");
expect(unc, unc === "share [path] unreachable", "a UNC path is replaced");
const url = redactPaths("POST https://api.example.com/v1/chat failed");
expect(url, url === "POST https://api.example.com/v1/chat failed", "a URL keeps its path");
const relative = redactPaths("fix .ans/config.toml first");
expect(relative, relative === "fix .ans/config.toml first", "a relative file name stays");
const spaced = redactPaths("could not read C:\\Users\\Ana Smith\\.ans\\config.toml: EACCES");
expect(spaced, spaced === "could not read [path]: EACCES", "a path with a space in the user name goes whole");
const spacedPosix = redactPaths("could not read /home/Ana Smith/.ans/config.toml");
expect(spacedPosix, spacedPosix === "could not read [path]", "the same rule on POSIX");
const multiWord = redactPaths("cannot open C:\\Documents and Settings\\Ana Maria de la Cruz\\.ans\\config.toml: EACCES");
expect(multiWord, multiWord === "cannot open [path]: EACCES", "several spaces do not stop the path early");
const initial = redactPaths("cannot open C:\\Users\\J. Smith\\AppData\\Roaming\\ans\\config.toml: EACCES");
expect(initial, initial === "cannot open [path]: EACCES", "a dot inside a name is not the sentence end");
const apostrophe = redactPaths("cannot open C:\\Users\\O'Brien\\AppData\\ans\\config.toml: EACCES");
expect(apostrophe, apostrophe === "cannot open [path]: EACCES", "an apostrophe does not end a user name");
const dottedDir = redactPaths("cannot open /home/u/v2.1 backup/data/config.toml");
expect(dottedDir, dottedDir === "cannot open [path]", "a dotted directory name is not a file extension");
const twoPaths = redactPaths("cannot read /home/ana/.ans/config.toml and /tmp/x.toml: EACCES");
expect(twoPaths, twoPaths === "cannot read [path] and [path]: EACCES", "a second path on the same line is redacted too");
const programFiles = redactPaths("write C:\\Program Files (x86)\\app\\x.log failed");
expect(programFiles, programFiles === "write [path] failed", "a parenthesised directory is part of the path");
const proseAfter = redactPaths("read /etc/ans/config.toml I/O error");
expect(proseAfter, proseAfter === "read [path] I/O error", "the word after a file extension stays prose");
const jsonl = redactPaths("lock at /home/u/.ans/pi-sessions/abc.jsonl is stale");
expect(jsonl, jsonl === "lock at [path] is stale", "the session record extension ends the path");
const envFile = redactPaths("read /home/u/.env failed");
expect(envFile, envFile === "read [path] failed", "an .env file ends the path");

const envKept = redactSecrets("ANS_LLM_CONTEXT_WINDOW must be a positive integer", { keepEnvNames: true });
expect(envKept, envKept.includes("ANS_LLM_CONTEXT_WINDOW"), "keepEnvNames: an actionable setting survives");
const envDefault = redactSecrets("ANS_LLM_CONTEXT_WINDOW must be a positive integer");
expect(envDefault, !envDefault.includes("ANS_LLM_CONTEXT_WINDOW"),
  "the default still treats a 20+ run as key-shaped");

console.log("--- redact tests: " + passed + " passed, " + failed + " failed ---");
if (failed > 0) process.exit(1);
