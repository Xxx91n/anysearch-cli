// #311: 升级过程的两份记账。都放在数据根（`~/.ans`），不放在程序目录。
//
// 为什么不在程序目录：换版就是把程序目录整份换掉。写在里面的记录会跟着旧文件
// 一起消失，正好在最需要它的时候没有。数据根不会因为换版被删，所以「从哪一版
// 停的」「换成了哪一版」「哪些入口还没重连」都记在这儿。
//
// 两份记录：
//   - 暂停记录（`.upgrade-pause.json`）：`ans upgrade wait` 等干净之后写一份，
//     记下暂停时的磁盘版本。之后 `ans upgrade finish` 拿它跟现在的磁盘版本比，
//     一样就说明文件根本没换，不能报"升级完成"。
//   - 换版记录（`upgrade-history.json`）：`finish` 写一份，从哪版到哪版、什么时候、
//     哪几个入口还在旧版上。留着最近若干条，用来回答"上周换的那次是什么情况"。
//
// 写文件都是「临时文件 + 改名」：中途断掉只会留下一个临时文件，不会留下半份
// JSON 冒充有效记录。

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ansUpgradeHistoryPath, ansUpgradePausePath } from "@anysearch-cli/store/paths";
import type { BuildStamp } from "./build-identity";

/** 历史最多留这么多条：够回答"最近几次换版"，又不会一直长。 */
export const UPGRADE_HISTORY_LIMIT = 20;

/** `ans upgrade wait` 等干净以后写下的那一份。 */
export interface PauseRecord {
  version: 1;
  /** 关掉准入的那一次封门的号。 */
  gateId: string;
  /** 准入是什么时候关的。 */
  gateOpenedAt: string;
  /** 手上的活是什么时候干完的。 */
  drainedAt: string;
  /** 暂停时磁盘上那一份构建——也就是这次要换掉的那一版。 */
  from: BuildStamp;
}

/** 一个还没换版的入口。 */
export interface ReconnectEntry {
  entry: string;
  pid: number;
  /** 这个进程自己记下的构建；旧版本没记就是 null。 */
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
}

/**
 * 写一份 JSON 记录：先写临时文件，再改名盖上去。
 *
 * 临时文件带 pid，两个进程同时写也不会互相踩；改名是原子的，所以读者要么看到
 * 上一份完整的，要么看到这一份完整的，不会看到写了一半的。
 */
function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = path + "." + process.pid + ".tmp";
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, path);
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
  return typeof record.buildId === "string";
}

/**
 * 读暂停记录。没有、坏了、形状不对，一律当作「没有」。
 *
 * 不抛错是有意的：这个文件是辅助记录，读不出来时最坏的结果是让人重走一遍
 * `ans upgrade wait`，而不是让 `ans upgrade status` 直接挂掉。
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
    gateOpenedAt: typeof record.gateOpenedAt === "string" ? record.gateOpenedAt : "不知道",
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

/** 读换版历史，最新的在前。读不出来就是空表——历史丢了不该挡住换版。 */
export function readSwitchHistory(env: NodeJS.ProcessEnv = process.env): SwitchRecord[] {
  const parsed = readJson(ansUpgradeHistoryPath(env));
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is SwitchRecord =>
    typeof item === "object" && item !== null &&
    (item as Record<string, unknown>).version === 1 &&
    isBuildStamp((item as Record<string, unknown>).from) &&
    isBuildStamp((item as Record<string, unknown>).to));
}

/**
 * 追加一条换版结果，只留最近 {@link UPGRADE_HISTORY_LIMIT} 条。
 *
 * 先读再写不是事务，但只有 `ans upgrade finish` 会写这个文件，而 finish 同时
 * 还持有准入封门——两个 finish 撞在一起的概率比"记录丢一条"还低，不值得为此
 * 加一套锁。
 */
export function appendSwitchRecord(record: SwitchRecord, env: NodeJS.ProcessEnv = process.env): SwitchRecord[] {
  const history = [record, ...readSwitchHistory(env)].slice(0, UPGRADE_HISTORY_LIMIT);
  writeJson(ansUpgradeHistoryPath(env), history);
  return history;
}
