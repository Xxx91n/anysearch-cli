// 操作日志：接入/修复/移除共用一份 journal，落盘在目标同 scope
// 的目录下（项目级 → <项目>/.ans/host-wiring/；用户级 → ~/.ans/host-wiring/）。
// 一行一个 JSON，append-only：一次操作按 planned → partial →
// done 追加多行（同 id），读的时候按 id 取最后一行。它同时干三件事：
//   1. 恢复依据：每个目标文件写前备份（backups/<entry-id>/ 下），原文字节不动；
//   2. 中断诊断：最后一条不是 done → 报哪些文件没写/没验证，repair 能续；
//   3. 冲突基线：每个单元记录「上次我们写入的规范化内容」，用户后来改过就是
//      当前 != 基线 → 保留现场，不盲目套旧备份。

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { ansProjectWiringDir, ansUserWiringDirFor } from "@anysearch-cli/store";

export type HostOp = "connect" | "repair" | "remove";
export type EntryStatus = "planned" | "partial" | "done";

export interface JournalFileRecord {
  /** 目标文件绝对路径。 */
  path: string;
  scope: "project" | "user";
  /** 写前备份的绝对路径（原文件不存在时没有备份）。 */
  backup?: string;
  /** 写前内容 sha256（十六进制，短版）。 */
  beforeHash?: string;
  /** 写后内容 sha256。 */
  afterHash?: string;
  written: boolean;
  verified: boolean;
}

export interface JournalEntry {
  id: string;
  ts: string;
  op: HostOp;
  host: string;
  status: EntryStatus;
  files: JournalFileRecord[];
  /** 每个 unit 上次我们写入的规范化内容（冲突检测基线）。 */
  units?: Record<string, string>;
}

/** journal 与备份的存放根目录。 */
export function wiringRoot(scope: "project" | "user", projectRoot: string, home: string = homedir()): string {
  return scope === "project" ? ansProjectWiringDir(projectRoot) : ansUserWiringDirFor(home);
}

function journalPath(root: string): string {
  return join(root, "journal.jsonl");
}

/** 读全部条目（同 id 取最后一行），坏行跳过并如实返回跳过数。 */
export function readJournal(root: string): { entries: JournalEntry[]; skipped: number } {
  const file = journalPath(root);
  if (!existsSync(file)) return { entries: [], skipped: 0 };
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { entries: [], skipped: 0 };
  }
  const entries = new Map<string, JournalEntry>();
  let skipped = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as JournalEntry;
      entries.set(entry.id, entry);
    } catch {
      skipped++;
    }
  }
  return { entries: [...entries.values()], skipped };
}

/** 追加一行（append-only；写坏一行不影响已有行）。 */
export function appendEntry(root: string, entry: JournalEntry): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(journalPath(root), JSON.stringify(entry) + "\n", { flag: "a" });
}

/** 该宿主最近一条 entry（跨 op 取最新）。 */
export function lastEntryFor(root: string, host: string): JournalEntry | null {
  const { entries } = readJournal(root);
  const ours = entries.filter((e) => e.host === host);
  if (ours.length === 0) return null;
  return ours[ours.length - 1];
}

/**
 * 冲突基线用：该宿主最近一条「带单元记录」的 entry。
 * remove 的 done 行故意不带 units（条目删光了，没有「我们写的内容」可言），
 * 但基线不能跟着清零——不然再接入时全部单元都会被当成「没有我们写过的
 * 记录」报冲突，正常的再次接入被卡死。所以基线从最近一次 connect/repair
 * 的记录里回溯。
 */
export function baselineEntryFor(root: string, host: string): JournalEntry | null {
  const { entries } = readJournal(root);
  const ours = entries.filter((e) => e.host === host && e.units !== undefined && Object.keys(e.units ?? {}).length > 0);
  if (ours.length === 0) return null;
  return ours[ours.length - 1];
}

/** 最后一条没做完的操作（status != done）——中断诊断的依据。 */
export function findInterrupted(root: string, host: string): JournalEntry | null {
  const { entries } = readJournal(root);
  const ours = entries.filter((e) => e.host === host);
  if (ours.length === 0) return null;
  const last = ours[ours.length - 1];
  return last.status !== "done" ? last : null;
}

// ---------------------------------------------------------------------------
// 备份与哈希
// ---------------------------------------------------------------------------

export function shortHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

/**
 * 写前备份：把原文复制到 backups/<entry-id>/<序号-文件名>.bak，原文件一个
 * 字节不动。返回备份绝对路径；原文件不存在 → undefined（新建的文件本来就没有
 * 「写前状态」可恢复）。
 */
export function backupFile(root: string, entryId: string, targetPath: string, original: string): string | undefined {
  const backupDir = join(root, "backups", entryId);
  mkdirSync(backupDir, { recursive: true });
  // 文件名带序号防同目录多文件撞名（.codex/config.toml 之类有目录层）。
  const flat = targetPath.replace(/[\\/:*?"<>|]/g, "_");
  const backupPath = join(backupDir, flat + ".bak");
  mkdirSync(dirname(backupPath), { recursive: true });
  writeFileSync(backupPath, original, "utf8");
  try {
    // 备份里是整份配置（可能带别的工具的密钥）——默认仅当前用户可读写。
    chmodSync(backupPath, 0o600);
  } catch {
    // chmod 不可用的平台不阻断，权限尽量收紧。
  }
  return backupPath;
}
