// TOML 保留式编辑——给 Codex config.toml 这类宿主配置用。
// 只动归属本工具的表段：其他表、注释、换行原样保留。表头扫描自己写状态机
// （正确跳过多行字符串和跨行数组里的 "["），不依赖 smol-toml 的位置信息；
// smol-toml 只做两件事：整份语法校验（失败 → 明确失败、一个字节不写）和
// 段内容解析（判定归属、做规范化比较）。

import { parse as tomlParse } from "smol-toml";
import { ANS_COMMAND_RE } from "./ownership.js";

export interface TomlEditError {
  reason: "parse" | "shape";
  message: string;
}

export type TomlEditResult =
  | { ok: true; text: string }
  | { ok: false; error: TomlEditError };

/** 整份校验：语法过不去 → 明确失败。 */
export function parseTomlSafe(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: TomlEditError } {
  try {
    return { ok: true, value: tomlParse(text) as Record<string, unknown> };
  } catch (e) {
    return { ok: false, error: { reason: "parse", message: (e as Error).message } };
  }
}

// ---------------------------------------------------------------------------
// 表头扫描状态机
// ---------------------------------------------------------------------------

export interface TomlSegment {
  /** 表头行首位置（表头那行的第一个字符，即 "[" 或前置空白？不含前置空白）。 */
  start: number;
  /** 段结束位置（下一个表头行首或文件尾）。 */
  end: number;
  /** 完整表头，不含注释尾，如 "[mcp_servers.anysearch]" / "[[hooks.PreToolUse]]"。 */
  header: string;
  /** 解析出的表名（不带括号），如 "mcp_servers.anysearch"。 */
  name: string;
  isArray: boolean;
  /** 段体（表头行之后到段尾的原文）。 */
  body: string;
}

/** 逐字符扫出所有表头段。正确跳过字符串、多行字符串、跨行数组与注释。 */
export function scanTomlSegments(text: string): TomlSegment[] {
  const segments: TomlSegment[] = [];
  let i = 0;
  const len = text.length;
  while (i < len) {
    // 行首：先看这一行是不是表头。
    let j = i;
    while (j < len && (text[j] === " " || text[j] === "\t")) j++;
    if (j < len && text[j] === "[") {
      // 表头候选：读到行尾；闭括号之后允许跟注释（如 "]] # 备注"）。
      // 做法：从行首扫描括号深度（跳过字符串），回到深度归零的位置，剩下的
      // 若以 # 开头就是行尾注释，整段去掉。表名是 bare/quoted key，不含 #，
      // 所以 # 只可能在括号外。
      let lineEnd = j;
      while (lineEnd < len && text[lineEnd] !== "\n") lineEnd++;
      const rawLine = text.slice(j, lineEnd).trimEnd();
      let line = rawLine;
      let depth = 0;
      let headerEnd = -1;
      for (let k = 0; k < rawLine.length; k++) {
        const ch = rawLine[k];
        if (ch === '"') {
          // quoted key 段：跳过字符串字面量。
          let m = k + 1;
          while (m < rawLine.length && rawLine[m] !== '"') m++;
          k = m;
          continue;
        }
        if (ch === "[") { depth++; continue; }
        if (ch === "]") {
          depth--;
          if (depth === 0) { headerEnd = k + 1; break; }
          continue;
        }
        if (ch === "#") break; // 括号里不会出现 #；提前撞上说明不是表头行
      }
      if (headerEnd > 0) {
        const after = rawLine.slice(headerEnd).trim();
        if (after === "" || after.startsWith("#")) {
          line = rawLine.slice(0, headerEnd);
        } else {
          // 闭括号后跟了别的东西（不是注释）——不是合法表头，按普通行处理。
          line = "";
        }
      }
      const isArray = line.startsWith("[[") && line.endsWith("]]");
      const name = isArray
        ? line.slice(2, -2)
        : line.startsWith("[") && line.endsWith("]")
          ? line.slice(1, -1)
          : null;
      if (name !== null && name.trim() !== "") {
        segments.push({ start: j, end: len, header: line, name: name.trim(), isArray, body: "" });
        i = lineEnd;
        continue;
      }
      // 开头是 "[" 但不是合法表头（比如跨行数组残片落在了行首）——按普通行处理。
    }
    // 行内扫描：字符串/注释/括号深度。
    while (i < len && text[i] !== "\n") {
      const ch = text[i];
      if (ch === "#") { while (i < len && text[i] !== "\n") i++; break; }
      if (ch === '"') {
        // 基本字符串：""" 多行 / " 单行。
        if (text.slice(i, i + 3) === '"""') {
          i += 3;
          while (i < len) {
            if (text[i] === "\\") { i += 2; continue; }
            if (text.slice(i, i + 3) === '"""') { i += 3; break; }
            i++;
          }
        } else {
          i++;
          while (i < len) {
            if (text[i] === "\\") { i += 2; continue; }
            if (text[i] === '"' || text[i] === "\n") { i++; break; }
            i++;
          }
        }
        continue;
      }
      if (ch === "'") {
        // 字面字符串：''' 多行 / ' 单行。
        if (text.slice(i, i + 3) === "'''") {
          i += 3;
          while (i < len) {
            if (text.slice(i, i + 3) === "'''") { i += 3; break; }
            i++;
          }
        } else {
          i++;
          while (i < len) {
            if (text[i] === "'" || text[i] === "\n") { i++; break; }
            i++;
          }
        }
        continue;
      }
      i++;
    }
    if (i < len && text[i] === "\n") i++; // 过换行
  }
  // 段结束位置 = 下一个表头行首。
  for (let k = 0; k < segments.length; k++) {
    segments[k].end = k + 1 < segments.length ? segments[k + 1].start : len;
    segments[k].body = text.slice(segments[k].start, segments[k].end).slice(segments[k].header.length);
  }
  return segments;
}

