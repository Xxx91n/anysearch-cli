// Stub process.kill for one pid so the liveness probe answers the way a lock scenario needs, then
// restore the real one. The lock probes on every retry, so a scenario that holds a lock for a
// whole wait window sees the stub dozens of times; one helper beats four copies of the patch.
export function withProbe<T>(pid: number, code: "ESRCH" | "EPERM" | "ERR_INVALID_ARG_TYPE", fn: () => T): T {
  const real = process.kill;
  process.kill = ((target: number, signal?: string | number) => {
    if (target === pid && signal === 0) throw Object.assign(new Error("probe stub: " + code), { code });
    return real(target, signal as NodeJS.Signals);
  }) as typeof process.kill;
  try {
    return fn();
  } finally {
    process.kill = real;
  }
}
