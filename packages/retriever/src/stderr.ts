// 往 stderr 打诊断提示的安全封装，retriever 和 kernel 共用。
//
// stderr 关掉或断掉（比如 MCP 父进程把管道关了）时，写失败会异步发 'error' 事件，
// 没人接就会变成未捕获异常把进程带崩。这里同时防两件事：
// 1. 流已经毁掉/结束/出错就直接早退，不再写也不再挂监听；
// 2. 同一个流上同一时间只挂一个 once('error') 兜底，避免连续写失败攒出 MaxListenersExceededWarning。

export interface DiagnosticWritable {
  readonly destroyed?: boolean;
  readonly writableEnded?: boolean;
  readonly errored?: Error | null;
  once(event: "error", listener: () => void): unknown;
  off(event: "error", listener: () => void): unknown;
  write(chunk: string, cb?: (error?: Error | null) => void): unknown;
}

const activeSwallows = new WeakMap<DiagnosticWritable, { fn: () => void; pending: number }>();

export function writeStderrDiagnostic(
  message: string,
  stream: DiagnosticWritable = process.stderr,
): void {
  if (stream.destroyed || stream.writableEnded || stream.errored) return;
  let entry = activeSwallows.get(stream);
  if (!entry) {
    const fn = () => {
      activeSwallows.delete(stream);
    };
    entry = { fn, pending: 0 };
    activeSwallows.set(stream, entry);
    stream.once("error", fn);
  }
  const current = entry;
  current.pending++;
  const release = (keepForAsyncError: boolean) => {
    current.pending = Math.max(0, current.pending - 1);
    if (current.pending === 0 && !keepForAsyncError && activeSwallows.get(stream) === current) {
      activeSwallows.delete(stream);
      stream.off("error", current.fn);
    }
  };
  try {
    // 异步写失败时，Node 会先调回调再发 'error' 事件；只在全成功且无在途写时摘掉监听，
    // 失败时留着这个唯一的 once 监听接住随后发出来的 'error'。
    stream.write(message, (error) => {
      release(Boolean(error));
    });
  } catch {
    release(false);
  }
}