// ---------------------------------------------------------------------------
// 段级操作
// ---------------------------------------------------------------------------

/** 找到指定名字的命名表段（[name]），没有 → null。 */
function findNamedSegment(segments: TomlSegment[], name: string): TomlSegment | null {
  return segments.find((s) => !s.isArray && s.name === name) ?? null;
}

/** 找到所有 [[name]] 数组表段。 */
function findArraySegments(segments: TomlSegment[], name: string): TomlSegment[] {
  return segments.filter((s) => s.isArray && s.name === name);
}

/**
 * 把段（表头+体）单独 parse 并「下钻到段内容本身」：[[hooks.X]] 段的 parse
 * 结果嵌在 root.hooks.X 数组里，取最后一个元素；[a.b] 命名表逐层下钻。
 * 返回段内容对象（不是 parse 出的根对象）。
 */
function parseSegment(seg: TomlSegment): Record<string, unknown> | null {
  const probe = parseTomlSafe(seg.header + "\n" + seg.body);
  if (!probe.ok) return null;
  let cur: unknown = probe.value;
  const parts = seg.name.split(".");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return null;
    const next = (cur as Record<string, unknown>)[part];
    if (next === undefined) return null;
    if (i === parts.length - 1) {
      // 数组表段：单独 parse 后数组里只有一个元素，就是本段。
      cur = seg.isArray ? (Array.isArray(next) ? next[next.length - 1] ?? null : null) : next;
    } else {
      cur = next;
    }
  }
  if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return null;
  return cur as Record<string, unknown>;
}

/**
 * 写入/替换一个命名表：[name] + values（键值对象）。
 * 表已存在 → 只替换该段；不存在 → 追加到文件尾（保留前面全部内容）。
 * values 序列化成顶格键值行。
 */
export function setTomlNamedTable(text: string, name: string, values: Record<string, unknown>): TomlEditResult {
  const guard = parseTomlSafe(text);
  if (!guard.ok) return guard;
  const segments = scanTomlSegments(text);
  const serialized = serializeTable(name, values, false);
  const existing = findNamedSegment(segments, name);
  if (existing) {
    return guardToml(text.slice(0, existing.start) + serialized + text.slice(existing.end));
  }
  return guardToml(appendSegment(text, serialized));
}

/** 删除命名表 [name] 段。不存在 → 幂等原样返回。 */
export function removeTomlNamedTable(text: string, name: string): TomlEditResult {
  const guard = parseTomlSafe(text);
  if (!guard.ok) return guard;
  const segments = scanTomlSegments(text);
  const existing = findNamedSegment(segments, name);
  if (!existing) return { ok: true, text };
  return guardToml(text.slice(0, existing.start) + text.slice(existing.end));
}

/**
 * 追加一个数组表段 [[name]] + values（幂等由调用方判断——这里是纯追加）。
 */
export function appendTomlArrayTable(text: string, name: string, values: Record<string, unknown>): TomlEditResult {
  const guard = parseTomlSafe(text);
  if (!guard.ok) return guard;
  const serialized = serializeTable(name, values, true);
  return guardToml(appendSegment(text, serialized));
}

/**
 * 删除 [[name]] 数组表里内容与 match 完全相等（规范化比较）的那一段。
 * 没有匹配段 → 幂等原样返回。
 */
export function removeTomlArrayTable(text: string, name: string, match: Record<string, unknown>): TomlEditResult {
  const guard = parseTomlSafe(text);
  if (!guard.ok) return guard;
  const segments = scanTomlSegments(text);
  const target = canonicalJson(match);
  for (const seg of findArraySegments(segments, name)) {
    const parsed = parseSegment(seg);
    if (parsed && canonicalJson(parsed) === target) {
      return guardToml(text.slice(0, seg.start) + text.slice(seg.end));
    }
  }
  return { ok: true, text };
}

