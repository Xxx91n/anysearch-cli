// PI session-record location, compaction thresholds, and the cross-process
// session lock windows (#258, #266).
//
// The kernel reads no env, so each host (CLI, MCP) passes its own env in. The
// contract lives here once instead of being copied into both roots.
import { basename, dirname, join } from "node:path";
import { closeSync, openSync, readFileSync, readSync, readdirSync, truncateSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { resolveDbPath } from "./composition";
import type { SessionLockWindows } from "./session-lock";

/**
 * Directory for PI's append-only JSONL session records. Defaults to a
 * `pi-sessions/` folder next to the durable DB; `ANS_PI_SESSION_DIR` overrides.
 */
export function resolvePiSessionDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ANS_PI_SESSION_DIR?.trim();
  if (override) return override;
  return join(dirname(resolveDbPath(env)), "pi-sessions");
}

// Design: read PI's bounded JSONL headers — listAll reads every transcript
// and silently skips files on errors, which can create a second conversation
// under an existing handle after restart.
function readPiSessionId(file: string): string {
  const fd = openSync(file, "r");
  try {
    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.allocUnsafe(4096);
    const limit = 1024 * 1024;
    let scanned = 0;
    let pending = "";
    const parseLine = (line: string): string | undefined => {
      let entry: unknown;
      try { entry = JSON.parse(line); } catch { return undefined; }
      if (!entry || typeof entry !== "object" || (entry as { type?: unknown }).type !== "session" ||
          typeof (entry as { id?: unknown }).id !== "string") {
        throw new Error("会话记录的开头不是有效的会话信息：" + file);
      }
      return (entry as { id: string }).id;
    };
    while (scanned < limit) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, limit - scanned), null);
      if (count === 0) {
        const id = parseLine(pending + decoder.end());
        if (id) return id;
        throw new Error("会话记录没有有效的会话信息：" + file);
      }
      scanned += count;
      pending += decoder.write(buffer.subarray(0, count));
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        const id = parseLine(line);
        if (id) return id;
      }
    }
    const probe = Buffer.allocUnsafe(1);
    if (readSync(fd, probe, 0, 1, null) === 0) {
      const id = parseLine(pending + decoder.end());
      if (id) return id;
    }
    throw new Error("会话记录的开头太长，无法确定会话：" + file);
  } finally { closeSync(fd); }
}

/**
 * What the directory says about one handle, before the file itself is judged.
 *
 * Three outcomes, kept apart because they need three different answers. The old
 * shape threw from the index and made every caller re-derive which case it was,
 * and those re-derivations disagreed — a list could say "fine" while a resume
 * refused (#316). One structured answer is what keeps them identical.
 */
type PiSessionRecordClaim =
  /** No file claims this handle. */
  | { kind: "absent" }
  /** Exactly one file claims it. `unreadable` is set when its header could not be read. */
  | { kind: "one"; path: string; unreadable?: unknown }
  /** More than one file claims it. Choosing one could hide part of a chat. */
  | { kind: "many"; paths: string[] };

/**
 * Scan the record directory once and answer, per handle, which file claims it.
 *
 * A file claims a handle two ways: the id in its header and the id in its name.
 * They can disagree (a copy, a manual rename), and both claims are kept so such
 * a file is FOUND and then refused by the identity check rather than reading as
 * "this session never existed" — "wrong" and "absent" are different answers.
 *
 * A file whose header cannot be read but whose name claims this handle is
 * reported as unreadable for that handle: it could be this session's record, and
 * answering "absent" would let the caller start a fresh conversation under a
 * handle that already has one.
 */
export function scanPiSessionRecords(dir: string): (key: string) => PiSessionRecordClaim {
  let files: string[];
  try { files = readdirSync(dir); }
  catch (error: any) {
    if (error?.code === "ENOENT") return () => ({ kind: "absent" });
    throw error;
  }
  const byHeader = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  const unreadableByName = new Map<string, unknown>();
  const push = (map: Map<string, string[]>, key: string, path: string): void => {
    const matches = map.get(key) ?? [];
    matches.push(path);
    map.set(key, matches);
  };
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const namedKey = file.match(/_(ans-[0-9a-f]{32})\.jsonl$/)?.[1];
    const path = join(dir, file);
    if (namedKey) push(byName, namedKey, path);
    try {
      push(byHeader, readPiSessionId(path), path);
    } catch (error) {
      // Only a file whose NAME claims the handle can be attributed to it. A
      // stray unreadable file with no name (or another session's name) says
      // nothing about this handle, and letting it fail every lookup would stop
      // brand-new chats over a file they never touch.
      if (namedKey) unreadableByName.set(namedKey, error);
    }
  }
  return (key: string): PiSessionRecordClaim => {
    // One path can claim the key both ways; that is one record, not two.
    const paths = [...new Set([...(byHeader.get(key) ?? []), ...(byName.get(key) ?? [])])];
    if (paths.length > 1) return { kind: "many", paths };
    const unreadable = unreadableByName.get(key);
    // An unreadable file that names the handle: the name gives its path, and a
    // missing name means it cannot be this handle's record at all.
    if (unreadable !== undefined) {
      const named = byName.get(key)?.[0];
      return named ? { kind: "one", path: named, unreadable } : { kind: "absent" };
    }
    return paths.length === 1 ? { kind: "one", path: paths[0]! } : { kind: "absent" };
  };
}

