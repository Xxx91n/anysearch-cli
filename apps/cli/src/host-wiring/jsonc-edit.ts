// JSONC 保留式编辑。
// 只动归属本工具的条目：其他键、其他工具的条目、注释、换行风格原样保留。
// 做法：不整份 parse → stringify（那会抹掉注释和排版）。先用去注释副本做
// JSON.parse 校验，语法过不去就明确失败、一个字节不写；校验通过后在原文上
// 做文本级最小改动——定位目标键/数组元素的准确字符范围，只插入/替换/删除
// 这一段，每步编辑后再校验一次，写坏文件在落盘前就会被拦下。

import { ANS_COMMAND_RE, ANS_ARG_RE } from "./ownership.js";

export interface JsoncEditError {
  /** parse=语法解析失败；shape=结构不符合预期。两者都拒绝动手。 */
  reason: "parse" | "shape";
  message: string;
}

export type JsoncEditResult =
  | { ok: true; text: string }
  | { ok: false; error: JsoncEditError };

/** JSONC 路径：一层一个键或数组下标，如 ["mcpServers", "anysearch"]。 */
export type JsoncPath = (string | number)[];

// ---------------------------------------------------------------------------
// 词法扫描
// ---------------------------------------------------------------------------

/** 从引号扫到闭引号（含），处理转义。 */
function scanStringEnd(text: string, pos: number): number {
  let i = pos + 1;
  while (i < text.length) {
    if (text[i] === "\\") { i += 2; continue; }
    if (text[i] === '"') return i + 1;
    i++;
  }
  return i;
}

/**
 * 从开括号扫到配对的闭括号（含），处理嵌套、字符串、注释。
 * 返回闭括号后的第一个位置。
 */
function scanBracketEnd(text: string, pos: number): number {
  const open = text[pos];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let i = pos;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') { i = scanStringEnd(text, i); continue; }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === open) { depth++; i++; continue; }
    if (ch === close) {
      depth--;
      i++;
      if (depth === 0) return i;
      continue;
    }
    i++;
  }
  return i;
}

/**
 * 从一个「值」的起点（调用方保证停在非空白非逗号非冒号的字符上）扫到该值
 * 结束，返回结束位置（不含尾随空白）。对象/数组/字符串/裸值都覆盖。
 */
function scanValueEnd(text: string, pos: number): number {
  const ch = text[pos];
  if (ch === "{") return scanBracketEnd(text, pos);
  if (ch === "[") return scanBracketEnd(text, pos);
  if (ch === '"') return scanStringEnd(text, pos);
  let i = pos;
  while (i < text.length && text[i] !== "," && text[i] !== "}" && text[i] !== "]") i++;
  return i;
}

