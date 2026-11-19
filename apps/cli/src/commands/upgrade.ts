// ans upgrade — 升级预检（#309）。
//
// 这张票只回答一件事：现在能不能换程序。它不换文件、不下载包、不动安装布局
// （那是 #311），也不会假装升级已经完成。
//
// 三件事：
// - `status`：只读。谁还开着活、哪些进程本机确认不了、准入现在是开还是关。
// - `wait`：把新任务准入关掉，等已经接下的活干完。等到上限还有人没干完就报名字、
//   退 1，不假装等到了。
// - `cancel`：放弃这次暂停，把准入重新打开。它不杀任何正在跑的活——用户取消的是
//   「等待」，不是别人的工作。
//
// 准入关着的时候，新的一次付费/干活请求会被直接拒绝（不是排队、不事后重放）；
// 管理类命令（status、doctor、本命令自己）和后置工作照常放行：前者是用来处理升级的，
// 后者是已经接下的请求的尾巴，掐掉就是丢数据。
//
// 进程记录只报不挡：常驻 MCP 服务本来就一直在，拿它的 PID 当"活没干完"会让等待永远
// 等不完；反过来，一个已经死掉的 PID 也不等于它那次任务干完了——这正是本票不把
// PID 或心跳当完成证明的意思。

import { setTimeout as delay } from "node:timers/promises";
import { resolveDbPath } from "@anysearch-cli/kernel";
import {
  AdmissionClosedError,
  ensureOwnerOnlyDb,
  openTaskRegistry,
  snapshotBeforeDestructiveOp,
  TASK_HISTORY_RETENTION_DAYS,
  type TaskRecordRow,
  type TaskRegistry,
  type UpgradeGateState,
} from "@anysearch-cli/store";

/** wait 的默认上限：够长跑完一轮摘要+结算，又不至于让人对着屏幕干等。 */
const DEFAULT_WAIT_MS = 120_000;
const POLL_MS = 250;

const HELP = `Usage: ans upgrade <command> [options]

Commands:
  status              看现在能不能升级：谁还开着活、哪些进程确认不了、准入开没开
  wait                关掉新任务准入，等手上的活干完（默认最多 ${DEFAULT_WAIT_MS / 1000} 秒）
  cancel              放弃这次暂停，把准入重新打开（不杀正在跑的活）
  dismiss <taskId>    记下某条收不了尾的行没人能解决，之后不再算阻塞（必须给理由）
  prune               删掉 ${TASK_HISTORY_RETENTION_DAYS} 天前已收尾的任务行（先做备份；开着的行永远不删）

Options:
  --timeout <ms>      wait 最多等多久（默认 ${DEFAULT_WAIT_MS}）
  --days <n>          prune 的保留天数（默认 ${TASK_HISTORY_RETENTION_DAYS}）
  --dry-run           prune 只报会删几行，不真删
  --reason <text>     dismiss 必填：为什么这条行不再当作阻塞
  --json              机器可读输出
  --db <path>         持久库路径（默认 ANS_DB_PATH 或 ~/.anysearch/anysearch.db）
  --help, -h          显示这段说明

说明：本命令只做预检和等待，不替换程序文件、不下载包、不报告"更新已完成"。
Exit codes: 0 可以继续（收干净了/准入已开） · 1 还有活没干完或准入关着 · 2 用法错误
`;

export interface UpgradeCommandOptions {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** 注入的等待实现（测试用），默认 setTimeout。 */
  sleep?: (ms: number) => Promise<void>;
  /** 注入的时钟（测试用）。 */
  now?: () => number;
}

interface BlockerView {
  taskId: string;
  kind: string;
  entry: string;
  origin: string;
  sessionId: string | null;
  ownerPid: number;
  ownerHost: string;
  /** alive = 本机确认还在跑；dead = 本机确认进程没了但这条行没收尾；unknown = 别的机器 */
  ownerState: "alive" | "dead" | "unknown";
  startedAt: string;
  parentTaskId: string | null;
}

interface ProcessView {
  pid: number;
  entry: string;
  ownerHost: string;
  ownerState: "alive" | "dead" | "unknown";
  startedAt: string;
}

/** 读一份现场快照：门槛、阻塞的活、确认不了的进程、可确认的行。 */
interface Snapshot {
  gate: UpgradeGateState | null;
  blockers: BlockerView[];
  processes: ProcessView[];
}

