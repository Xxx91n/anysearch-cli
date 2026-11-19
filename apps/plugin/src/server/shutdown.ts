// 钩子服务的关门口（#307）。抽成独立函数，因为它是「两个分支都要走一遍」的逻辑，
// 而 index.ts 的模块作用域里没法测。这里只做决定，不碰真进程：关服务器、等后置
// 工作、关库、清登记、退出码，全部从参数进来。

/**
 * 关门口能看见的外部动作。每项都是一个函数，测试传假的，index.ts 传真进程的。
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
 * 就退 1 且**不关库**。
 *
 * 为什么不关库：库开着的时候，一个后置单元可能正做到一半（行已开、结束还没写、
 * 索引还没落）。这时候 close() 会把这次写整个丢掉，留下半截的账。等它做完的价值
 * 是「账是完整的」，不是「怕把文件写坏」——库是 WAL 模式，硬杀进程不会损坏文件；
 * 而且 better-sqlite3 是同步调用，一条写语句中途不会有别的 JS 代码插进来 close()。
 */
export async function runShutdown(deps: ShutdownDeps): Promise<void> {
  let requestsClosed = false;
  let drainedUnits = false;
  const requestsEnded = deps.closeServer().then(() => { requestsClosed = true; });
  const unitsEnded = deps.drainPostWork(deps.drainMs).then((ok) => { drainedUnits = ok; });
  // 共用同一个上限：客户端挂着 socket 不能把退出无限拖下去。
  const deadline = new Promise<void>((resolve) => setTimeout(resolve, deps.drainMs));

  await Promise.race([Promise.all([requestsEnded, unitsEnded]), deadline]);

  if (!drainedUnits || !requestsClosed) {
    // 说清楚卡在哪：卡住的请求和还在跑的后置工作，查的地方不一样。
    const detail = deps.pendingPostWork() > 0
      ? deps.pendingPostWork() + " post-work unit(s) still running"
      : "requests still in flight (no post-work unit is running)";
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
  deps.closeStores();
  deps.clearRegistry();
  deps.stopPostWork();
  deps.exit(0);
}

/**
 * 读 `ANS_SHUTDOWN_DRAIN_MS`，非法值回落 10000 并说明。
 *
 * 非法值（`abc`、`-1`）会让 setTimeout 立刻到期，于是每次正常停止都走「超时」
 * 分支：退出码 1、库不关。这种安静的错误比崩掉还难查，所以回落要说一声。
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
