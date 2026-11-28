// 读 HTTP 响应头的小工具，搜索臂和读页臂共用。

/**
 * 上游给的等待秒数（`retry-after` 头）：秒数或 HTTP 日期都认，别的写法当没有、不猜。
 * 挂在错误对象的 `retryAfter` 上，`providerErrorText` 会把它写回错误串，引擎据此告诉
 * 用户要等多久。
 */
export function waitSecondsFromHeader(resp: Response): number | undefined {
  const raw = resp.headers.get("retry-after")?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return undefined;
  const delta = Math.ceil((at - Date.now()) / 1000);
  return delta > 0 ? delta : undefined;
}