function toBlocker(row: TaskRecordRow & { ownerState: "alive" | "dead" | "unknown" }): BlockerView {
  return {
    taskId: row.taskId,
    kind: row.kind,
    entry: row.entry,
    origin: row.origin,
    sessionId: row.sessionId,
    ownerPid: row.ownerPid,
    ownerHost: row.ownerHost,
    ownerState: row.ownerState,
    startedAt: row.startedAt,
    parentTaskId: row.parentTaskId,
  };
}

/**
 * Read one snapshot off an OPEN registry.
 *
 * `wait` polls this every POLL_MS, so it takes a registry instead of a path: a
 * new connection per poll would open and close ~480 handles over one 2-minute
 * wait. Callers that only need one reading use `readSnapshot`.
 */
function snapshotOf(registry: TaskRegistry, excludePid?: number): Snapshot {
  return {
    gate: registry.gateState(),
    blockers: registry.blockingTasks().map(toBlocker),
    // 自己这条进程记录不算"说不清的进程"：问问题的人就是它。
    processes: registry.openProcesses()
      .filter((p) => p.pid !== excludePid || p.entry !== "cli")
      .map((p) => ({
        pid: p.pid, entry: p.entry, ownerHost: p.ownerHost,
        ownerState: p.ownerState, startedAt: p.startedAt,
      })),
  };
}

/** One reading, opening and closing its own connection. */
function readSnapshot(dbPath: string, excludePid?: number): Snapshot {
  const registry = openTaskRegistry(dbPath);
  try {
    return snapshotOf(registry, excludePid);
  } finally {
    registry.close();
  }
}

/**
 * Rows an operator may acknowledge. Read only by `status --json`: `wait` polls
 * its own snapshot every 250ms, and this query answers a different question
 * ("what could I give up on?") that no other subcommand asks.
 */
function dismissableOf(dbPath: string): BlockerView[] {
  const registry = openTaskRegistry(dbPath);
  try {
    return registry.dismissableTasks().map(toBlocker);
  } finally {
    registry.close();
  }
}

/**
 * 关掉准入，然后一直等阻塞清空。
 *
 * 复用同一个 registry 连接：轮询每 POLL_MS 一次，按路径重开等于在一段两分钟的
 * 等待里开关几百个句柄。
 *
 * 成功后**不打开**准入：换程序是 #311 的事。在这里自己打开，等于在"可以换"和
 * "换完了"之间留一个谁都能进来的窗口。
 */
async function runWait(
  registry: TaskRegistry,
  opts: {
    out: (text: string) => void;
    err: (text: string) => void;
    json: boolean;
    timeoutMs: number;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
  },
): Promise<number> {
  let gate: UpgradeGateState;
  try {
    gate = registry.openGate({ note: "ans upgrade wait" });
  } catch (e) {
    opts.err("ans upgrade wait: 关不上新任务准入（" + errText(e) + "）——一个关不住的封门不能当升级开始\n");
    return 1;
  }
  if (!opts.json) {
    opts.out("[upgrade] 已经暂停新任务（" + gate.gateId + "）；已经在跑的活不受影响，被拒绝的请求不会排队，也不会事后重放\n");
  }
  const deadline = opts.now() + opts.timeoutMs;
  for (;;) {
    let snap: Snapshot;
    try {
      snap = snapshotOf(registry, process.pid);
    } catch (e) {
      opts.err("ans upgrade wait: 读不了任务登记（" + errText(e) + "）\n");
      return 1;
    }
    if (snap.blockers.length === 0) {
      if (opts.json) {
        opts.out(JSON.stringify({
          admission: "closed", gate, drained: true, blockers: [], processes: snap.processes,
        }, null, 2) + "\n");
      } else {
        opts.out("[upgrade] 手上的活都干完了，可以换程序了\n");
        if (snap.processes.length > 0) {
          opts.out("[upgrade] 这些入口进程还在，换好以后它们要重启或重连才会用新版本（本命令不重启任何进程）：\n");
          for (const p of snap.processes) opts.out("  - " + describeProcess(p) + "\n");
        }
      }
      return 0;
    }
    if (opts.now() >= deadline) {
      if (opts.json) {
        opts.out(JSON.stringify({
          admission: "closed", gate, drained: false, timeoutMs: opts.timeoutMs,
          blockers: snap.blockers, processes: snap.processes,
        }, null, 2) + "\n");
      } else {
        opts.err("[upgrade] 等了 " + opts.timeoutMs + "ms 还有 " + snap.blockers.length + " 件活没干完，没换任何文件：\n");
        for (const b of snap.blockers) opts.err("  - " + describeBlocker(b) + "\n");
        opts.err("[upgrade] 准入还是关着的。处理不了的那几条可以 ans upgrade dismiss <taskId> --reason \"...\"，" +
          "或者 ans upgrade cancel 放弃这次暂停\n");
      }
      return 1;
    }
    await opts.sleep(Math.min(POLL_MS, Math.max(1, deadline - opts.now())));
  }
}

