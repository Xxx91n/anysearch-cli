// redactSecrets: key shapes go; paths stay readable by default, and reply text
// can opt out of keeping them.
import { redactSecrets } from "../src/redact";

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

console.log("--- redact tests: " + passed + " passed, " + failed + " failed ---");
if (failed > 0) process.exit(1);
