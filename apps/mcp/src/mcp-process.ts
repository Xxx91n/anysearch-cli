// #311: 常驻 MCP 服务自己的进程记录。
//
// 为什么非要这一条：升级报告要回答"哪些入口还在跑旧代码"。宿主起的
// `ans-mcp` 是一个常驻进程，可以活过整场升级——文件换成新版了，它执行的还是
// 启动时那一份。没有这条记录，它就不在任何清单里，报告只能说"没有入口还在旧版
// 上"，那是假的。
//
// 记的是"启动时那一版"（`<包根>/dist/build-info.json` 的戳），写一次不改。
// 没打标的构建（本地单独 build 的 @anysearch-cli/mcp）记 NULL，报告里读成
// "没记是哪一版"，不拿磁盘上现在那一版去补——那正好是反过来的问题。
//
// 登记失败只 warn 一句、服务照起：一个坏掉的登记表不该让宿主连不上 MCP。

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildId,
  ensureOwnerOnlyDb,
  openTaskRegistry,
  readBuildInfo,
  type RegisteredProcess,
  type TaskRegistry,
} from "@anysearch-cli/store";

function selfDir(): string {
  const self = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  return self;
}

/**
 * 本进程执行的构建标识，没打标就是 undefined。
 *
 * 打包后的位置是 `<包根>/mcp/dist/index.js`，所以 build-info.json 就在同一个
 * 目录（`apps/cli/scripts/stamp-dist.mjs` 往那儿盖一次）。
 */
export function mcpBuildId(): string | undefined {
  const info = readBuildInfo(join(selfDir(), "build-info.json"));
  return info ? buildId(info) : undefined;
}

export interface McpProcessRecord {
  /** 写下结束；重复调用是空操作。 */
  end(): void;
}

const NOOP: McpProcessRecord = { end: () => { /* 什么都没登记 */ } };

/**
 * 登记这个服务的生命周期，返回关闭它的句柄。
 *
 * `dbPath` 由调用方给，而不是这里去解析：入口已经算过一次库路径，再算第二次
 * 就有了两个"当前库"的答案。
 */
export function registerMcpProcess(dbPath: string, warn: (message: string) => void): McpProcessRecord {
  let registry: TaskRegistry | undefined;
  let record: RegisteredProcess | undefined;
  try {
    ensureOwnerOnlyDb(dbPath);
    registry = openTaskRegistry(dbPath);
    const build = mcpBuildId();
    record = registry.registerProcess({ entry: "mcp", ...(build ? { build } : {}) });
  } catch (e) {
    warn("process registration failed (" + (e instanceof Error ? e.message : String(e)) +
      ") — this server runs unrecorded");
    try { registry?.close(); } catch { /* 已经关了 */ }
    return NOOP;
  }
  let ended = false;
  return {
    end: (): void => {
      if (ended) return;
      ended = true;
      try { record?.end(); } catch { /* 已经收尾或库先关了 */ }
      try { registry?.close(); } catch { /* 同上 */ }
    },
  };
}