/** 一条阻塞原因说的是「哪件事、从哪进来、本机能不能确认它还在」。 */
function describeBlocker(b: BlockerView): string {
  const owner = b.ownerState === "alive"
    ? "进程还在跑（pid " + b.ownerPid + "）"
    : b.ownerState === "dead"
      ? "进程已不在，行没收尾（pid " + b.ownerPid + "）"
      : "别的机器跑的，本机确认不了（" + b.ownerHost + " pid " + b.ownerPid + "）";
  const origin = b.origin === "follow-up" ? "后置工作" : "本次请求";
  return b.kind + "（" + origin + "，" + b.entry + "，起于 " + b.startedAt + "）：" + owner +
    (b.parentTaskId ? "，属于 " + b.parentTaskId : "");
}

function describeProcess(p: ProcessView): string {
  const state = p.ownerState === "alive"
    ? "还在"
    : p.ownerState === "dead" ? "本机确认已经没了，但没写结束" : "别的机器，确认不了";
  return p.entry + " pid " + p.pid + "（" + p.ownerHost + "，" + state + "，起于 " + p.startedAt + "）";
}

function jsonSnapshot(s: Snapshot, dismissable: BlockerView[]): string {
  return JSON.stringify({
    admission: s.gate ? "closed" : "open",
    gate: s.gate,
    blocked: s.blockers.length > 0,
    blockers: s.blockers,
    // 进程不是阻塞判据，只是"哪些入口还在、哪些确认不了"的说明。
    processes: s.processes,
    dismissable,
  }, null, 2);
}

