// Splits a page body into sections and blocks, and holds the one tokenizer
// both the index and the query use.
//
// Offsets count code points — the unit SQLite's substr/length use.
// Han runs become overlapping bigrams, a lone Han character keeps its own
// token, every other letter/digit run stays one word, and the rest separates.
// FTS positions are kept because a Han query is a phrase; a one-character Han
// query cannot be a bigram and goes through a page-level LIKE instead.
// Kana and Thai write without spaces and stay one word token here, so a query
// matches them only from the start of the run. Combining marks stay inside the
// run, so an accented word is not split at its accents.

export interface MarkdownBlock {
  /** First code point of the block (inclusive). */
  start: number;
  /** One past the last code point of the block (exclusive). */
  end: number;
}

type Range = MarkdownBlock;

export interface MarkdownSection {
  /** First code point of the section body (inclusive). */
  start: number;
  /** One past the last code point of the section body (exclusive). */
  end: number;
  /** Page title as the root, then the heading stack, joined with " > ". */
  headingPath: string;
  blocks: MarkdownBlock[];
}

/** Target block size, in characters (code points). */
export const BLOCK_TARGET_CHARS = 400;
/** Blocks shorter than this merge into a predecessor when the total stays under the 1200 hard cap. */
export const BLOCK_MIN_CHARS = 200;
/** A block is closed before it grows past this. */
export const BLOCK_MAX_CHARS = 800;
/**
 * Ceiling for a prose block. A code fence or table is exempt from it and is
 * split only past {@link WHOLE_UNIT_SPLIT_CHARS}.
 */
export const BLOCK_HARD_CAP_CHARS = 1200;
/** A section longer than this is split again at paragraph boundaries. */
export const SECTION_MAX_CHARS = 1000;
/** A code fence or table longer than this is split by lines. */
export const WHOLE_UNIT_SPLIT_CHARS = 2000;

/** Unicode properties, so every script (not just ASCII) keeps a searchable word. */
const HAN_CHAR = /\p{Script=Han}/u;
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

function charKind(ch: string): ScriptRun["kind"] | null {
  if (HAN_CHAR.test(ch)) return "han";
  if (WORD_CHAR.test(ch)) return "word";
  return null;
}

interface ScriptRun {
  kind: "han" | "word";
  text: string;
}

function* scriptRuns(text: string): Generator<ScriptRun> {
  let kind: ScriptRun["kind"] | null = null;
  let buf = "";
  const flush = function* (): Generator<ScriptRun> {
    if (kind && buf) yield { kind, text: buf };
    buf = "";
  };
  for (const ch of text) {
    const next = charKind(ch);
    if (next === null) {
      yield* flush();
      kind = null;
      continue;
    }
    if (next !== kind) {
      yield* flush();
      kind = next;
    }
    buf += ch;
  }
  yield* flush();
}

/** Overlapping bigrams of a Han run; a lone character keeps its own token. */
function hanTokens(run: string): string[] {
  const chars = [...run];
  if (chars.length === 1) return [chars[0]!];
  const out: string[] = [];
  for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i]! + chars[i + 1]!);
  return out;
}

/**
 * Index-side tokenization: heading path and body both go through this, and so
 * does a block before it is stored in the contentless FTS table.
 */
export function chunkIndexText(text: string): string {
  const tokens: string[] = [];
  for (const run of scriptRuns(text)) {
    if (run.kind === "han") tokens.push(...hanTokens(run.text));
    else tokens.push(run.text.toLowerCase());
  }
  return tokens.join(" ");
}

export interface ChunkQueryTerms {
  /** FTS expression, or null when the query has no indexable token at all. */
  fts: string | null;
  /** One-character Han runs; they can only be found with a page-level LIKE. */
  singleHan: string[];
}

/**
 * Query-side tokenization, the mirror of {@link chunkIndexText}. Han runs of two
 * or more characters become a bigram phrase (positions matter, hence the
 * quotes); a separated word run becomes a prefix (`vector` finds `vectors`),
 * while a word inside one unbroken stretch is matched whole. A one-character
 * Han run cannot be matched by a bigram index, so callers run it as a
 * page-level LIKE instead.
 */
