// ans upgrade — 一次正常升级的全部步骤（#309 预检/等待 + #311 换版核对）。
//
// 本命令不换自己的程序文件：不下载、不安装、不重启任何进程。换文件用什么工具由
// 用户定（npm、pnpm、内部制品库都行），本命令负责的是它前后那两件事——换之前
// 确认没有人还在用旧代码干活，换之后确认磁盘上真的换了版本、谁还得重连。
//
// 唯一的例外是 `ans upgrade install`：它会在预览之后卸掉旧布局里那几个独立的
// 全局包（不是本产品自己的文件，是它要取代的旧包）。默认只预览，删之前先写恢复
// 记录，认不出归属的一个都不动。
//
// Design: 两个"版本"分开报 — 磁盘版本回答"下次启动会用哪一份代码"，执行版本回答
// "这个进程现在跑的是哪一份"。常驻 MCP 服务能活过整场升级，只报磁盘版本等于把
// "装好了"说成"已经在跑新版"。status 两边都报，不一样的入口列成待重连。
//
// 准入关着时，新的付费/干活请求被直接拒绝，不排队也不事后重放。管理类命令
// （status、doctor、本命令）和已接请求的后置工作照常放行：前者用来处理升级，
// 后者是别人干到一半的活，掐掉就是丢数据。
//
// 进程记录只报不挡。常驻 MCP 服务一直在，拿它的 PID 当"活没干完"会让等待永远等
// 不完；反过来，一个死掉的 PID 也不证明那次任务干完了。

import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { resolveDbPath } from "@anysearch-cli/kernel";
import {
  AdmissionClosedError,
  ansUpgradeHistoryPath,
  ansUpgradePausePath,
  ensureOwnerOnlyDb,
  openTaskRegistry,
  readAnsLayoutRecord,
  snapshotBeforeDestructiveOp,
  HISTORY_RETENTION_DAYS,
  type ProcessPrunePlan,
  type ProcessPruneReason,
  type ProcessRecordRow,
  type TaskRecordRow,
  type TaskRegistry,
  type UpgradeGateState,
} from "@anysearch-cli/store";
import {
  describeBuildId,
  describeIdentity,
  describeSource,
  installedProduct,
  stampOf,
  type ProductIdentity,
} from "../build-identity";
import {
  appendSwitchRecord,
  clearPauseRecord,
  readPauseRecord,
  readSwitchHistory,
  writePauseRecord,
  type PauseRecord,
  type ReconnectEntry,
  type SwitchRecord,
} from "../upgrade-record";
import { runUpgradeInstall } from "./upgrade-install";

/** wait 的默认上限：够长跑完一轮摘要+结算，又不至于让人对着屏幕干等。 */
const DEFAULT_WAIT_MS = 120_000;
const POLL_MS = 250;

const HELP = `Usage: ans upgrade <command> [options]

升级按这个顺序走，每一步都能单独看结果：

  status              现在是什么状况：谁还开着活、准入开没开、装的是哪一版、谁还在旧版上
  wait                关掉新任务准入，等手上的活干完（默认最多 ${DEFAULT_WAIT_MS / 1000} 秒）
  install             看全局安装是不是旧的多包布局，给出换法（--apply 才动手）
  finish              文件换完了：核对真的换了版本，重新打开准入，记下哪几个入口要重连
  cancel              放弃这次暂停，把准入重新打开（不杀正在跑的活）
  dismiss <taskId>    记下某条收不了尾的行没人能解决，之后不再算阻塞（必须给理由）
  prune               清掉 ${HISTORY_RETENTION_DAYS} 天前收尾的行（任务历史 + 进程登记；真删前先备份）
                      开着的任务行永远不删；开着的进程行只清「本机确认进程已不在且过了窗口」的那种

换文件这一步不归本命令：它不替换程序文件、不下载、不安装、不重启任何进程。
用什么装（npm、pnpm、内部制品库）由你决定，装完再跑 finish 核对。
（ans upgrade install 子命令是例外：它会在预览之后卸掉旧布局的独立全局包。）

Options:
  --timeout <ms>      wait 最多等多久（默认 ${DEFAULT_WAIT_MS}）
  --days <n>          prune 的保留天数（默认 ${HISTORY_RETENTION_DAYS}）
  --dry-run           prune 只报会删几行，不真删
  --reason <text>     dismiss 必填：为什么这条行不再当作阻塞
  --prefix <dir>      install 用：npm 全局前缀（默认问 npm）
  --apply             install 用：真的执行方案
  --json              机器可读输出
  --db <path>         持久库路径（默认 ANS_DB_PATH，否则 ~/.ans/anysearch.db；
                      旧布局的库还在时会沿用那个位置）
  --help, -h          显示这段说明

说明：新命令用不了的时候（旧包的 ans 还占着名字），迁移入口可以照路径直接跑：
  node "$(npm root -g)/@anysearch-cli/cli/dist/migrate-install.js"
Exit codes: 0 可以继续（收干净了/换版核对通过/准入已开） · 1 还有活没干完、准入关着、
文件没换、或者有认不出归属的东西 · 2 用法错误
`;