/**
 * More than one file claims the same session handle.
 *
 * A distinct type because this is not "one file could not be read": no amount of
 * retrying settles which record is the real one, and the user has to look.
 */
export class AmbiguousSessionRecordError extends Error {
  constructor(readonly key: string, readonly paths: string[]) {
    // The paths are the useful part: they are what a person has to compare. The
    // hashed handle is not, so it stays on the field and out of the sentence.
    super("同一个会话有多份对话记录，要人工核对是哪一份：" + paths.join("、"));
    this.name = "AmbiguousSessionRecordError";
  }
}

/** Find one PI record; check again under the caller's session lock before use. */
export function findPiSessionRecord(dir: string, key: string): string | undefined {
  const claim = scanPiSessionRecords(dir)(key);
  if (claim.kind === "many") throw new AmbiguousSessionRecordError(key, claim.paths);
  if (claim.kind === "absent") return undefined;
  if (claim.unreadable !== undefined) throw claim.unreadable;
  return claim.path;
}

/**
 * The newest session-record format this build understands (#316).
 *
 * PI's own `CURRENT_SESSION_VERSION` is 3 for the 1.5.1 release we run. The
 * constant is copied rather than imported because importing the SDK at module
 * load would pay its multi-second evaluation for every command (#258); the
 * test suite pins the two values together so a PI bump shows up as a failure
 * instead of a silently wrong answer.
 */
export const PI_SESSION_FORMAT_VERSION = 3;

/**
 * Entry kinds this build knows how to read. Anything else means the file was
 * written by a newer version that added an event we would have to guess the
 * meaning of — the record is refused instead of half-understood.
 */
const PI_SESSION_KNOWN_ENTRY_TYPES = new Set([
  "message",
  "thinking_level_change",
  "model_change",
  "usage",
  "compaction",
  "branch_summary",
  "custom",
  "custom_message",
  "context_edit",
  "label",
  "session_info",
]);

/** Why a record cannot be used. Each one gets its own sentence for the user. */
export type PiSessionRecordProblem =
  | "missing"
  | "unreadable"
  | "empty"
  | "bad-line"
  | "newer-format"
  | "unknown-event"
  | "identity-mismatch"
  /** Several files claim this handle; a person has to decide which is real. */
  | "ambiguous";

/**
 * What one record says about itself, as a verdict.
 *
 * A torn tail is NOT a failure: it is the half-written last line of an append
 * that died, so it carries no fact. The verdict still names it, because the
 * caller must cut it off before the next append — otherwise every later line
 * lands behind a fragment that no reader can parse, and one failed write locks
 * the conversation for good.
 */
export type PiSessionRecordVerdict =
  | { ok: true; tornTail?: { line: number; bytes: number } }
  | { ok: false; problem: PiSessionRecordProblem; message: string; line?: number };

/** A record's location and what it says. Never throws: a broken one is a verdict. */
export interface PiSessionRecordLookup {
  /** Where the record is, when one was found at all. */
  path?: string;
  verdict: PiSessionRecordVerdict;
}

function refuse(problem: PiSessionRecordProblem, message: string, line?: number): PiSessionRecordVerdict {
  return line === undefined ? { ok: false, problem, message } : { ok: false, problem, message, line };
}

/**
 * The id a record's file name claims. PI writes `<timestamp>_<sessionId>.jsonl`,
 * so the id is the part after the last underscore; a name with no underscore
 * claims the whole stem, which will not match a real handle.
 */
function idFromFileName(path: string): string {
  const stem = basename(path).replace(/\.jsonl$/i, "");
  const cut = stem.lastIndexOf("_");
  return cut === -1 ? stem : stem.slice(cut + 1);
}

