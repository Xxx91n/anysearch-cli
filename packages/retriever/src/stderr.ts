// 往 stderr 打诊断提示的安全封装，retriever 和 kernel 共用。
//
// stderr 关掉或断掉（比如 MCP 父进程把管道关了）时，写失败会异步发 'error' 事件，
// 没人接就会变成未捕获异常把进程带崩。这里把异步 'error' 和同步抛错都接住，
// 保证写日志绝不把主流程弄塌。

export function writeStderrDiagnostic(message: string): void {
  const stderr = process.stderr;
  const swallow = () => {};
  stderr.once("error", swallow);
  try {
    // 异步写失败时，Node 会先调回调再发 'error' 事件；所以只在写成功时摘掉监听，
    // 失败时留着让它接住随后发出来的 'error'（once 会自动摘掉）。
    stderr.write(message, (error) => {
      if (!error) stderr.off("error", swallow);
    });
  } catch {
    stderr.off("error", swallow);
  }
}