export interface UpgradeCommandOptions {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** 注入的等待实现（测试用），默认 setTimeout。 */
  sleep?: (ms: number) => Promise<void>;
  /** 注入的时钟（测试用）。 */
  now?: () => number;
  /**
   * 注入的"本进程是哪一版"（测试用）。
   *
   * 默认读自己包根下的 build-info.json。测试要模拟"文件换了"这件事，就必须
   * 能换掉这个读数——真去改包根是做不到的，也不该做到。
   */
  identity?: () => ProductIdentity;
  /** 注入的环境变量（测试用），迁移命令拿它算 npm 前缀和用户根。 */
  env?: NodeJS.ProcessEnv;
  /** 注入的命令执行器（测试用），迁移命令靠它卸旧包。 */
  run?: (command: string, args: string[]) => { status: number | null; stdout: string; stderr: string };
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
  /** 这个进程自己记下的构建；旧版本没记就是 null。 */
  build: string | null;
  startedAt: string;
}

/** 读一份现场快照：门槛、阻塞的活、确认不了的进程、可确认的行。 */
interface Snapshot {
  gate: UpgradeGateState | null;
  /** Whether the process that closed admission is still running. */
  gateOwnerState: "alive" | "dead" | "unknown" | null;
  blockers: BlockerView[];
  processes: ProcessView[];
  /** Only filled when the caller asks for it (status --json). */
  dismissable?: BlockerView[];
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
function snapshotOf(registry: TaskRegistry, excludePid?: number, withDismissable = false): Snapshot {
  // 一次读事务里取全：单条语句各自一致，但彼此不一致——中间刚好有一条活收尾，
  // blockers 和 dismissable 就会互相打架。
  return registry.consistentRead(() => {
    const gate = registry.gateOwnerState();
    return {
      gate: gate?.gate ?? null,
      gateOwnerState: gate?.ownerState ?? null,
      blockers: registry.blockingTasks().map(toBlocker),
      // 自己这条进程记录不算"说不清的进程"：问问题的人就是它。
      processes: registry.openProcesses()
        .filter((p) => p.pid !== excludePid || p.entry !== "cli")
        .map((p) => ({
          pid: p.pid, entry: p.entry, ownerHost: p.ownerHost,
          ownerState: p.ownerState, build: p.build, startedAt: p.startedAt,
        })),
      ...(withDismissable ? { dismissable: registry.dismissableTasks().map(toBlocker) } : {}),
    };
  });
}

/** One reading, opening and closing its own connection. */
function readSnapshot(dbPath: string, excludePid?: number, withDismissable = false): Snapshot {
  const registry = openTaskRegistry(dbPath);
  try {
    return snapshotOf(registry, excludePid, withDismissable);
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
 *
 * 成功后写一份暂停记录，记下"等干净的时候磁盘上是哪一版"。`ans upgrade finish`
 * 靠它判断文件到底换没换——没有这个基准，finish 只能靠猜。
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
    identity: ProductIdentity;
    env: NodeJS.ProcessEnv;
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
      // 暂停记录先写、再报成功：写完才说"可以换了"，否则一次崩在写盘上的
      // wait 会留下一个没人能收尾的封门。
      try {
        writePauseRecord({
          version: 1,
          gateId: gate.gateId,
          gateOpenedAt: gate.openedAt,
          drainedAt: new Date(opts.now()).toISOString(),
          from: stampOf(opts.identity),
        }, opts.env);
      } catch (e) {
        opts.err("ans upgrade wait: 手上的活干完了，但暂停记录写不进去（" + errText(e) + "）。" +
          "没有这份基准，ans upgrade finish 核对不了换没换版本；准入还关着，可以 ans upgrade cancel 打开\n");
        return 1;
      }
      if (opts.json) {
        opts.out(JSON.stringify({
          admission: "closed", gate, drained: true, blockers: [], processes: snap.processes,
          pausedFrom: opts.identity.buildId,
        }, null, 2) + "\n");
      } else {
        opts.out("[upgrade] 手上的活都干完了，可以换程序了（记下当时磁盘上是 " +
          describeBuildId(opts.identity.buildId) + "）\n");
        opts.out("[upgrade] 下一步：换文件（本命令不下载、不安装），装完跑 ans upgrade finish 核对版本并打开准入\n");
        if (snap.processes.length > 0) {
          const { present, gone } = splitProcesses(snap.processes);
          if (present.length > 0) {
            opts.out("[upgrade] 这些入口进程还在，换好以后它们要重启或重连才会用新版本（本命令不重启任何进程）：\n");
            for (const p of present) opts.out("  - " + describeProcess(p) + "\n");
          }
          // #343: 已经不在的那些不是重连对象，只报一行；要清走由 ans upgrade prune 决定。
          if (gone.length > 0) {
            opts.out("[upgrade] 另有 " + gone.length + " 条入口进程本机已经确认不在了，不在此列" +
              "（要清就跑 ans upgrade prune，过窗口的会删；明细看 --json）\n");
          }
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

/** 一个本机还能说点什么的入口：还活着，或者别的机器上确认不了。 */
type LiveProcess = ProcessView & { ownerState: "alive" | "unknown" };

const isLive = (p: ProcessView): p is LiveProcess => p.ownerState !== "dead";

function describeProcess(p: LiveProcess): string {
  const state = p.ownerState === "alive" ? "还在" : "别的机器，确认不了";
  return p.entry + " pid " + p.pid + "（" + p.ownerHost + "，" + state + "，跑的是 " +
    (p.build ?? "没记是哪一版") + "，起于 " + p.startedAt + "）";
}

/** 本机确认已经不在了的行只报总数，明细在 `--json`。 */
function splitProcesses(processes: ProcessView[]): { present: LiveProcess[]; gone: ProcessView[] } {
  return {
    present: processes.filter(isLive),
    gone: processes.filter((p) => !isLive(p)),
  };
}

/** 一条准备删掉的进程登记，说清它凭什么可删。 */
function describeProcessDelete(entry: { row: ProcessRecordRow; reason: ProcessPruneReason }): string {
  const row = entry.row;
  return row.entry + " pid " + row.pid + "（" +
    (entry.reason === "closed-aged"
      ? "已收尾于 " + (row.endedAt ?? "?")
      : "开着，本机确认这个进程已经不在了，起于 " + row.startedAt) + "）";
}

/** 进程登记留下的那些，一句话说清为什么留。 */
function reportKeptProcesses(out: (text: string) => void, plan: ProcessPrunePlan): void {
  const why: string[] = [];
  if (plan.withinWindow > 0) why.push(plan.withinWindow + " 条还没到保留窗口");
  if (plan.pidInUse > 0) why.push(plan.pidInUse + " 条本机这个进程号还被占着（可能被别的进程复用了）");
  if (plan.otherHost > 0) why.push(plan.otherHost + " 条是别的机器记的，本机确认不了");
  if (why.length === 0) return;
  out("[upgrade] 进程登记还留着：" + why.join("；") + "\n");
}

/**
 * prune 的 `--json` 只有一种形状：dry-run、真跑、本来就干净，三种都带同一组字段。
 * 任务那几栏沿用原来的字段名（脚本已经在读），不顺手改别人的接口。
 *
 * `wouldPrune` / `wouldHold` 说的是「这份计划打算怎么处理」（dry-run 与真跑同一份），
 * `pruned` / `heldByChildren` 说的是「实际发生了什么」。两个数不等，就说明中间有人动过
 * 库——这正是对账时要看的。
 */
function pruneJson(v: {
  days: number;
  dryRun: boolean;
  backup: string | null;
  taskPruned: number;
  taskWouldPrune: Array<{ taskId: string; kind: string; endedAt: string }>;
  /** 计划：过期却要留的任务行（预览算出来的）。 */
  taskWouldHold: number;
  /** 结果：真跑删完之后还留着的那些。dry-run 里与计划同值，没删当然一样。 */
  taskHeld: number;
  plan: ProcessPrunePlan;
  processRemoved: { removed: number; closed: number; openGone: number };
}): string {
  return JSON.stringify({
    days: v.days,
    dryRun: v.dryRun,
    pruned: v.taskPruned,
    wouldPrune: v.taskWouldPrune.length,
    wouldHold: v.taskWouldHold,
    heldByChildren: v.taskHeld,
    rows: v.taskWouldPrune,
    backup: v.backup,
    processes: {
      wouldDelete: v.plan.deletable.length,
      deleted: v.processRemoved.removed,
      deletedClosed: v.processRemoved.closed,
      deletedOpenGone: v.processRemoved.openGone,
      withinWindow: v.plan.withinWindow,
      pidInUse: v.plan.pidInUse,
      otherHost: v.plan.otherHost,
      rows: v.plan.deletable.map((d) => ({
        id: d.row.id,
        pid: d.row.pid,
        entry: d.row.entry,
        startedAt: d.row.startedAt,
        endedAt: d.row.endedAt,
        reason: d.reason,
      })),
    },
  }, null, 2) + "\n";
}

/**
 * 一个入口相对磁盘版本是什么状态。
 *
 * 三态而不是布尔：`current` 跑的就是这一版，`stale` 记下的构建不一样（要重连），
 * `unknown` 判断不了——它自己没记，或者磁盘上这一份都没打标。文字报告和 `--json`
 * 都从这一个判断走，两边不会各算一套再漂移。
 */
type ProcessFreshness = "current" | "stale" | "unknown";

function freshnessOf(process: ProcessView, installedBuildId: string | null): ProcessFreshness {
  // 磁盘这一份没打标就没有"当前版本"可对，谁的判断都给不出来。
  if (installedBuildId === null || process.build === null) return "unknown";
  return process.build === installedBuildId ? "current" : "stale";
}

/**
 * 「这次暂停还能不能收尾」以及不能时该怎么走，一句话说完。
 *
 * `status` 和 `finish` 共用这一份。两边各写一遍，就会出现一边说可以收尾、另一边
 * 一跑就拒，或者劝人走一条注定被拒的路——磁盘这份没打标时重跑 `wait` 写下的还是
 * null，装完再跑 `wait` 写下的又正好是刚装的那一版，`finish` 只会再说一次"文件
 * 没换"，两趟都白跑。
 *
 * 句子自带「当时 / 现在」两侧的事实，调用方只报时间、封门号和这一句，不再另拼
 * 一遍，否则同一件事会说两遍。
 *
 * Design: 磁盘版本和暂停记录一样时拒绝收尾、准入继续关着 — 另一种做法是照常打开
 * 准入并提示"好像没换"，但那等于用一句提示换掉唯一能拦住"报了个假升级"的判据。
 * 没换就没有可核对的换版，宁可让人再跑一次 finish（或明确 cancel）。
 */
function pauseOutcome(
  pause: PauseRecord,
  identity: ProductIdentity,
): { canFinish: boolean; text: string } {
  const before = describeBuildId(pause.from.buildId);
  const now = describeBuildId(identity.buildId);
  const cancel = "；要放弃这次暂停就用 ans upgrade cancel";
  if (identity.buildId === null && pause.from.buildId === null) {
    return {
      canFinish: false,
      text: "当时和现在这两份都没打标，这次暂停补不出基准：要收尾就用 ans upgrade cancel；" +
        "想留一条换版记录，得先把一个打过标的旧版本装回来、重跑 ans upgrade wait 拿它当基准，再换到新版、跑 finish",
    };
  }
  if (identity.buildId === null) {
    return {
      canFinish: false,
      text: "当时磁盘上是 " + before + "，现在磁盘上这份没打标：装一个正式发出来的版本再跑 ans upgrade finish" + cancel,
    };
  }
  if (pause.from.buildId === null) {
    return {
      canFinish: false,
      text: "当时磁盘上那份没打标，现在磁盘上是 " + now + "——没有可核对的基准：" +
        "重跑一次 ans upgrade wait 拿现在这份当基准、再换一次文件，finish 才核得上" + cancel,
    };
  }
  if (pause.from.buildId === identity.buildId) {
    return {
      canFinish: false,
      text: "当时磁盘上是 " + before + "，现在还是这一版：文件没换，装完新版本再跑一次 ans upgrade finish" + cancel,
    };
  }
  return {
    canFinish: true,
    text: "当时磁盘上是 " + before + "，现在磁盘上是 " + now + "：文件换了，可以 ans upgrade finish 收尾",
  };
}

/**
 * 谁还在旧版上：记下的构建和磁盘上那一份不一样，就是"文件换了它没换"。
 *
 * 判断不了的行（自己没记构建、或磁盘这份没打标）单独归一类，不塞进"旧版"里。
 *
 * 本机确认已经没了的行两边都不进：它没在跑，说它"还要重连"是假话。入口清单里它们
 * 折成一行汇总（#343），逐条明细只在 --json 里。
 */
function reconnectOf(
  processes: ProcessView[],
  installedBuildId: string | null,
): { pending: ReconnectEntry[]; unknown: ReconnectEntry[] } {
  const pending: ReconnectEntry[] = [];
  const unknown: ReconnectEntry[] = [];
  for (const process of processes) {
    // 本机确认进程已经没了的行：它没在跑，不进重连清单。这一条和"没记版本"
    // 是两回事——后者可能正在跑，前者确定没跑。
    if (process.ownerState === "dead") continue;
    const entry: ReconnectEntry = {
      entry: process.entry,
      pid: process.pid,
      build: process.build,
      startedAt: process.startedAt,
    };
    const freshness = freshnessOf(process, installedBuildId);
    if (freshness === "unknown") unknown.push(entry);
    else if (freshness === "stale") pending.push(entry);
  }
  return { pending, unknown };
}

/**
 * 一份快照加上版本那几栏，拼成 `status --json`。
 *
 * 进程那一段带 `stale`：true / false / null（判断不了），见 `freshnessOf`。
 */
function jsonSnapshot(
  s: Snapshot,
  extra: {
    installed: ProductIdentity;
    reconnect: { pending: ReconnectEntry[]; unknown: ReconnectEntry[] };
    pause: ReturnType<typeof readPauseRecord>;
    history: SwitchRecord[];
  },
): string {
  return JSON.stringify({
    admission: s.gate ? "closed" : "open",
    gate: s.gate,
    gateOwnerState: s.gateOwnerState,
    blocked: s.blockers.length > 0,
    blockers: s.blockers,
    // 进程不是阻塞判据，只是"哪些入口还在、哪些确认不了"的说明。
    processes: s.processes.map((p) => ({
      ...p,
      // 和文字报告共用 freshnessOf，两边不会各算一套。
      stale: ((): boolean | null => {
        const freshness = freshnessOf(p, extra.installed.buildId);
        return freshness === "unknown" ? null : freshness === "stale";
      })(),
    })),
    dismissable: s.dismissable ?? [],
    program: {
      installed: {
        buildId: extra.installed.buildId,
        version: extra.installed.info?.version ?? null,
        commit: extra.installed.info?.commit ?? null,
        builtAt: extra.installed.info?.builtAt ?? null,
        dirty: extra.installed.info?.dirty ?? null,
        packageName: extra.installed.packageName,
        packageRoot: extra.installed.packageRoot,
        source: extra.installed.source,
      },
      reconnect: extra.reconnect,
    },
    history: extra.history,
    pause: extra.pause ?? null,
  }, null, 2);
}

/** 本进程认的"磁盘上是哪一版"；测试可以换掉。 */
function identityOf(opts: UpgradeCommandOptions): ProductIdentity {
  return (opts.identity ?? installedProduct)();
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
  const env = opts.env ?? process.env;

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    out(HELP);
    return 0;
  }

  const command = args[0]!;
  const rest = args.slice(1);
  // `install` 有自己的选项（--prefix/--apply），在通用解析之前分出去。
  // 放后面的话 `--apply` 会被当成"不认识的选项"直接退 2——一个只在真用的时候
  // 才发现的错。
  if (command === "install") {
    return runUpgradeInstall(rest, {
      stdout: out,
      stderr: err,
      env,
      ...(opts.run ? { run: opts.run } : {}),
    });
  }
  const json = rest.includes("--json");
  const positional: string[] = [];
  let dbPath: string | undefined;
  let timeoutRaw: string | undefined;
  let daysRaw: string | undefined;
  let reason: string | undefined;
  let dryRun = false;
  // 取值型选项：后面那个必须是个值。少写一个值就悄悄回落成默认库/默认超时，
  // 是会看错库、等错时间的那种安静错误；`--db --json` 更不能把下一个选项当路径。
  let at = 0;
  const takeValue = (name: string): string | null => {
    const next = rest[at + 1];
    if (next === undefined || next.startsWith("--")) {
      err("ans upgrade: " + name + " 后面要跟一个值\n");
      return null;
    }
    at += 1;
    return next;
  };
  for (; at < rest.length; at++) {
    const arg = rest[at]!;
    if (arg === "--json") continue;
    if (arg === "--dry-run") { dryRun = true; continue; }
    if (arg === "--db" || arg === "--timeout" || arg === "--reason" || arg === "--days") {
      const value = takeValue(arg);
      if (value === null) return 2;
      if (arg === "--db") dbPath = value;
      else if (arg === "--timeout") timeoutRaw = value;
      else if (arg === "--reason") reason = value;
      else daysRaw = value;
      continue;
    }
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

  const retentionDays = daysRaw === undefined ? HISTORY_RETENTION_DAYS : Number(daysRaw);
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
      snap = readSnapshot(resolvedDb, process.pid, json);
    } catch (e) {
      err("ans upgrade status: 读不了库 " + resolvedDb + "（" + errText(e) + "）\n");
      return 1;
    }
    const identity = identityOf(opts);
    const reconnect = reconnectOf(snap.processes, identity.buildId);
    const pause = readPauseRecord(env);
    const history = readSwitchHistory(env);
    if (json) {
      out(jsonSnapshot(snap, { installed: identity, reconnect, pause, history }) + "\n");
    }
    else {
      out("[upgrade] 准入：" + (snap.gate
        ? "关着（" + snap.gate.gateId + "，从 " + snap.gate.openedAt + " 起）"
        : "开着——新任务可以接") + "\n");
      // 开门的那个人已经不在了，是最常见的"门关着但没人升级"：被 Ctrl-C 打断的
      // wait、关掉的终端。不替人做决定，但必须把出路点出来，否则每条业务命令都退 4。
      if (snap.gate && snap.gateOwnerState === "dead") {
        out("[upgrade] 注意：关掉准入的那个进程（pid " + snap.gate.openedByPid + "）已经不在了，" +
          "现在没有升级在跑。要么 ans upgrade wait 接管，要么 ans upgrade cancel 直接打开准入\n");
      }
      if (snap.blockers.length === 0) {
        out("[upgrade] 没有没干完的活，可以开始升级\n");
      } else {
        out("[upgrade] 还有 " + snap.blockers.length + " 件活没干完，升级要等它们：\n");
        for (const b of snap.blockers) out("  - " + describeBlocker(b) + "\n");
      }
      if (snap.processes.length > 0) {
        const { present, gone } = splitProcesses(snap.processes);
        if (present.length > 0) {
          out("[upgrade] 还在的入口进程（只说明情况，不当作阻塞）：\n");
          for (const p of present) out("  - " + describeProcess(p) + "\n");
        }
        // #343: 本机确认已经不在的那些只报一行——它们是几十条同一种东西，
        // 逐条列出来就把报告塞满了。明细在 --json 里，清不清由 prune 决定。
        if (gone.length > 0) {
          out("[upgrade] 另有 " + gone.length + " 条入口进程本机已经确认不在了，只是没写结束：" +
            "不当作阻塞。要清就跑 ans upgrade prune（过窗口的会删掉；明细看 --json）\n");
        }
      }
      // "dead" 和 "unknown" 不是一回事：前者本机已经查清（进程没了），后者查不了。
      // 混着数会让人以为这些行全都无从判断。
      const dead = snap.blockers.filter((b) => b.ownerState === "dead").length;
      const unknown = snap.blockers.filter((b) => b.ownerState === "unknown").length;
      if (dead + unknown > 0) {
        out("[upgrade] 其中已经不在跑的 " + dead + " 条、别的机器上确认不了的 " + unknown + " 条，要人决定：" +
          "确认真的没人管了就用 ans upgrade dismiss <taskId> --reason \"...\"\n");
      }
      // 两个版本分开报。混成一句"版本 0.2.0"会让人以为常驻服务也换了。
      out("[版本] 磁盘上这份（下次启动会用它）：" + describeIdentity(identity) + "\n");
      out("[版本] 来源：" + describeSource(identity.source) + "，位置：" + identity.packageRoot + "\n");
      if (reconnect.pending.length > 0) {
        out("[重连] 这 " + reconnect.pending.length + " 个入口还在旧版上，重启或重连才会换成 " +
          describeBuildId(identity.buildId) + "：\n");
        for (const entry of reconnect.pending) {
          out("  - " + entry.entry + " pid " + entry.pid + "：跑的是 " + entry.build +
            "，起于 " + entry.startedAt + "\n");
        }
      } else if (reconnect.unknown.length === 0) {
        out("[重连] 没有入口还在旧版上\n");
      }
      if (reconnect.unknown.length > 0) {
        out("[重连] 这 " + reconnect.unknown.length + " 个入口没记下自己跑的是哪一版" +
          "，是不是旧版说不清：\n");
        for (const entry of reconnect.unknown) {
          out("  - " + entry.entry + " pid " + entry.pid + "，起于 " + entry.startedAt + "\n");
        }
      }
      if (pause) {
        out("[暂停] " + pause.drainedAt + " 等干净过一次（封门 " + pause.gateId + "）：" +
          pauseOutcome(pause, identity).text + "\n");
      }
      // 换版历史只有 finish 在写，报告里得能读回来一条，否则这份文件只增不读，
      // 人想看只能自己去数据根开 JSON。
      const lastSwitch = history[0];
      if (lastSwitch) {
        out("[历史] 最近一次换版：" + lastSwitch.at + "，" +
          describeBuildId(lastSwitch.from.buildId) + " → " + describeBuildId(lastSwitch.to.buildId) +
          (lastSwitch.pendingReconnect.length > 0
            ? "（当时还有 " + lastSwitch.pendingReconnect.length + " 个入口待重连）"
            : "") +
          "；共 " + history.length + " 条，全在 " + ansUpgradeHistoryPath(env) + "\n");
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
      return await runWait(registry, {
        out, err, json, timeoutMs, sleep, now,
        identity: identityOf(opts),
        env,
      });
    } finally {
      registry.close();
    }
  }

  if (command === "finish") {
    if (positional.length > 0) { err("ans upgrade finish: 不接位置参数\n"); return 2; }
    const identity = identityOf(opts);
    const pause = readPauseRecord(env);
    if (!pause) {
      // 没有暂停记录就是不知道"从哪一版停的"。这时报"升级完成"等于编一个基准。
      err("ans upgrade finish: 没有进行中的升级暂停记录（" +
        (existsSync(ansUpgradePausePath(env)) ? "文件坏了，读不出来" : "还没跑过 ans upgrade wait") +
        "）。没有基准就核对不了到底换没换版本：要么 ans upgrade wait 重新走一遍，要么 " +
        "ans upgrade cancel 直接打开准入\n");
      return 1;
    }
    // 能不能收尾由 pauseOutcome 一处说了算：status 报的是同一句话，两条命令不会
    // 各说一套，也不会劝人走一条注定被拒的路。
    const outcome = pauseOutcome(pause, identity);
    if (!outcome.canFinish) {
      err("[upgrade] " + outcome.text + "。\n" +
        "[upgrade] 磁盘上这份：" + describeIdentity(identity) + "（" + identity.packageRoot + "）\n" +
        "[upgrade] 准入还关着——没核对通过就不打开。\n");
      return 1;
    }
    let snap: Snapshot;
    try {
      snap = readSnapshot(resolvedDb, process.pid);
    } catch (e) {
      err("ans upgrade finish: 读不了库 " + resolvedDb + "（" + errText(e) + "）\n");
      return 1;
    }
    const reconnect = reconnectOf(snap.processes, identity.buildId);
    const record: SwitchRecord = {
      version: 1,
      at: new Date(now()).toISOString(),
      from: pause.from,
      to: stampOf(identity),
      pendingReconnect: reconnect.pending,
      unknownReconnect: reconnect.unknown,
    };
    // 先记账再开准入：反过来的话，记录写失败时准入已经开了，而这次换版没有任何
    // 痕迹——下次谁也说不清"上次是从哪版到哪版"。
    try {
      appendSwitchRecord(record, env);
    } catch (e) {
      err("ans upgrade finish: 换版记录写不进去（" + errText(e) + "）；准入还关着，先解决写盘问题\n");
      return 1;
    }
    let wasOpen: boolean;
    try {
      const registry = openTaskRegistry(resolvedDb);
      try {
        wasOpen = registry.closeGate();
      } finally {
        registry.close();
      }
    } catch (e) {
      err("ans upgrade finish: 打不开准入（" + errText(e) + "）——换版记录已经写了，准入还关着\n");
      return 1;
    }
    clearPauseRecord(env);
    if (json) {
      out(JSON.stringify({
        admission: "open", finished: true, reopened: wasOpen,
        from: record.from, to: record.to,
        pendingReconnect: record.pendingReconnect, unknownReconnect: record.unknownReconnect,
      }, null, 2) + "\n");
    } else {
      out("[upgrade] 换版核对通过：" + describeBuildId(record.from.buildId) + " → " +
        describeBuildId(record.to.buildId) + "\n");
      out("[upgrade] 准入" + (wasOpen ? "已经重新打开，新任务可以接了" : "本来就是开的") + "\n");
      if (record.pendingReconnect.length > 0) {
        out("[upgrade] 下面这些入口执行着旧代码，重启或重连之后才会换成 " +
          describeBuildId(record.to.buildId) + "：\n");
        for (const entry of record.pendingReconnect) {
          out("  - " + entry.entry + " pid " + entry.pid + "：" + (entry.build ?? "没记是哪一版") +
            "，起于 " + entry.startedAt + "\n");
        }
      } else {
        out("[upgrade] 没有入口还在旧版上\n");
      }
      if (record.unknownReconnect.length > 0) {
        out("[upgrade] 另外这 " + record.unknownReconnect.length +
          " 个入口没记下自己跑的是哪一版，是不是旧版说不清：\n");
        for (const entry of record.unknownReconnect) {
          out("  - " + entry.entry + " pid " + entry.pid + "，起于 " + entry.startedAt + "\n");
        }
      }
      if (record.pendingReconnect.length + record.unknownReconnect.length > 0) {
        out("[upgrade] 本命令不重启任何进程：什么时候重启由你决定\n");
        out("[upgrade] 宿主配置里若还写着旧安装的命令路径，用 ans host status 看、ans host repair <宿主> 更新" +
          "（接线那套流程只管本工具条目，不动别的）\n");
      }
      // 旧库副本只说不动：恢复旧快照可能丢掉换版之后写进去的数据，这不是一条
      // 命令该替人做的决定。
      const layout = readAnsLayoutRecord(env);
      const snapshots = (layout?.moved ?? []).filter((move) => move.how === "snapshot");
      if (snapshots.length > 0) {
        out("[upgrade] 旧库副本还在原处（升级前那一份，不是现在的库）：\n");
        for (const move of snapshots) out("  - " + move.from + "（" + (move.at ?? "时间没记") + "）\n");
        out("[upgrade] 程序不会拿它自动恢复：恢复会丢掉那之后写进去的东西，要恢复请自己确认后手动做\n");
      }
    }
    return 0;
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
      // 暂停记录跟着这次暂停一起作废：留着它，下一次 finish 会拿一个过期的
      // 基准去比，比出来的结论没有意义。
      clearPauseRecord(env);
      if (json) {
        out(JSON.stringify({ admission: "open", cancelled: wasOpen }, null, 2) + "\n");
      } else {
        out("[upgrade] " + (wasOpen
          ? "已经打开准入，新任务又能进来了（正在跑的活没被碰）\n"
          : "准入本来就是开的，没有可取消的暂停\n"));
      }
      // 两种都算"准入现在是开的"，都退 0：空前提出 1 会被脚本读成"升级被挡"。
      return 0;
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
      // 不再复查"是不是还在挡"：dismiss 写的 dismissed_at 一定让 blockingTasks
      // 排除这行，复查永远为假，只会在成功文案后面接一个失败退出码。
      if (json) {
        out(JSON.stringify({ dismissed: taskId, reason: reason.trim() }, null, 2) + "\n");
      } else {
        out("[upgrade] 记下了：" + taskId + " 不再算升级阻塞（原因：" + reason.trim() + "）\n");
      }
      return 0;
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
      // #343: 两张表一次算清。dry-run 和真跑读的是同一份计划——真跑不重新判断
      // 一遍，预览说过要删的，就是它要删的那几条。
      //
      // 预览算在这里而不是只给 --dry-run 用：真跑拿它决定"到底有没有东西可删"。
      // 只有"过期但删不得"（被别的行引用着）时不该写快照——什么都没删，快照就是
      // 一份多余的存档点。
      const preview = registry.previewPrune(retentionDays);
      const plan = registry.processPrunePlan(retentionDays);
      if (preview.wouldPrune.length === 0 && plan.deletable.length === 0) {
        // 同一个 --json 只有一种形状：脚本读任何一个字段，在"库本来就干净"这条
        // 路上都不会拿到 undefined。
        if (json) {
          out(pruneJson({
            days: retentionDays, dryRun, backup: null,
            taskPruned: 0, taskWouldPrune: [], taskWouldHold: preview.wouldHold.length,
            taskHeld: preview.wouldHold.length,
            plan, processRemoved: { removed: 0, closed: 0, openGone: 0 },
          }));
        } else {
          out("[upgrade] 没有要删的行（保留窗口 " + retentionDays + " 天" +
            (dryRun ? "，dry-run 没删" : "") + "）\n");
          if (preview.wouldHold.length > 0) {
            out("[upgrade] 有 " + preview.wouldHold.length + " 条任务行虽然过期了，但还被别的行引用着，" +
              "留着（删了会把那些行的归属抹掉）\n");
          }
          reportKeptProcesses(out, plan);
        }
        return 0;
      }
      if (dryRun) {
        // 预览必须和真跑对得上，包括多层父子：真跑是一层一层剥，父行在子行删掉
        // 之后下一轮就能删，所以"被谁指着"要在剥完的图上算，不能只看当前引用。
        if (json) {
          out(pruneJson({
            days: retentionDays, dryRun: true, backup: null,
            taskPruned: 0,
            taskWouldPrune: preview.wouldPrune,
            taskWouldHold: preview.wouldHold.length,
            taskHeld: preview.wouldHold.length,
            plan, processRemoved: { removed: 0, closed: 0, openGone: 0 },
          }));
        } else {
          if (preview.wouldPrune.length > 0) {
            out("[upgrade] 会删掉 " + preview.wouldPrune.length + " 条 " + retentionDays +
              " 天前收尾的任务行（dry-run，没删）：\n");
            for (const r of preview.wouldPrune) out("  - " + r.kind + " 结束于 " + r.endedAt + "\n");
          }
          if (preview.wouldHold.length > 0) {
            out("[upgrade] 另有 " + preview.wouldHold.length + " 条虽然过期了，但还被别的行引用着，" +
              "真跑时会留着（删了会把那些行的归属抹掉）：\n");
            for (const r of preview.wouldHold) out("  - " + r.kind + " 结束于 " + r.endedAt + "\n");
          }
          if (preview.wouldPrune.length + preview.wouldHold.length === 0) {
            out("[upgrade] " + retentionDays + " 天前没有要删的任务行（dry-run，没删）\n");
          }
          if (plan.deletable.length > 0) {
            out("[upgrade] 进程登记会删掉 " + plan.deletable.length + " 条（dry-run，没删）：\n");
            for (const d of plan.deletable) out("  - " + describeProcessDelete(d) + "\n");
          } else {
            out("[upgrade] 进程登记没有要删的行（dry-run，没删）\n");
          }
          reportKeptProcesses(out, plan);
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
        err("ans upgrade prune: 建不起快照，什么都没删（" + errText(e) + "）\n");
        return 1;
      }
      const pruned = registry.pruneFinishedTasks(retentionDays);
      const processRemoved = registry.pruneProcessRecords(plan, retentionDays);
      if (json) {
        out(pruneJson({
          days: retentionDays, dryRun: false, backup: backup.backupFile,
          taskPruned: pruned.removed,
          // 计划与结果分开报：打算删的还是预览里那几条，真删掉几条是 pruned。
          taskWouldPrune: preview.wouldPrune,
          taskWouldHold: preview.wouldHold.length,
          taskHeld: pruned.heldByChildren,
          plan, processRemoved,
        }));
      } else {
        // 恢复依据单独一行：只删了进程行、或只删了任务行，这一句都得说出来。
        out("[upgrade] 恢复依据在 " + backup.backupFile + "（连同它的 .json 记录）\n");
        if (pruned.removed > 0) {
          out("[upgrade] 删掉了 " + pruned.removed + " 条 " + retentionDays + " 天前收尾的任务行\n");
        }
        out("[upgrade] 开着的任务行一条没动——它们是升级阻塞的判据\n");
        if (pruned.heldByChildren > 0) {
          out("[upgrade] 有 " + pruned.heldByChildren + " 条虽然过期了，但还被别的行引用着，" +
            "所以留着没删（删了会把那些行的归属抹掉）\n");
        }
        if (processRemoved.removed > 0) {
          out("[upgrade] 进程登记删掉了 " + processRemoved.removed + " 条：" +
            "已收尾的 " + processRemoved.closed + " 条、开着但本机确认进程已经不在的 " +
            processRemoved.openGone + " 条\n");
        }
        reportKeptProcesses(out, plan);
      }
      return 0;
    } catch (e) {
      err("ans upgrade prune: 删不了（" + errText(e) + "）\n");
      return 1;
    } finally {
      registry.close();
    }
  }

  err("ans upgrade: 不认识 " + command + "。可用的有 status / wait / install / finish / cancel / dismiss / prune\n");
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
    " 起暂停了新任务）。这不是失败，也不会排队重放：等升级做完再敲一次。" +
    "如果根本没人在升级（上次的 ans upgrade wait 被中断过），用 ans upgrade cancel 打开准入。\n";
}