/**
 * How many raw bytes the unfinished last line occupies.
 *
 * This must be counted on the FILE, not on the decoded text. An append killed in
 * the middle of a multi-byte character decodes that partial character to U+FFFD,
 * and re-encoding the decoded string gives 3 bytes for a fragment that really
 * holds 1 or 2. Cutting the larger number slices into the PREVIOUS complete
 * line's terminating newline, so the next read would treat that whole complete
 * line as the new torn tail and drop a real turn — data loss from a repair that
 * was supposed to save the file.
 *
 * The fragment is everything after the last 0x0A, so its length is the bytes
 * after that offset. Undefined means the file has no newline at all, which the
 * caller treats as unreadable rather than guessing.
 */
function tornTailBytes(raw: Buffer): number | undefined {
  const lastNewline = raw.lastIndexOf(0x0a);
  if (lastNewline === -1) return undefined;
  return raw.length - lastNewline - 1;
}

/**
 * Read one whole session record and say what it is, without touching the file.
 *
 * This is the one place that decides whether a conversation can be handed to
 * PI. PI's own loader skips a malformed line and keeps going, which is right
 * for an append-only log and wrong for RESURRECTING a conversation: the model
 * would answer as if the lost turn never happened. So the whole file is judged
 * here, in this order, and the first problem stops it:
 *
 *   1. can the file be read at all;
 *   2. is it empty;
 *   3. is the header the first complete line, with a version we know;
 *   4. do the header id, the file-name id and the requested handle all agree;
 *   5. does every remaining complete line parse, and is every event kind known.
 *
 * A last segment with no terminating newline is the torn tail of an interrupted
 * append: it is dropped from the judgment and reported for repair, never
 * treated as a fact.
 */
export function judgePiSessionRecord(path: string, expectedKey: string): PiSessionRecordVerdict {
  let raw: Buffer;
  try { raw = readFileSync(path); }
  catch (e: any) { return refuse("unreadable", "会话记录读不出来：" + (e?.message || String(e))); }
  const text = raw.toString("utf8");
  if (!text.trim()) return refuse("empty", "会话记录是空的，没有可以续的内容");

  // A file that ends without a newline has an unfinished last line. Judge the
  // complete lines only; the fragment is reported so the caller can cut it.
  // The byte count comes from the raw bytes, never from the decoded string —
  // see tornTailBytes above.
  const segments = text.split("\n");
  const complete = text.endsWith("\n") ? segments.slice(0, -1) : segments;
  let tornTail: { line: number; bytes: number } | undefined;
  if (!text.endsWith("\n")) {
    const tail = complete[complete.length - 1] ?? "";
    if (tail.trim()) {
      const bytes = tornTailBytes(raw);
      // No newline anywhere: not one complete line exists, so there is nothing
      // to cut back to and nothing to read. Say that instead of trimming the
      // file to zero and calling it either empty or repaired.
      if (bytes === undefined) {
        return refuse("unreadable", "会话记录里没有一行是写完的，读不出任何内容：" + path);
      }
      tornTail = { line: complete.length, bytes };
      complete.pop();
    } else {
      complete.pop();
    }
  }

  const nonBlank = complete
    .map((line, index) => ({ line, number: index + 1 }))
    .filter((entry) => entry.line.trim());

  const headerLine = nonBlank[0];
  if (!headerLine) return refuse("empty", "会话记录是空的，没有可以续的内容");

  let header: any;
  try { header = JSON.parse(headerLine.line); }
  catch {
    return refuse("unreadable",
      "会话记录第 " + headerLine.number + " 行写的是文件开头，但读不懂。这个文件不是可用的会话记录：" + path);
  }
  if (!header || typeof header !== "object" || header.type !== "session" || typeof header.id !== "string") {
    return refuse("unreadable", "会话记录的开头不是有效的会话信息：" + path);
  }

  // PI treats a missing version as 1; anything above ours was written by a
  // newer program whose events we would have to guess.
  const version = typeof header.version === "number" ? header.version : 1;
  if (version > PI_SESSION_FORMAT_VERSION) {
    return refuse("newer-format",
      "会话记录的格式版本是 " + version + "，本程序只认到 " + PI_SESSION_FORMAT_VERSION +
      "。旧程序不猜新格式的内容，拒绝打开：" + path);
  }

  const namedId = idFromFileName(path);
  if (header.id !== expectedKey || namedId !== expectedKey) {
    return refuse("identity-mismatch",
      "会话记录的身份对不上：记录里写的是 " + header.id + "，文件名里写的是 " + namedId +
      "，要打开的是 " + expectedKey + "。拒绝打开，原文件未改动：" + path);
  }

  for (const { line, number } of nonBlank.slice(1)) {
    let entry: any;
    try { entry = JSON.parse(line); }
    catch { return refuse("bad-line", "会话记录第 " + number + " 行坏了，读不出一条完整记录：" + path, number); }
    const type = entry && typeof entry === "object" ? (entry as { type?: unknown }).type : undefined;
    if (typeof type !== "string" || !PI_SESSION_KNOWN_ENTRY_TYPES.has(type)) {
      return refuse("unknown-event",
        "会话记录第 " + number + " 行是一种本程序不认识的事件（" + String(type) +
        "），不猜它的意思，拒绝打开：" + path, number);
    }
  }

  return tornTail ? { ok: true, tornTail } : { ok: true };
}