function parseNumber(raw: string | undefined, fallback: number): number | undefined {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

export async function runUpgrade(args: string[], opts: UpgradeCommandOptions = {}): Promise<number> {
  const out = opts.stdout ?? ((text: string) => process.stdout.write(text));
  const err = opts.stderr ?? ((text: string) => process.stderr.write(text));
  const sleep = opts.sleep ?? ((ms: number) => delay(ms));
  const now = opts.now ?? (() => Date.now());

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    out(HELP);
    return 0;
  }

  const command = args[0]!;
  const rest = args.slice(1);
  const json = rest.includes("--json");
  const positional: string[] = [];
  let dbPath: string | undefined;
  let timeoutRaw: string | undefined;
  let daysRaw: string | undefined;
  let reason: string | undefined;
  let dryRun = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--json") continue;
    if (arg === "--db") { dbPath = rest[++i]; continue; }
    if (arg === "--timeout") { timeoutRaw = rest[++i]; continue; }
    if (arg === "--reason") { reason = rest[++i]; continue; }
    if (arg === "--days") { daysRaw = rest[++i]; continue; }
    if (arg === "--dry-run") { dryRun = true; continue; }
    if (arg.startsWith("--")) {
      err("ans upgrade: 不认识的选项 " + arg + "\n");
      return 2;
    }
    positional.push(arg);
  }
  if (dbPath !== undefined && !dbPath.trim()) { err("ans upgrade: --db 要跟一个路径\n"); return 2; }
  const resolvedDb = dbPath ?? resolveDbPath();

  const timeoutMs = parseNumber(timeoutRaw, DEFAULT_WAIT_MS);
  if (timeoutMs === undefined) {
    err("ans upgrade: --timeout 要一个不小于 0 的毫秒数（收到 " + String(timeoutRaw) + "）\n");
    return 2;
  }

  const retentionDays = daysRaw === undefined ? TASK_HISTORY_RETENTION_DAYS : Number(daysRaw);
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    err("ans upgrade: --days 要一个大于 0 的天数（收到 " + String(daysRaw) + "）\n");
    return 2;
  }

  try {
    ensureOwnerOnlyDb(resolvedDb);
  } catch {
    // 权限收紧失败不该拦住只读诊断；真打不开库会在下面报出来。
  }

  if (command === "status") {
    let snap: Snapshot;
    try {
      snap = readSnapshot(resolvedDb, process.pid);
    } catch (e) {
      err("ans upgrade status: 读不了库 " + resolvedDb + "（" + errText(e) + "）\n");
      return 1;
    }
    if (json) { out(jsonSnapshot(snap, dismissableOf(resolvedDb)) + "\n"); }
    else {
      out("[upgrade] 准入：" + (snap.gate
        ? "关着（" + snap.gate.gateId + "，从 " + snap.gate.openedAt + " 起）"
        : "开着——新任务可以接") + "\n");
      if (snap.blockers.length === 0) {
        out("[upgrade] 没有没干完的活，可以开始升级\n");
      } else {
        out("[upgrade] 还有 " + snap.blockers.length + " 件活没干完，升级要等它们：\n");
        for (const b of snap.blockers) out("  - " + describeBlocker(b) + "\n");
      }
      if (snap.processes.length > 0) {
        out("[upgrade] 还在的入口进程（只说明情况，不当作阻塞）：\n");
        for (const p of snap.processes) out("  - " + describeProcess(p) + "\n");
      }
      const unconfirmed = snap.blockers.filter((b) => b.ownerState !== "alive");
      if (unconfirmed.length > 0) {
        out("[upgrade] 本机确认不了的账 " + unconfirmed.length + " 条，要人决定：" +
          "确认真的没人管了就用 ans upgrade dismiss <taskId> --reason \"...\"\n");
      }
    }
    // 退出码说的是"能不能开始升级"：准入关着也算不能。
    return snap.gate === null && snap.blockers.length === 0 ? 0 : 1;
  }

  if (command === "wait") {
    // One connection for the whole pause: the gate write and every poll share
    // it, so a two-minute wait opens one handle instead of one per 250ms.
    let registry: TaskRegistry;
    try {
      registry = openTaskRegistry(resolvedDb);
    } catch (e) {
      err("ans upgrade wait: 打不开库 " + resolvedDb + "（" + errText(e) + "）\n");
      return 1;
    }
    try {
      return await runWait(registry, { out, err, json, timeoutMs, sleep, now });
    } finally {
      registry.close();
    }
  }

  if (command === "cancel") {
    try {
      const registry = openTaskRegistry(resolvedDb);
      let wasOpen: boolean;
      try {
        wasOpen = registry.closeGate();
      } finally {
        registry.close();
      }
      if (json) {
        out(JSON.stringify({ admission: "open", cancelled: wasOpen }, null, 2) + "\n");
      } else {
        out("[upgrade] " + (wasOpen
          ? "已经打开准入，新任务又能进来了（正在跑的活没被碰）\n"
          : "准入本来就是开的，没有可取消的暂停\n") + "");
      }
      return wasOpen ? 0 : 1;
    } catch (e) {
      err("ans upgrade cancel: 打不开准入（" + errText(e) + "）\n");
      return 1;
    }
  }

  if (command === "dismiss") {
    const taskId = positional[0];
    if (!taskId) { err("ans upgrade dismiss: 要给一个任务号（先 ans upgrade status 看）\n"); return 2; }
    if (positional.length > 1) { err("ans upgrade dismiss: 一次只记一条\n"); return 2; }
    if (!reason || !reason.trim()) {
      err("ans upgrade dismiss: 必须给 --reason，说清为什么这条行没人能解决了\n");
      return 2;
    }
    let registry;
    try {
      registry = openTaskRegistry(resolvedDb);
    } catch (e) {
      err("ans upgrade dismiss: 打不开库 " + resolvedDb + "（" + errText(e) + "）\n");
      return 1;
    }
    try {
      const before = registry.taskById(taskId);
      if (!before) { err("ans upgrade dismiss: 没有这个任务号 " + taskId + "\n"); return 1; }
      const dismissed = registry.dismissTask(taskId, reason);
      if (!dismissed) {
        err("[upgrade] " + taskId + " 没有记下：它可能已经收尾，或者之前就记过了（" +
          (before.endedAt !== null ? "已经有结束时间" : "已经标记过") + "）\n");
        return 1;
      }
      // 记下之后它真的不再挡了——用同一个读法再确认一次，而不是假设。
      const stillBlocking = registry.blockingTasks().some((b) => b.taskId === taskId);
      if (json) {
        out(JSON.stringify({ dismissed: taskId, stillBlocking, reason: reason.trim() }, null, 2) + "\n");
      } else {
        out("[upgrade] 记下了：" + taskId + " 不再算升级阻塞（原因：" + reason.trim() + "）\n");
      }
      return stillBlocking ? 1 : 0;
    } catch (e) {
      err("ans upgrade dismiss: 记不下来（" + errText(e) + "）\n");
      return 1;
    } finally {
      registry.close();
    }
  }

  if (command === "prune") {
    if (positional.length > 0) { err("ans upgrade prune: 不接位置参数\n"); return 2; }
    let registry: TaskRegistry;
    try {
      registry = openTaskRegistry(resolvedDb);
    } catch (e) {
      err("ans upgrade prune: 打不开库 " + resolvedDb + "（" + errText(e) + "）\n");
      return 1;
    }
    try {
      const aged = registry.agedFinishedTasks(retentionDays);
      if (aged.length === 0) {
        if (json) out(JSON.stringify({ pruned: 0, days: retentionDays }, null, 2) + "\n");
        else out("[upgrade] " + retentionDays + " 天前没有已收尾的任务行，没什么可删\n");
        return 0;
      }
      if (dryRun) {
        if (json) {
          out(JSON.stringify({ pruned: 0, wouldPrune: aged.length, days: retentionDays, rows: aged }, null, 2) + "\n");
        } else {
          out("[upgrade] 会删掉 " + aged.length + " 条 " + retentionDays + " 天前收尾的任务行（dry-run，没删）：\n");
          for (const r of aged) out("  - " + r.kind + " 结束于 " + r.endedAt + "\n");
        }
        return 0;
      }
      // Recovery point FIRST: history is about to disappear, and "we deleted
      // it" must always come with a file the operator can inspect. This is the
      // same SQLite `VACUUM INTO` snapshot the migration path uses (one
      // snapshot mechanism, not two), but taken on demand: the migration one
      // deliberately never re-snapshots an already-current database, while a
      // prune must leave a fresh recovery point every time someone deletes data.
      let backup: { backupFile: string };
      try {
        backup = snapshotBeforeDestructiveOp(resolvedDb, "prune");
      } catch (e) {
        err("ans upgrade prune: 建不起恢复存档点，什么都没删（" + errText(e) + "）\n");
        return 1;
      }
      const removed = registry.pruneFinishedTasks(retentionDays);
      if (json) {
        out(JSON.stringify({ pruned: removed, days: retentionDays, backup: backup.backupFile }, null, 2) + "\n");
      } else {
        out("[upgrade] 删掉了 " + removed + " 条 " + retentionDays + " 天前收尾的任务行；" +
          "恢复依据在 " + backup.backupFile + "（连同它的 .json 记录）\n");
        out("[upgrade] 开着的行一条没动——它们是升级阻塞的判据\n");
      }
      return 0;
    } catch (e) {
      err("ans upgrade prune: 删不了（" + errText(e) + "）\n");
      return 1;
    } finally {
      registry.close();
    }
  }

  err("ans upgrade: 不认识 " + command + "。可用的有 status / wait / cancel / dismiss / prune\n");
  return 2;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 拒绝一次因为升级而没能开始的命令时，用同一句人能读懂的话。
 *
 * 单独一个函数，是为了 CLI 的几个入口说同一句话；也让"这是升级挡的"和
 * "这是坏掉了"从措辞上分得开（后者是 [warn] 的 fail-open 路径）。
 */
export function describeAdmissionRefusal(e: AdmissionClosedError): string {
  return "升级中，本次没有开始（" + e.gate.gateId + " 从 " + e.gate.openedAt +
    " 起暂停了新任务）。这不是失败，也不会排队重放：等升级做完再敲一次。\n";
}