export function chunkQueryTerms(query: string, maxTerms = 8): ChunkQueryTerms {
  maxTerms = Math.max(1, Math.floor(maxTerms));
  const singleHan: string[] = [];
  const groups: string[] = [];
  const runs = [...scriptRuns(query)];
  const hasSeparator = [...query].some((ch) => charKind(ch) === null);
  // A lone Han character is a token only where it stood alone in the indexed
  // text; every other occurrence sits inside a bigram, so only a page-level
  // LIKE can find it.
  if (runs.length === 1 && runs[0]!.kind === "han" && [...runs[0]!.text].length === 1) {
    return { fts: null, singleHan: [runs[0]!.text] };
  }
  if (runs.length > 0 && !hasSeparator) {
    // The query is one unbroken alnum/Han stretch, so its indexed tokens can be
    // one phrase: positions still line up (`2026年5月` in the body is the token
    // sequence `2026 年 5 月`). A lone Han character inside such a stretch keeps
    // its place in the sequence.
    const phrase = runs.flatMap((run) =>
      run.kind === "han" ? hanTokens(run.text) : [run.text.toLowerCase()],
    );
    if (runs.length === 1 && runs[0]!.kind === "word") {
      return { fts: runs[0]!.text.toLowerCase() + "*", singleHan };
    }
    return { fts: '"' + phrase.slice(0, maxTerms).join(" ") + '"', singleHan };
  }
  // One budget for the whole query, not one per group: a long query cannot
  // turn into a MATCH expression many times the declared cap.
  let budget = maxTerms;
  const loneHan: string[] = [];
  for (const run of runs) {
    if (budget <= 0) break;
    if (run.kind === "han") {
      const tokens = hanTokens(run.text);
      // A lone Han character inside a longer query cannot be matched by the
      // bigram index. Mixed with other terms it would be an OR branch, so it
      // is dropped; if the whole query is only lone Han characters, the page
      // level LIKE lane takes them instead of returning nothing.
      if (tokens.length === 1 && [...run.text].length === 1) {
        loneHan.push(tokens[0]!);
        budget -= 1;
        continue;
      }
      groups.push('"' + tokens.slice(0, budget).join(" ") + '"');
      budget -= Math.min(tokens.length, budget);
    } else {
      groups.push(run.text.toLowerCase() + "*");
      budget -= 1;
    }
  }
  if (groups.length === 0 && loneHan.length > 0) return { fts: null, singleHan: loneHan };
  return { fts: groups.length > 0 ? groups.join(" AND ") : null, singleHan };
}

// ---------------------------------------------------------------------------
// Markdown structure
// ---------------------------------------------------------------------------

interface SourceLine {
  /** Code point offset of the line's first character. */
  start: number;
  /** Code point offset one past the line's last character (before "\n"). */
  end: number;
  text: string;
}

function splitLines(chars: string[]): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (let i = 0; i <= chars.length; i++) {
    if (i === chars.length || chars[i] === "\n") {
      // A CRLF body keeps its "\r" at the end of the line; drop it so an ATX
      // heading still matches ("## x\r" would fail a "$"-anchored regex).
      lines.push({ start, end: i, text: chars.slice(start, i).join("").replace(/\r$/, "") });
      start = i + 1;
    }
  }
  return lines;
}

function rangeLength(r: Range): number {
  return r.end - r.start;
}

/** Lines of a range, with offsets made absolute again. */
function linesIn(chars: string[], r: Range): SourceLine[] {
  return splitLines(chars.slice(r.start, r.end)).map((l) => ({
    start: l.start + r.start,
    end: l.end + r.start,
    text: l.text,
  }));
}

function trimRange(chars: string[], r: Range): Range {
  let start = r.start;
  let end = r.end;
  while (start < end && /\s/.test(chars[start]!)) start++;
  while (end > start && /\s/.test(chars[end - 1]!)) end--;
  return { start, end };
}

function trimText(text: string): string {
  return text.replace(/^\s+|\s+$/g, "");
}

interface RawSection extends MarkdownBlock {
  headingPath: string;
}

interface Heading {
  level: number;
  text: string;
}