/**
 * One short sentence for a verdict, for places that list many records and
 * cannot print a full paragraph for each (the session list).
 */
export function describePiSessionVerdict(verdict: PiSessionRecordVerdict): string {
  if (verdict.ok) return verdict.tornTail ? "尾行断在第 " + verdict.tornTail.line + " 行，下次写入前会切掉" : "正常";
  switch (verdict.problem) {
    case "missing": return "没有对话记录";
    case "unreadable": return "对话记录读不出来";
    case "empty": return "对话记录是空的";
    case "bad-line": return "对话记录坏了（第 " + (verdict.line ?? 0) + " 行）";
    case "newer-format": return "对话记录比本程序新，不能打开";
    case "unknown-event": return "对话记录里有本程序不认识的内容（第 " + (verdict.line ?? 0) + " 行）";
    case "identity-mismatch": return "对话记录的身份对不上";
    case "ambiguous": return "同一个会话有多份对话记录，要人工核对";
  }
}

/**
 * Cut off the unfinished last line, and nothing else.
 *
 * Called only after `judgePiSessionRecord` returned a torn tail, and only while
 * holding the session's write lock. That lock is the whole reason this is safe:
 * it is what guarantees no entry was appended between the judgment and this cut.
 * Without it, cutting "the bytes after the last newline" would delete whatever a
 * writer just added. Repair is a separate step on purpose — judging must stay a
 * pure function that never modifies the file.
 *
 * The cut point is measured again here instead of trusting the verdict's byte
 * count: the count describes the file at judgment time, and re-measuring keeps
 * the cut on the last real newline. It is the same rule the judgment uses, so the
 * two cannot disagree about where the fragment ends. The verdict's number stays
 * for diagnostics and for the list, which shows the line the tail broke on.
 *
 * Returns whether bytes were removed.
 */
export function repairPiSessionTornTail(path: string, verdict: PiSessionRecordVerdict): boolean {
  if (!verdict.ok || !verdict.tornTail) return false;
  let raw: Buffer;
  try { raw = readFileSync(path); }
  catch { return false; }
  // Nothing to cut if the file now ends with a newline: the line was finished,
  // so the fragment the verdict named no longer exists.
  const lastNewline = raw.lastIndexOf(0x0a);
  if (lastNewline === -1 || lastNewline === raw.length - 1) return false;
  truncateSync(path, lastNewline + 1);
  return true;
}

/**
 * Turn one claim into a verdict, without reading the file when the claim already
 * refutes it. This is the ONE place the claim becomes a sentence, so the resume
 * path and the session list cannot disagree about the same directory.
 */
function verdictFromClaim(claim: PiSessionRecordClaim, key: string): PiSessionRecordLookup {
  // Design: the sentence does not repeat `key`. It is a hashed handle, not
  // something a person can act on, and every caller already shows the session id
  // it asked about. The useful part is what is wrong and — for a damaged file —
  // which path to look at.
  if (claim.kind === "absent") {
    return { verdict: refuse("missing", "没有这段会话的对话记录") };
  }
  if (claim.kind === "many") {
    return { verdict: refuse("ambiguous", "同一个会话有多份对话记录，要人工核对是哪一份") };
  }
  // The name claims this handle but the header could not be read. The path is
  // still reported: a caller asking "does this session have a transcript?" must
  // see "yes, and it is damaged", or it would start a fresh empty conversation
  // under a handle that already has one (#316).
  if (claim.unreadable !== undefined) {
    const message = (claim.unreadable as any)?.message || String(claim.unreadable);
    return { path: claim.path, verdict: refuse("unreadable", message) };
  }
  return { path: claim.path, verdict: judgePiSessionRecord(claim.path, key) };
}