/** 跳过空白与注释，返回停下的位置；返回值保证 text[i] 不是被跳过的东西。 */
function skipWsAndComments(text: string, i: number, limit: number): number {
  while (i < limit) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") { i++; continue; }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

/** 去注释副本（字符串字面量里的 // 与 /* 保留），行数保住，用于校验。 */
function stripCommentsForParse(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const end = scanStringEnd(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** 语法校验：JSONC（带注释）解析失败 → 明确失败，绝不猜。空文件/纯注释文件 → 空对象（允许新建根）。 */
export function parseJsonc(text: string): { ok: true; value: unknown } | { ok: false; error: JsoncEditError } {
  const stripped = stripCommentsForParse(text);
  if (stripped.trim() === "") {
    // 没有实际内容（空文件/纯注释）：读一切都不存在，写入时按「新建根」处理。
    return { ok: true, value: undefined };
  }
  try {
    return { ok: true, value: JSON.parse(stripped) };
  } catch (e) {
    return { ok: false, error: { reason: "parse", message: (e as Error).message } };
  }
}

// ---------------------------------------------------------------------------
// 结构扫描：对象成员 / 数组元素的正向收集（注释无论夹在哪都算得准）
// ---------------------------------------------------------------------------

interface MemberSpan {
  keyStart: number;
  keyName: string;
  valueStart: number;
  valueEnd: number;
  /** 该成员前面紧挨的逗号位置（-1 = 没有逗号，即首成员）。 */
  commaBefore: number;
}

/** 正向扫一遍对象 [start, end)（含大括号），收集所有成员。 */
function scanObjectMembers(text: string, start: number, end: number): MemberSpan[] {
  const members: MemberSpan[] = [];
  let i = start + 1;
  let commaBefore = -1;
  for (;;) {
    i = skipWsAndComments(text, i, end);
    if (i >= end || text[i] === "}") return members;
    if (text[i] !== '"') return members; // 键必须是字符串；解析校验已兜底
    const keyStart = i;
    const keyEnd = scanStringEnd(text, i);
    let keyName: string;
    try {
      keyName = JSON.parse(text.slice(keyStart, keyEnd));
    } catch {
      return members;
    }
    // 冒号。
    let j = skipWsAndComments(text, keyEnd, end);
    if (text[j] !== ":") return members;
    j = skipWsAndComments(text, j + 1, end);
    const valueStart = j;
    const valueEnd = scanValueEnd(text, valueStart);
    members.push({ keyStart, keyName, valueStart, valueEnd, commaBefore });
    // 指针走到值尾，下一轮循环开头会消费逗号/注释。
    i = valueEnd;
    const after = skipWsAndComments(text, i, end);
    if (text[after] === ",") {
      commaBefore = after;
      i = after + 1;
    } else {
      commaBefore = -1; // 语义上只对「下一个成员」有意义；重置
    }
  }
}

interface ItemSpan {
  valueStart: number;
  valueEnd: number;
  /** 该元素前面紧挨的逗号位置（-1 = 没有逗号，即首元素）。 */
  commaBefore: number;
}

/** 正向扫一遍数组 [start, end)（含方括号），收集所有元素。 */
function scanArrayItems(text: string, start: number, end: number): ItemSpan[] {
  const items: ItemSpan[] = [];
  let i = start + 1;
  let commaBefore = -1;
  for (;;) {
    i = skipWsAndComments(text, i, end);
    if (i >= end || text[i] === "]") return items;
    const valueStart = i;
    const valueEnd = scanValueEnd(text, valueStart);
    items.push({ valueStart, valueEnd, commaBefore });
    i = valueEnd;
    const after = skipWsAndComments(text, i, end);
    if (text[after] === ",") {
      commaBefore = after;
      i = after + 1;
    } else {
      commaBefore = -1;
    }
  }
}

// ---------------------------------------------------------------------------
// 路径定位
// ---------------------------------------------------------------------------

interface ValueRange {
  valueStart: number;
  valueEnd: number;
}

/**
 * 定位 path 指向的值的字符范围。返回 null = 路径不存在。
 * 抛 shape 错误由调用方包装。
 */
function locateValueRange(text: string, path: JsoncPath): ValueRange | { error: JsoncEditError } | null {
  // 根对象：跳过前导空白/注释后没有实际内容 → 根不存在（空文件/纯注释）。
  let i = skipWsAndComments(text, 0, text.length);
  if (i >= text.length) return null;
  if (text[i] !== "{") {
    return { error: { reason: "shape", message: "root is not a JSON object" } };
  }
  let range: ValueRange = { valueStart: i, valueEnd: scanBracketEnd(text, i) };
  for (const seg of path) {
    const open = text[range.valueStart];
    if (typeof seg === "string") {
      if (open !== "{") {
        return { error: { reason: "shape", message: `parent of "${seg}" is not an object` } };
      }
      const members = scanObjectMembers(text, range.valueStart, range.valueEnd);
      const member = members.find((m) => m.keyName === seg);
      if (!member) return null;
      range = { valueStart: member.valueStart, valueEnd: member.valueEnd };
    } else {
      if (open !== "[") {
        return { error: { reason: "shape", message: `parent of [${seg}] is not an array` } };
      }
      const items = scanArrayItems(text, range.valueStart, range.valueEnd);
      const item = items[seg];
      if (!item) return null;
      range = { valueStart: item.valueStart, valueEnd: item.valueEnd };
    }
  }
  return range;
}

// ---------------------------------------------------------------------------
// 对外：读值
// ---------------------------------------------------------------------------

/** 读 path 指向的值（解析后的结构）。不存在 → undefined；shape 不对 → 失败。 */
export function readJsoncPath(text: string, path: JsoncPath): { ok: true; value?: unknown } | { ok: false; error: JsoncEditError } {
  const parsed = parseJsonc(text);
  if (!parsed.ok) return parsed;
  let cur: unknown = parsed.value;
  if (cur === undefined) return { ok: true, value: undefined }; // 空文件/纯注释
  for (const seg of path) {
    if (typeof seg === "string") {
      if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
        return { ok: false, error: { reason: "shape", message: `parent of "${seg}" is not an object` } };
      }
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      if (!Array.isArray(cur)) {
        return { ok: false, error: { reason: "shape", message: `parent of [${seg}] is not an array` } };
      }
      cur = cur[seg];
    }
    if (cur === undefined) return { ok: true, value: undefined };
  }
  return { ok: true, value: cur };
}

// ---------------------------------------------------------------------------
// 对外：写键（含自动补中间层空容器）
// ---------------------------------------------------------------------------

/**
 * 写入 path = value。path 最后一层必须是键名；中间层不存在时补空对象/空数组
 * （下一层是数组下标就补数组）。目标键已存在 → 只替换值范围；不存在 → 在父
 * 对象里追加成员（缩进继承原文风格）。
 */
export function writeJsoncPath(text: string, path: JsoncPath, value: unknown): JsoncEditResult {
  const parsed = parseJsonc(text);
  if (!parsed.ok) return parsed;
  if (path.length === 0) {
    return { ok: false, error: { reason: "shape", message: "empty path" } };
  }
  const last = path[path.length - 1];
  if (typeof last !== "string") {
    return { ok: false, error: { reason: "shape", message: "writing an array index directly is not supported" } };
  }
  let current = text;
  // 逐层确保中间容器存在且形状正确。
  for (let depth = 0; depth < path.length - 1; depth++) {
    const subPath = path.slice(0, depth + 1);
    const probe = readJsoncPath(current, subPath);
    if (!probe.ok) return probe;
    const wantArray = typeof path[depth + 1] === "number";
    if (probe.value === undefined) {
      const empty: unknown = wantArray ? [] : {};
      const step = setKeyInObject(current, subPath, empty);
      if (typeof step !== "string") return { ok: false, error: step.error };
      current = step;
    } else if (wantArray) {
      if (!Array.isArray(probe.value)) {
        return { ok: false, error: { reason: "shape", message: `"${String(subPath[subPath.length - 1])}" is not an array` } };
      }
    } else {
      if (probe.value === null || typeof probe.value !== "object" || Array.isArray(probe.value)) {
        return { ok: false, error: { reason: "shape", message: `"${String(subPath[subPath.length - 1])}" is not an object` } };
      }
    }
  }
  const out = setKeyInObject(current, path, value);
  if (typeof out !== "string") return { ok: false, error: out.error };
  return guardParse(out);
}

/** 键已存在则替换值；不存在则插入成员。path 全长，最后一段是键名。 */
function setKeyInObject(text: string, path: JsoncPath, value: unknown): string | { error: JsoncEditError } {
  const parentPath = path.slice(0, -1);
  const key = path[path.length - 1] as string;
  const serialized = JSON.stringify(value, null, 2);
  const target = locateValueRange(text, path);
  if (target !== null && "error" in target) return target;
  // 父容器范围。
  const parentRange = locateValueRange(text, parentPath);
  if (parentRange === null) {
    // 根不存在（空文件/纯注释）→ 新建根：保留前缀（注释），追加根对象。
    if (parentPath.length === 0) {
      const prefix = text.replace(/\s+$/, "");
      const guard = parseJsonc(prefix);
      if (!guard.ok) return { error: guard.error };
      return prefix + (prefix ? "\n" : "") + "{\n  " + JSON.stringify(key) + ": " + serialized + "\n}\n";
    }
    return { error: { reason: "shape", message: "parent container not found while writing" } };
  }
  if ("error" in parentRange) {
    return { error: { reason: "shape", message: "parent container not found while writing" } };
  }
  if (target !== null) {
    // 替换值范围。
    return text.slice(0, target.valueStart) + serialized + text.slice(target.valueEnd);
  }
  // 插入成员。
  const members = scanObjectMembers(text, parentRange.valueStart, parentRange.valueEnd);
  const keyJson = JSON.stringify(key);
  const indent = members.length > 0
    ? lineIndentOf(text, members[0].keyStart)
    : detectChildIndent(text, parentRange.valueStart);
  if (members.length === 0) {
    // 空对象但括号里可能有注释（如 { /* 保留 */ }）：在闭括号前插入成员，
    // 括号里的原文字（注释/空白）原样保留。
    const closeIndent = baseIndentOf(text, parentRange.valueStart, indent);
    return text.slice(0, parentRange.valueEnd - 1)
      + indent + keyJson + ": " + serialized + "\n" + closeIndent
      + text.slice(parentRange.valueEnd - 1);
  }
  const last = members[members.length - 1];
  // 尾随逗号？正向扫描已经消费逗号位置——看最后成员值后到 '}' 前有没有逗号。
  const after = skipWsAndComments(text, last.valueEnd, parentRange.valueEnd);
  const hasComma = text[after] === ",";
  const insertAt = hasComma ? after + 1 : last.valueEnd;
  return text.slice(0, insertAt)
    + (hasComma ? "" : ",")
    + "\n" + indent + keyJson + ": " + serialized
    + text.slice(insertAt);
}

// ---------------------------------------------------------------------------
// 对外：数组元素（hooks 数组场景）
// ---------------------------------------------------------------------------

/**
 * 追加一个元素到 path 指向的数组末尾。数组不存在 → 先建空数组再插入。
 * 数组位置是别的类型 → 明确失败（不整份重写）。
 */
export function appendJsoncItem(text: string, path: JsoncPath, value: unknown): JsoncEditResult {
  const parsed = parseJsonc(text);
  if (!parsed.ok) return parsed;
  const serialized = JSON.stringify(value, null, 2);
  const probe = readJsoncPath(text, path);
  if (!probe.ok) return probe;
  if (probe.value === undefined) {
    // 数组不存在：先建（保留式两步——writeJsoncPath 再走一遍插入逻辑）。
    const seeded = writeJsoncPath(text, path, []);
    if (!seeded.ok) return seeded;
    return appendJsoncItem(seeded.text, path, value);
  }
  if (!Array.isArray(probe.value)) {
    return { ok: false, error: { reason: "shape", message: `"${path.join(".")}" is not an array` } };
  }
  const range = locateValueRange(text, path);
  if (range === null || "error" in range) {
    return { ok: false, error: { reason: "shape", message: "array not found while appending" } };
  }
  const items = scanArrayItems(text, range.valueStart, range.valueEnd);
  const indent = items.length > 0
    ? lineIndentOf(text, items[0].valueStart)
    : detectChildIndent(text, range.valueStart);
  if (items.length === 0) {
    // 空数组但括号里可能有注释：在闭括号前插入元素，括号里的原文字保留。
    const closeIndent = baseIndentOf(text, range.valueStart, indent);
    return guardParse(text.slice(0, range.valueEnd - 1)
      + indent + serialized + "\n" + closeIndent
      + text.slice(range.valueEnd - 1));
  }
  const last = items[items.length - 1];
  const after = skipWsAndComments(text, last.valueEnd, range.valueEnd);
  const hasComma = text[after] === ",";
  const insertAt = hasComma ? after + 1 : last.valueEnd;
  return guardParse(text.slice(0, insertAt)
    + (hasComma ? "" : ",")
    + "\n" + indent + serialized
    + text.slice(insertAt));
}

/** 删除 path 数组的第 index 个元素。越界/不存在 → 幂等原样返回。 */
export function removeJsoncItem(text: string, path: JsoncPath, index: number): JsoncEditResult {
  const parsed = parseJsonc(text);
  if (!parsed.ok) return parsed;
  const probe = readJsoncPath(text, path);
  if (!probe.ok) return probe;
  if (probe.value === undefined || probe.value === null) return { ok: true, text };
  if (!Array.isArray(probe.value)) {
    return { ok: false, error: { reason: "shape", message: `"${path.join(".")}" is not an array` } };
  }
  if (index < 0 || index >= probe.value.length) return { ok: true, text };
  const range = locateValueRange(text, path);
  if (range === null || "error" in range) {
    return { ok: false, error: { reason: "shape", message: "array not found while removing" } };
  }
  const items = scanArrayItems(text, range.valueStart, range.valueEnd);
  const item = items[index];
  if (!item) return { ok: true, text };
  let delStart = item.valueStart;
  let delEnd = item.valueEnd;
  if (item.commaBefore >= 0) {
    // 前面有逗号：连逗号一起删（保留上一元素之后的空白开头）。
    delStart = item.commaBefore;
  } else {
    // 首元素：看后面有没有逗号（后面还有成员就一起删）。
    const after = skipWsAndComments(text, delEnd, range.valueEnd);
    if (text[after] === ",") delEnd = after + 1;
  }
  return guardParse(text.slice(0, delStart) + text.slice(delEnd));
}

// ---------------------------------------------------------------------------
// 对外：删键
// ---------------------------------------------------------------------------

/** 删除 path 指向的键（成员整体：键、值、分隔逗号）。不存在 → 幂等原样返回。 */
export function removeJsoncPath(text: string, path: JsoncPath): JsoncEditResult {
  const parsed = parseJsonc(text);
  if (!parsed.ok) return parsed;
  if (path.length === 0) {
    return { ok: false, error: { reason: "shape", message: "empty path" } };
  }
  const last = path[path.length - 1];
  if (typeof last !== "string") {
    return { ok: false, error: { reason: "shape", message: "removing an array index directly is not supported; use removeJsoncItem" } };
  }
  const parentPath = path.slice(0, -1);
  const parentRange = locateValueRange(text, parentPath);
  if (parentRange === null) return { ok: true, text }; // 父都没有 → 幂等
  if ("error" in parentRange) {
    return { ok: false, error: { reason: "shape", message: "parent container not found while removing" } };
  }
  if (text[parentRange.valueStart] !== "{") {
    return { ok: false, error: { reason: "shape", message: "parent is not an object; nothing owned by us to remove" } };
  }
  const members = scanObjectMembers(text, parentRange.valueStart, parentRange.valueEnd);
  const member = members.find((m) => m.keyName === last);
  if (!member) return { ok: true, text }; // 键不存在 → 幂等
  let delStart = member.keyStart;
  let delEnd = member.valueEnd;
  if (member.commaBefore >= 0) {
    // 前面有逗号：连逗号一起删（逗号前的空白保留，交给 JSON 容错）。
    delStart = member.commaBefore;
  } else {
    // 首成员：看后面有没有逗号。
    const after = skipWsAndComments(text, delEnd, parentRange.valueEnd);
    if (text[after] === ",") delEnd = after + 1;
  }
  return guardParse(text.slice(0, delStart) + text.slice(delEnd));
}

// ---------------------------------------------------------------------------
// 归属判定：一个 hooks 条目是不是本工具的
// ---------------------------------------------------------------------------

// 归属信号见 ownership.ts（两个编辑器共用一份，改规则只动那里）。

/**
 * 一个 hooks 条目是否归属本工具。判据（与本仓宿主模板一致）：条目（或其
 * hooks[] 子项）的 command 里认得出我们的 bin；Antigravity 的 args 形式按
 * 内容含 anysearch/ans 判定。键名（mcpServers.anysearch / 顶层 anysearch）
 * 归属由宿主定义直接给出，不走这里。
 */
export function hookEntryIsOurs(entry: unknown): boolean {
  if (entry === null || typeof entry !== "object") return false;
  const record = entry as Record<string, unknown>;
  if (typeof record.command === "string" && ANS_COMMAND_RE.test(record.command)) return true;
  const inner = record.hooks;
  if (Array.isArray(inner)) {
    for (const h of inner) {
      if (h === null || typeof h !== "object") continue;
      const c = (h as Record<string, unknown>).command;
      if (typeof c === "string" && ANS_COMMAND_RE.test(c)) return true;
    }
  }
  const args = record.args;
  if (Array.isArray(args)) {
    for (const a of args) {
      if (typeof a === "string" && ANS_ARG_RE.test(a)) return true;
    }
  }
  return false;
}

/**
 * 找出 path 指向的数组里归属本工具的元素下标列表。
 * 返回 null = 数组不存在（调用方按「没有我们的条目」处理）。
 */
export function findOurItems(text: string, path: JsoncPath): number[] | JsoncEditError | null {
  const probe = readJsoncPath(text, path);
  if (!probe.ok) return probe.error;
  const arr = probe.value;
  if (arr === undefined || arr === null) return null;
  if (!Array.isArray(arr)) {
    return { reason: "shape", message: `"${path.join(".")}" is not an array` };
  }
  const out: number[] = [];
  arr.forEach((item, index) => {
    if (hookEntryIsOurs(item)) out.push(index);
  });
  return out;
}

/**
 * 判定一个钩子条目是否「混合组」：组内 hooks[] 既有我们的命令、也有别人的
 * 命令。这种组删整条会连别人的命令一起删——上层应保留现场报冲突，或只删
 * 匹配的子项（本工具从不往别人组里加，混合组只可能由用户手工编辑产生）。
 */
export function hookEntryIsMixed(entry: unknown): boolean {
  if (entry === null || typeof entry !== "object") return false;
  const record = entry as Record<string, unknown>;
  const inner = record.hooks;
  if (!Array.isArray(inner) || inner.length === 0) return false;
  let ours = 0;
  let theirs = 0;
  for (const h of inner) {
    if (h === null || typeof h !== "object") continue;
    const c = (h as Record<string, unknown>).command;
    if (typeof c === "string" && ANS_COMMAND_RE.test(c)) ours++;
    else theirs++;
  }
  return ours > 0 && theirs > 0;
}

// ---------------------------------------------------------------------------
// 缩进推断小工具
// ---------------------------------------------------------------------------

/** 一个位置所在行的行首缩进。 */
function lineIndentOf(text: string, pos: number): string {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const m = text.slice(lineStart, pos).match(/^[ \t]*/);
  return m ? m[0] : "";
}

/** 空容器展开时子层缩进：开括号后面跟的换行+空白就是现成的答案。 */
function detectChildIndent(text: string, openPos: number): string {
  const rest = text.slice(openPos + 1);
  const m = rest.match(/^[ \t]*\r?\n([ \t]*)/);
  if (m) return m[1];
  // 同行空容器：按开括号行缩进 +2 空格。
  const base = lineIndentOf(text, openPos);
  return base + "  ";
}

/** 闭括号缩进：子缩进去掉一层（2 空格或 1 个 tab）。 */
function baseIndentOf(text: string, openPos: number, childIndent: string): string {
  if (childIndent.endsWith("  ")) return childIndent.slice(0, -2);
  if (childIndent.endsWith("\t")) return childIndent.slice(0, -1);
  const lineStart = text.lastIndexOf("\n", openPos - 1) + 1;
  const m = text.slice(lineStart, openPos).match(/[ \t]*$/);
  return m ? m[0] : "";
}

/** 写后校验：编辑产物必须仍是合法 JSONC，否则拒绝返回。 */
function guardParse(text: string): JsoncEditResult {
  const probe = parseJsonc(text);
  if (!probe.ok) {
    return { ok: false, error: { reason: "parse", message: "edit produced invalid JSON: " + probe.error.message } };
  }
  return { ok: true, text };
}
