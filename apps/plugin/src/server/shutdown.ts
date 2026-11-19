// 钩子服务收到停止信号后的收尾（#307）。抽成独立函数，因为这个决定有两个分支、都要走一遍，
// 而 index.ts 的模块作用域里没法测。这里只做决定，不碰真进程：关服务器、等后置
// 工作、关库、清登记、退出码，全部从参数进来。

/**
 * 收尾时能看见的外部动作。每项都是一个函数，测试传假的，index.ts 传真进程的。
 */
export interface ShutdownDeps {
  /** 停止收新连接，等已有连接都结束。resolve 表示都结束了。 */
  closeServer: () => Promise<void>;
  /** 等已登记的后置工作收尾；true = 都收完了。 */
  drainPostWork: (timeoutMs: number) => Promise<boolean>;
  /** 此刻还有几条后置工作在跑（只用于把原因说清楚）。 */
  pendingPostWork: () => number;
  /** 关掉本进程打开的库。 */
  closeStores: () => void;
  /** 清掉 server.json 里本进程发布的地址。 */
  clearRegistry: () => void;
  /** 写进程结束记录并关掉登记器。 */
  stopPostWork: () => void;
  /** 退出进程。 */
  exit: (code: number) => void;
  /** 写一行说明（stderr）。 */
  write: (line: string) => void;
  /** 最多等多久。 */
  drainMs: number;
  /** 收到的信号名，只用于文案。 */
  signal: string;
}

/**
 * 收到停止信号后的决定。
 *
 * 两条判据都要过：已有请求结束、已登记的后置工作收尾。都过就关库退 0；有一条没过
 * 就退 1 且不关库。
 *
 * 为什么不关库：库开着的时候，一个后置单元可能正做到一半（行已开、结束还没写、
 * 索引还没落）。这时候 close() 会把这次写整个丢掉，留下半截的账。等它做完的价值
 * 是「账是完整的」，不是「怕把文件写坏」——库是 WAL 模式，硬杀进程不会损坏文件；
 * 而且 better-sqlite3 是同步调用，一条写语句中途不会有别的 JS 代码插进来 close()。
 */
export async function runShutdown(deps: ShutdownDeps): Promise<void> {
  let requestsClosed = false;
  let drainedUnits = false;
  // 共用一个上限：客户端挂着 socket 不能把退出无限拖下去。
  const deadline = new Promise<void>((resolve) => setTimeout(resolve, deps.drainMs));

  // 顺序是「先等请求收完，再等后置工作」。不能反过来：请求还在处理时，
  // 它的后置工作可能刚排上队、任务行还没建，那一刻 drain 看到 0 条就放行，
  // 关库正好盖在它要开始的写上面。等请求全收完，剩下的就都是已经排队的活。
  // 两个 await 都在同一个上限内，超时一起放弃。
  try {
    const allDone = (async (): Promise<void> => {
      await deps.closeServer();
      requestsClosed = true;
      drainedUnits = await deps.drainPostWork(deps.drainMs);
    })();
    await Promise.race([allDone, deadline]);
  } catch {
    // 某一项自己抛了（drain 或 closeServer 失败）。这就是「没干净结束」，
    // 往下走失败分支；不吞掉的话 index.ts 那边是 `void runShutdown(...)`，
    // 会变成未处理的拒绝，进程连退出码都留不下。
  }

  if (!drainedUnits || !requestsClosed) {
    // 按「先后顺序」判断，因为 drain 现在排在请求之后：请求没收完时 drain
    // 根本还没跑，`drainedUnits` 是 false 并不代表 drain 失败。
    const pending = deps.pendingPostWork();
    let detail: string;
    if (!requestsClosed) {
      detail = "requests still in flight (" +
        (pending > 0 ? pending + " post-work unit(s) still running" : "no post-work unit is running") + ")";
    } else if (pending > 0) {
      detail = pending + " post-work unit(s) still running";
    } else {
      detail = "the stop did not settle (post-work drain failed)";
    }
    deps.write(
      "[anysearch] " + deps.signal + ": " + detail + " after " + deps.drainMs +
      "ms — exiting without closing stores; open task rows stay as blockers an upgrade reports\n",
    );
    // 失败路径也清掉发布的地址，和成功路径保持一致。
    try { deps.clearRegistry(); } catch { /* best-effort */ }
    // 不关库、不关登记器：活还拿着它们。
    deps.exit(1);
    return;
  }
  // 关闭动作各自兜住：前一步抛了不能连退出码都不留。
  try { deps.closeStores(); } catch { /* the process is exiting anyway */ }
  try { deps.clearRegistry(); } catch { /* best-effort */ }
  try { deps.stopPostWork(); } catch { /* best-effort */ }
  deps.exit(0);
}

/**
 * 读 `ANS_SHUTDOWN_DRAIN_MS`，非法值回落 10000 并说明。
 *
 * 非法值（`abc`、`-1`）会让 setTimeout 立刻到期，于是每次正常停止都走「超时」
 * 分支：退出码 1、库不关。这种安静的错误比崩掉还难查，所以回落要说一声。
 * 别的 ANS_* 整数开关（如 pi-session 的 positiveIntFromEnv）是静默回落的；这个
 * 不一样，因为填错它换来的不是「慢一点」而是「每次停机都像没收拾干净」。
 */
export function parseDrainMs(raw: string | undefined, write: (line: string) => void): number {
  const fallback = 10000;
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    write("[anysearch] ANS_SHUTDOWN_DRAIN_MS=" + raw + " is not a positive number; using " + fallback + "ms\n");
    return fallback;
  }
  return parsed;
}