/**
 * Locate one session's record and judge it, without throwing.
 *
 * Nothing here guesses: the claim decides, and a claim that cannot be settled
 * (two files, an unreadable header) becomes its own refusal. Throwing instead
 * would leave each caller to re-derive the case, which is how a list ends up
 * saying "fine" about a record a resume refuses.
 */
export function lookupPiSessionRecord(dir: string, key: string): PiSessionRecordLookup {
  let claim: PiSessionRecordClaim;
  try { claim = scanPiSessionRecords(dir)(key); }
  catch (error: any) {
    // The directory itself cannot be listed. Nothing about this handle can be
    // claimed either way, so say so rather than "missing".
    return { verdict: refuse("unreadable", "会话记录目录读不出来：" + (error?.message || String(error))) };
  }
  return verdictFromClaim(claim, key);
}

/**
 * A verdict function for a whole session list, from ONE directory scan.
 *
 * Scanning the directory per listed row makes the list quadratic, and the point
 * of the list is to show many conversations at once. The returned function gives
 * exactly the verdict `lookupPiSessionRecord` would for each handle, so a listed
 * row and a resume can never disagree — including the refusals for a duplicate
 * record or an unreadable one.
 */
export function sessionVerdictsForDir(dir: string): (key: string) => PiSessionRecordVerdict {
  let scan: ((key: string) => PiSessionRecordClaim) | undefined;
  let scanError: unknown;
  try { scan = scanPiSessionRecords(dir); }
  catch (error) { scanError = error; }
  return (key: string) => {
    if (!scan) {
      return refuse("unreadable", "会话记录目录读不出来：" + ((scanError as any)?.message || String(scanError)));
    }
    return verdictFromClaim(scan(key), key).verdict;
  };
}

/**
 * Positive-integer env value, or undefined. An unparsable, zero, or negative
 * value stays undefined so the caller's default applies — never a silent 0.
 */
function positiveIntFromEnv(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/**
 * PI compaction thresholds. The defaults are PI's own; the env overrides exist
 * so a probe or an operator can force compaction on a small context without
 * editing product code. An unparsable value stays undefined (PI's default
 * applies) rather than silently becoming 0.
 */
export function piCompactionFromEnv(env: NodeJS.ProcessEnv = process.env): { reserveTokens?: number; keepRecentTokens?: number } {
  return {
    reserveTokens: positiveIntFromEnv(env.ANS_PI_COMPACTION_RESERVE_TOKENS),
    keepRecentTokens: positiveIntFromEnv(env.ANS_PI_COMPACTION_KEEP_RECENT_TOKENS),
  };
}

/**
 * Cross-process session lock windows (#266). `ANS_PI_LOCK_STALE_MS` bounds how
 * long a lock whose owner this machine cannot confirm is kept (default
 * 10 min); `ANS_PI_LOCK_TIMEOUT_MS` is the same-session wait cap before the
 * run fails with "session busy" (default 0, no automatic wait). Both exist so tests can
 * observe expiry and recovery in seconds; an unparsable or non-positive value
 * keeps the default rather than silently becoming 0.
 */
export function sessionLockWindowsFromEnv(env: NodeJS.ProcessEnv = process.env): SessionLockWindows {
  const windows: SessionLockWindows = {};
  const staleMs = positiveIntFromEnv(env.ANS_PI_LOCK_STALE_MS);
  const waitMs = positiveIntFromEnv(env.ANS_PI_LOCK_TIMEOUT_MS);
  if (staleMs !== undefined) windows.staleMs = staleMs;
  if (waitMs !== undefined) windows.waitMs = waitMs;
  return windows;
}

/**
 * The PI wiring every host owes the runtime, resolved from one env snapshot:
 * where the session records live, how PI compacts, the credential the provider
 * registration needs, and the working directory the session and resource loader
 * use. Both roots call this, so the contract has one definition instead of two
 * copies drifting apart (#258).
 */
export function piSessionOptions(
  sessionId: string | undefined,
  apiKey: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): { piSessionDir?: string; piCompaction: { reserveTokens?: number; keepRecentTokens?: number }; sessionLock: SessionLockWindows; apiKey?: string; cwd: string } {
  return {
    // No handle means no record to key on, so the session stays in memory.
    piSessionDir: sessionId ? resolvePiSessionDir(env) : undefined,
    piCompaction: piCompactionFromEnv(env),
    sessionLock: sessionLockWindowsFromEnv(env),
    apiKey,
    cwd,
  };
}