/**
 * 找出 [[name]] 数组表里归属本工具的段（段内 hooks[].command 认得出我们的
 * bin）。返回每段的 {start, end, values}；没有 → 空数组。
 * 数组名不存在（没有任何 [[name]] 段）→ null（区别于空数组：键可能压根没有）。
 */
export function findOurArrayTables(
  text: string,
  name: string,
  isOurs: (values: Record<string, unknown>) => boolean,
): Array<{ start: number; end: number; values: Record<string, unknown> }> | TomlEditError | null {
  const guard = parseTomlSafe(text);
  if (!guard.ok) return guard.error;
  const segments = scanTomlSegments(text);
  const arr = findArraySegments(segments, name);
  if (arr.length === 0) return null;
  const out: Array<{ start: number; end: number; values: Record<string, unknown> }> = [];
  for (const seg of arr) {
    const parsed = parseSegment(seg);
    if (parsed === null) continue; // 段体不合法：parseTomlSafe 已拦整份，这里不会走到
    if (isOurs(parsed)) out.push({ start: seg.start, end: seg.end, values: parsed });
  }
  return out;
}

/** 读命名表 [name] 的内容。表不存在 → undefined。 */
export function readTomlNamedTable(text: string, name: string): Record<string, unknown> | undefined | TomlEditError {
  const guard = parseTomlSafe(text);
  if (!guard.ok) return guard.error;
  const segments = scanTomlSegments(text);
  const seg = findNamedSegment(segments, name);
  if (!seg) return undefined;
  const parsed = parseSegment(seg);
  if (parsed === null) return { reason: "shape", message: `segment [${name}] does not parse` };
  return parsed;
}

// ---------------------------------------------------------------------------
// 归属判定（Codex hooks 段用）
// ---------------------------------------------------------------------------

// 归属信号见 ownership.ts（与 jsonc-edit 共用一份，改规则只动那里）。

/** Codex [[hooks.X]] 段的 hooks 数组里认得出我们的 bin → 归属本工具。 */
export function codexHookSegmentIsOurs(values: Record<string, unknown>): boolean {
  const hooks = values["hooks"];
  if (!Array.isArray(hooks)) return false;
  for (const h of hooks) {
    if (h === null || typeof h !== "object") continue;
    const command = (h as Record<string, unknown>).command;
    if (typeof command === "string" && ANS_COMMAND_RE.test(command)) return true;
  }
  return false;
}

/**
 * 判定一段 [[hooks.X]] 是否「混合组」：hooks[] 里既有我们的命令、也有别人的。
 * 这种段删整段会连别人的命令删掉——上层保留现场报冲突。我们从不往别人的段里
 * 加命令，混合段只可能由用户手工编辑产生。
 */
export function codexHookSegmentIsMixed(values: Record<string, unknown>): boolean {
  const hooks = values["hooks"];
  if (!Array.isArray(hooks) || hooks.length === 0) return false;
  let ours = 0;
  let theirs = 0;
  for (const h of hooks) {
    if (h === null || typeof h !== "object") continue;
    const command = (h as Record<string, unknown>).command;
    if (typeof command === "string" && ANS_COMMAND_RE.test(command)) ours++;
    else theirs++;
  }
  return ours > 0 && theirs > 0;
}

// ---------------------------------------------------------------------------
// 序列化与规范化
// ---------------------------------------------------------------------------

/** 键值对象 → TOML 表段文本（表头 + 顶格键值行）。 */
function serializeTable(name: string, values: Record<string, unknown>, isArray: boolean): string {
  const header = isArray ? `[[${name}]]` : `[${name}]`;
  const lines = [header];
  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key} = ${tomlValue(value)}`);
  }
  return lines.join("\n") + "\n";
}

/** 单值 TOML 序列化（字符串/数字/布尔/inline 数组/inline 表）。 */
function tomlValue(value: unknown): string {
  if (typeof value === "string") {
    // 双引号基本字符串，转义反斜杠和引号与控制字符。
    const escaped = value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
    return `"${escaped}"`;
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return "[\n" + value.map((v) => "  " + tomlValue(v) + ",\n").join("") + "]";
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return "{ " + entries.map(([k, v]) => `${k} = ${tomlValue(v)}`).join(", ") + " }";
  }
  return '""';
}

/** 追加段到文件尾：保证一个空行分隔 + 段文本以换行结尾。 */
function appendSegment(text: string, serialized: string): string {
  const trimmed = text.replace(/\s+$/, "");
  if (trimmed === "") return serialized;
  return trimmed + "\n\n" + serialized;
}

/** 规范化比较用：结构 → 稳定 JSON（键排序，忽略排版差异）。 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** 写后校验：产物必须是合法 TOML。 */
function guardToml(text: string): TomlEditResult {
  const probe = parseTomlSafe(text);
  if (!probe.ok) {
    return { ok: false, error: { reason: "parse", message: "edit produced invalid TOML: " + probe.error.message } };
  }
  return { ok: true, text };
}
