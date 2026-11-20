// #311: 升级过程的两份记账，都放在数据根（`~/.ans`）。
//
// 不能放在程序目录：换版就是把程序目录整份换掉，写在里面的记录会跟着旧文件一起
// 消失，正好在最需要它的时候没有。
//
//   - 暂停记录（`.upgrade-pause.json`）：`wait` 记下暂停时的磁盘版本，`finish`
//     拿它比——一样就说明文件根本没换，不能报"升级完成"。
//   - 换版记录（`.upgrade-history.json`）：`finish` 写一份，留最近若干条，
//     `ans upgrade status` 报最新那一条。

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ansUpgradeHistoryPath, ansUpgradePausePath } from "@anysearch-cli/store/paths";
import { atomicRename } from "./fs-atomic";
import type { BuildStamp } from "./build-identity";

/** 历史最多留这么多条：够回答"最近几次换版"，又不会一直长。 */
export const UPGRADE_HISTORY_LIMIT = 20;

/** `ans upgrade wait` 等干净以后写下的那一份。 */
export interface PauseRecord {
  version: 1;
  /** 关掉准入的那一次封门的号。 */
  gateId: string;
  /** 准入是什么时候关的；记录里没写就是 null。 */
  gateOpenedAt: string | null;
  /** 手上的活是什么时候干完的。 */
  drainedAt: string;
  /** 暂停时磁盘上那一份构建——也就是这次要换掉的那一版。 */
  from: BuildStamp;
}

/** 一个还没换版的入口。 */
export interface ReconnectEntry {
  entry: string;
  pid: number;
  /** 这个进程自己记下的构建；没记就是 null。 */
  build: string | null;
  startedAt: string;
}

/** `ans upgrade finish` 写下的一条换版结果。 */
export interface SwitchRecord {
  version: 1;
  at: string;
  from: BuildStamp;
  to: BuildStamp;
  /** 换完还活着的旧版进程：重启或重连才会用上新版。 */
  pendingReconnect: ReconnectEntry[];
  /** 没记下自己跑的是哪一版的进程：新旧都说不清，不能混进上面那一栏。 */
  unknownReconnect: ReconnectEntry[];
}

/** 写一份 JSON 记录：先写临时文件，再原子改名盖上去。 */
function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = path + "." + process.pid + ".tmp";
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    // atomicRename 在 Windows 上被占用时会重试几次（见 fs-atomic）。
    atomicRename(tmp, path);
  } catch (error) {
    try { rmSync(tmp, { force: true }); } catch { /* 尽力清理 */ }
    throw error;
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function isBuildStamp(value: unknown): value is BuildStamp {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.buildId !== null && typeof record.buildId !== "string") return false;
  for (const key of ["version", "commit", "builtAt"]) {
    if (record[key] !== null && typeof record[key] !== "string") return false;
  }
  return true;
}

function isReconnectEntry(value: unknown): value is ReconnectEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.entry === "string" &&
    typeof entry.pid === "number" &&
    typeof entry.startedAt === "string" &&
    (entry.build === null || typeof entry.build === "string");
}

/** 一栏重连清单；形状不对返回 null，让调用方把整条记录当坏的。 */
function readEntries(value: unknown): ReconnectEntry[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  return value.every(isReconnectEntry) ? value : null;
}

/**
 * 读暂停记录。没有、坏了、形状不对，一律当作「没有」：读不出来的最坏结果是让人
 * 重走一遍 `ans upgrade wait`，比让 `ans upgrade status` 跟着挂掉好。
 */
export function readPauseRecord(env: NodeJS.ProcessEnv = process.env): PauseRecord | undefined {
  const parsed = readJson(ansUpgradePausePath(env));
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1) return undefined;
  if (typeof record.gateId !== "string" || typeof record.drainedAt !== "string") return undefined;
  if (!isBuildStamp(record.from)) return undefined;
  return {
    version: 1,
    gateId: record.gateId,
    gateOpenedAt: typeof record.gateOpenedAt === "string" ? record.gateOpenedAt : null,
    drainedAt: record.drainedAt,
    from: record.from,
  };
}

export function writePauseRecord(record: PauseRecord, env: NodeJS.ProcessEnv = process.env): void {
  writeJson(ansUpgradePausePath(env), record);
}

/** 删掉暂停记录。没有这个文件也算成功。 */
export function clearPauseRecord(env: NodeJS.ProcessEnv = process.env): void {
  rmSync(ansUpgradePausePath(env), { force: true });
}

/**
 * 读换版历史，最新的在前。读不出来就是空表——历史丢了不该挡住换版。
 *
 * 逐字段校验：这个文件在 `~/.ans` 里，人能手改，读回来的东西要跟声明的
 * `SwitchRecord` 一致，否则 `status` 会照着半条记录报。
 */
export function readSwitchHistory(env: NodeJS.ProcessEnv = process.env): SwitchRecord[] {
  const parsed = readJson(ansUpgradeHistoryPath(env));
  if (!Array.isArray(parsed)) return [];
  const records: SwitchRecord[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (record.version !== 1 || typeof record.at !== "string") continue;
    if (!isBuildStamp(record.from) || !isBuildStamp(record.to)) continue;
    const pending = readEntries(record.pendingReconnect);
    const unknown = readEntries(record.unknownReconnect);
    if (pending === null || unknown === null) continue;
    records.push({
      version: 1,
      at: record.at,
      from: record.from,
      to: record.to,
      pendingReconnect: pending,
      unknownReconnect: unknown,
    });
  }
  return records;
}

/**
 * 追加一条换版结果，只留最近 {@link UPGRADE_HISTORY_LIMIT} 条。
 *
 * 先读再写不是事务，但只有 `ans upgrade finish` 写这个文件，而 finish 同时持有
 * 准入封门，两个 finish 撞在一起的概率比"记录丢一条"还低。
 */
export function appendSwitchRecord(record: SwitchRecord, env: NodeJS.ProcessEnv = process.env): SwitchRecord[] {
  const history = [record, ...readSwitchHistory(env)].slice(0, UPGRADE_HISTORY_LIMIT);
  writeJson(ansUpgradeHistoryPath(env), history);
  return history;
}