/** ATX heading at the very start of a line: `#`, `##`, … with a space or EOL. */
function parseHeading(line: SourceLine): { level: number; text: string } | null {
  const m = /^(#{1,6})(?:[ \t]+|$)(.*)$/.exec(line.text);
  if (!m) return null;
  // An optional closing sequence (`## 部署 ##`) is not part of the heading text;
  // a heading made only of hashes (`## ###`) is empty.
  let text = trimText(m[2] ?? "").replace(/[ \t]+#+$/, "").trim();
  if (/^#+$/.test(text)) text = "";
  return { level: m[1]!.length, text };
}

interface Fence {
  char: "`" | "~";
  len: number;
}

/** An opening fence: at least three backticks or tildes, then an info string. */
function isFenceStart(text: string): Fence | null {
  const m = /^\s*(`{3,}|~{3,})/.exec(text);
  if (!m) return null;
  const run = m[1]!;
  return { char: run[0] as "`" | "~", len: run.length };
}

/** A closing fence uses the same character and is at least as long as the opener. */
function isFenceClose(text: string, fence: Fence): boolean {
  const m = /^\s*(`{3,}|~{3,})\s*$/.exec(text);
  if (!m) return false;
  const run = m[1]!;
  return run[0] === fence.char && run.length >= fence.len;
}

/**
 * Split a Markdown body into sections at ATX headings.
 *
 * The heading line itself is not part of the section body: its text already
 * lives in `headingPath`. Content before the first heading is its own section
 * with the page title as the whole path.
 *
 * Sections over {@link SECTION_MAX_CHARS} split at paragraph boundaries; a
 * single paragraph larger than the cap stays whole, since it has no boundary
 * to cut at.
 */
export function markdownSections(chars: string[], pageTitle: string | null): RawSection[] {
  const lines = splitLines(chars);
  const raw: RawSection[] = [];
  const stack: Heading[] = [];
  const root = trimText(pageTitle ?? "");
  const pathFor = (): string => [root, ...stack.map((h) => h.text)].filter((s) => s.length > 0).join(" > ");

  let cursor = 0;
  let fence: Fence | null = null;
  let bodyStart = 0;
  let bodyPath = pathFor();
  const closeBody = (end: number): void => {
    const trimmed = trimRange(chars, { start: bodyStart, end });
    if (rangeLength(trimmed) > 0) raw.push({ ...trimmed, headingPath: bodyPath });
  };

  for (const line of lines) {
    if (fence) {
      if (isFenceClose(line.text, fence)) fence = null;
      cursor = line.end;
      continue;
    }
    const fenceMarker = isFenceStart(line.text);
    if (fenceMarker) {
      fence = fenceMarker;
      cursor = line.end;
      continue;
    }
    const heading = parseHeading(line);
    if (!heading) {
      cursor = line.end;
      continue;
    }
    // A heading closes the previous body; the new section starts after the
    // heading line (line.end excludes the "\n", so start at line.end):
    // trimRange drops the newline and any blank line right below it.
    closeBody(cursor);
    while (stack.length > 0 && stack[stack.length - 1]!.level >= heading.level) stack.pop();
    stack.push({ level: heading.level, text: heading.text });
    bodyPath = pathFor();
    bodyStart = line.end;
    cursor = line.end;
  }
  closeBody(chars.length);
  return raw;
}

/**
 * Paragraph ranges inside a section body, split at blank lines.
 *
 * A fenced code block is one paragraph even when it contains blank lines, so
 * a section never exposes half a listing.
 */
function paragraphs(chars: string[], r: Range): Range[] {
  const out: Range[] = [];
  let start: number | null = null;
  let end = 0;
  let fence: Fence | null = null;
  const flush = (): void => {
    if (start !== null && end > start) out.push({ start, end });
    start = null;
  };
  for (const line of linesIn(chars, r)) {
    if (fence) {
      if (start === null) start = line.start;
      end = line.end;
      if (isFenceClose(line.text, fence)) fence = null;
      continue;
    }
    const marker = isFenceStart(line.text);
    if (marker) {
      if (start === null) start = line.start;
      end = line.end;
      fence = marker;
      continue;
    }
    if (trimText(line.text).length === 0) {
      flush();
      continue;
    }
    if (start === null) start = line.start;
    end = line.end;
  }
  flush();
  return out.map((p) => trimRange(chars, p)).filter((p) => rangeLength(p) > 0);
}

/**
 * Cut an over-long section at paragraph boundaries. Greedy up to
 * {@link SECTION_MAX_CHARS}; a paragraph that alone exceeds the cap becomes its
 * own section rather than being cut mid-sentence.
 */
function splitLongSection(chars: string[], section: RawSection): RawSection[] {
  if (rangeLength(section) <= SECTION_MAX_CHARS) return [section];
  const paras = paragraphs(chars, section);
  if (paras.length <= 1) return [section];
  const out: RawSection[] = [];
  let start: number | null = null;
  let end = 0;
  const flush = (): void => {
    if (start !== null && end > start) out.push({ start, end, headingPath: section.headingPath });
    start = null;
  };
  for (const p of paras) {
    if (start === null) {
      start = p.start;
      end = p.end;
      continue;
    }
    if (p.end - start > SECTION_MAX_CHARS) {
      flush();
      start = p.start;
      end = p.end;
    } else {
      end = p.end;
    }
  }
  flush();
  return out.length > 0 ? out : [section];
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

interface Atom extends Range {
  kind: "fence" | "table" | "text";
}

/**
 * Break a section body into units that must stay whole: a fenced code block,
 * a table (consecutive lines starting with `|`), or a paragraph.
 */
function atoms(chars: string[], section: Range): Atom[] {
  const lines = linesIn(chars, section);
  const out: Atom[] = [];
  let fence: Fence | null = null;
  let current: Atom | null = null;
  const flush = (): void => {
    if (current) out.push({ ...trimRange(chars, current), kind: current.kind });
    current = null;
  };
  for (const line of lines) {
    const t = line.text.replace(/^\s+/, "");
    if (fence) {
      if (current) current.end = line.end;
      if (isFenceClose(line.text, fence)) {
        fence = null;
        flush();
      }
      continue;
    }
    const fenceMarker = isFenceStart(line.text);
    if (fenceMarker) {
      flush();
      fence = fenceMarker;
      current = { start: line.start, end: line.end, kind: "fence" };
      continue;
    }
    if (t.startsWith("|")) {
      if (!current || current.kind !== "table") {
        flush();
        current = { start: line.start, end: line.end, kind: "table" };
      } else {
        current.end = line.end;
      }
      continue;
    }
    if (t.length === 0) {
      flush();
      continue;
    }
    if (!current || current.kind !== "text") {
      flush();
      current = { start: line.start, end: line.end, kind: "text" };
    } else {
      current.end = line.end;
    }
  }
  if (current) flush();
  return out.filter((a) => rangeLength(a) > 0);
}

/** Split a range into pieces of at most `limit`, at line boundaries. */
function splitByLines(chars: string[], r: Range, limit: number): Range[] {
  const out: Range[] = [];
  const lines = linesIn(chars, r);
  let start: number | null = null;
  let end = 0;
  for (const line of lines) {
    if (start === null) {
      start = line.start;
      end = line.end;
      continue;
    }
    if (line.end - start > limit && end > start) {
      out.push(trimRange(chars, { start, end }));
      start = line.start;
      end = line.end;
    } else {
      end = line.end;
    }
  }
  if (start !== null && end > start) out.push(trimRange(chars, { start, end }));
  // A single overlong line (a minified script, a one-line table) has no line
  // boundary to cut at; the fuse is a code-point slice.
  const sliced: Range[] = [];
  for (const piece of out) {
    if (rangeLength(piece) <= limit) { sliced.push(piece); continue; }
    for (let off = piece.start; off < piece.end; off += limit) {
      sliced.push({ start: off, end: Math.min(piece.end, off + limit) });
    }
  }
  return sliced.filter((p) => rangeLength(p) > 0);
}

/**
 * Split a long run of prose into evenly sized pieces near the block target.
 *
 * Pieces are even, around 400 characters. Cuts land on whitespace within half a
 * piece of the ideal boundary, and fall back to a hard cut for scripts that have
 * no spaces (Chinese).
 */
function splitProse(chars: string[], r: Range): Range[] {
  const len = rangeLength(r);
  if (len <= BLOCK_MAX_CHARS) return [r];
  const pieces = Math.ceil(len / BLOCK_TARGET_CHARS);
  const approx = Math.ceil(len / pieces);
  const window = Math.max(1, Math.floor(approx / 2));
  const out: Range[] = [];
  let start = r.start;
  for (let i = 0; i < pieces - 1 && start < r.end; i++) {
    const ideal = start + approx;
    let cut = ideal;
    for (let j = Math.min(ideal, r.end); j > ideal - window && j > start; j--) {
      if (/\s/.test(chars[j]!)) {
        cut = j;
        break;
      }
    }
    const piece = trimRange(chars, { start, end: cut });
    if (rangeLength(piece) > 0) out.push(piece);
    start = cut;
    while (start < r.end && /\s/.test(chars[start]!)) start++;
  }
  const tail = trimRange(chars, { start, end: r.end });
  if (rangeLength(tail) > BLOCK_MAX_CHARS) out.push(...splitProse(chars, tail));
  else if (rangeLength(tail) > 0) out.push(tail);
  return out;
}

/**
 * Break one atom down to a block-sized piece.
 *
 * A paragraph over the max splits at whitespace. A code fence or table is kept
 * whole until it passes the whole-unit threshold, then split by lines; it is
 * deliberately exempt from the 800-character target because half a code block
 * is not a better answer than a long one.
 */
function splitAtom(chars: string[], atom: Atom): Atom[] {
  const len = rangeLength(atom);
  if (atom.kind === "text") {
    return len <= BLOCK_MAX_CHARS
      ? [atom]
      : splitProse(chars, atom).map((piece) => ({ ...piece, kind: "text" as const }));
  }
  if (len <= WHOLE_UNIT_SPLIT_CHARS) return [atom];
  return splitByLines(chars, atom, WHOLE_UNIT_SPLIT_CHARS).map((piece) => ({ ...piece, kind: atom.kind }));
}

interface PackedBlock extends MarkdownBlock {
  /** A block whose size the hard cap must not touch (code fence / table). */
  whole: boolean;
}

function packAtoms(atomsList: Atom[]): PackedBlock[] {
  const blocks: PackedBlock[] = [];
  let current: PackedBlock | null = null;
  const startBlock = (atom: Atom): PackedBlock => ({ start: atom.start, end: atom.end, whole: false });
  const flush = (): void => {
    if (current) blocks.push(current);
    current = null;
  };
  for (const atom of atomsList) {
    // A whole unit over 800 characters gets its own block: mixing text into
    // it would either move the cap back onto the fence or glue prose onto a
    // code listing.
    if (atom.kind !== "text" && rangeLength(atom) > BLOCK_MAX_CHARS) {
      flush();
      blocks.push({ start: atom.start, end: atom.end, whole: true });
      continue;
    }
    if (!current) {
      current = startBlock(atom);
      continue;
    }
    const currentLen = rangeLength(current);
    const atomLen = rangeLength(atom);
    if (currentLen >= BLOCK_TARGET_CHARS && currentLen + atomLen > BLOCK_MAX_CHARS) {
      flush();
      current = startBlock(atom);
      continue;
    }
    if (currentLen + atomLen <= BLOCK_MAX_CHARS) {
      current.end = atom.end;
      continue;
    }
    if (currentLen >= BLOCK_MIN_CHARS) {
      flush();
      current = startBlock(atom);
      continue;
    }
    // A block shorter than BLOCK_MIN_CHARS plus an atom ≤ BLOCK_MAX_CHARS stays
    // under the 1200 hard cap, so it can always take the atom.
    current.end = atom.end;
  }
  flush();

  // Merge a runt into its predecessor: a short tail is worse than a block a
  // little over the 800 target, as long as it stays under the 1200 hard cap.
  // A whole unit is never merged: its size is the reason it stands alone.
  const merged: PackedBlock[] = [];
  for (const block of blocks) {
    const prev = merged[merged.length - 1];
    if (prev && !prev.whole && !block.whole && rangeLength(block) < BLOCK_MIN_CHARS &&
        rangeLength(prev) + rangeLength(block) <= BLOCK_HARD_CAP_CHARS) {
      prev.end = block.end;
      continue;
    }
    merged.push({ ...block });
  }
  return merged;
}

/** Blocks for one section body: 200–800 target, prose ≤1200, no overlap. */
function sectionBlocks(chars: string[], section: Range): MarkdownBlock[] {
  const pieces: Atom[] = [];
  for (const atom of atoms(chars, section)) pieces.push(...splitAtom(chars, atom));
  const blocks = packAtoms(pieces);
  // No overlap: a later block never starts before the previous one ends.
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i]!.start < blocks[i - 1]!.end) blocks[i]!.start = blocks[i - 1]!.end;
  }
  return blocks.sort((a, b) => a.start - b.start);
}

/**
 * The one convention shared by the keyword index and the embedding input:
 * a block is read under its heading path, one line apart. Index and vectors
 * must agree, so both callers go through this.
 */
export function blockSearchText(headingPath: string, body: string): string {
  return headingPath + "\n" + body;
}

/**
 * Turn a page body into sections and blocks. Offsets count code points, the
 * same unit SQLite's `substr` and `length` use.
 */
export function chunkMarkdown(content: string, pageTitle: string | null): MarkdownSection[] {
  return chunkMarkdownFromChars([...content], pageTitle);
}

/** Same as `chunkMarkdown` when the caller already holds the code-point array. */
export function chunkMarkdownFromChars(chars: string[], pageTitle: string | null): MarkdownSection[] {
  const raw = markdownSections(chars, pageTitle);
  const out: MarkdownSection[] = [];
  for (const section of raw) {
    for (const piece of splitLongSection(chars, section)) {
      const trimmed = trimRange(chars, piece);
      if (rangeLength(trimmed) === 0) continue;
      const blocks = sectionBlocks(chars, trimmed);
      if (blocks.length === 0) continue;
      out.push({ ...trimmed, headingPath: piece.headingPath, blocks });
    }
  }
  return out;
}
