// #311 — 换版这一步真的核对了，而不是"wait 成功了就算换完了"。
//
// 这里钉住的五件事：
//  1. `wait` 等干净以后写一份暂停记录，记下当时磁盘上是哪一版；
//  2. 磁盘上还是同一版时 `finish` 拒绝报完成，准入继续关着；
//  3. 磁盘上换了版本时 `finish` 记一笔"从哪版到哪版"，打开准入，清掉暂停记录；
//  4. 没有暂停记录时 `finish` 不给基准，明确拒绝；
//  5. `status` 分开报"磁盘上哪一版"和"每个入口跑的是哪一版"，三态分清：
//     旧版 / 同版 / 没记下来。
//
// 全程离线：临时 SQLite、注入的"本进程是哪一版"、注入的时钟。
//
// Run: pnpm --filter @anysearch-cli/cli test

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { ansUpgradeHistoryPath, ansUpgradePausePath, openTaskRegistry } from "@anysearch-cli/store";
import type { ProductIdentity } from "../src/build-identity";
import { spawn } from "node:child_process";
import { runUpgrade } from "../src/commands/upgrade";
import { readSwitchHistory } from "../src/upgrade-record";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log("  PASS " + label); }
  else { failed++; console.error("  FAIL " + label + (detail ? ": " + detail : "")); }
}

/** 一个本机确认已经不在的 pid：起一个子进程，等它退出。 */
async function exitedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  const pid = child.pid;
  if (pid === undefined) throw new Error("起不了子进程，拿不到一个死掉的 pid");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return pid;
}

/** 一份假的"磁盘上装的是这一版"。 */
function identityOf(buildId: string): ProductIdentity {
  const version = buildId.split("+")[0] ?? "0.0.0";
  return {
    packageRoot: "/fake/@anysearch-cli/cli",
    packageName: "@anysearch-cli/cli",
    info: {
      version,
      commit: "0123456789abcdef0123456789abcdef01234567",
      dirty: false,
      builtAt: "2026-11-20T00:00:00.000Z",
    },
    buildId,
    source: "package",
  };
}

/** 磁盘上这一份没打标：没有 dist/build-info.json，也就没有版本可核对。 */
function unstampedIdentity(): ProductIdentity {
  return {
    packageRoot: "/fake/@anysearch-cli/cli",
    packageName: "@anysearch-cli/cli",
    info: null,
    buildId: null,
    source: "package",
  };
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "ans-311-finish-"));
  const dbPath = join(dir, "anysearch.db");
  const env = { ...process.env, USERPROFILE: dir, HOME: dir, ANS_DB_PATH: dbPath };
  const OLD = "0.1.2+8f960834";
  const NEW = "0.2.0+cbefccab";
  try {
    const io = () => {
      const out: string[] = [];
      const err: string[] = [];
      return {
        out, err,
        opts: {
          stdout: (t: string) => { out.push(t); },
          stderr: (t: string) => { err.push(t); },
          env,
        },
      };
    };
    const gateOpen = (): boolean => {
      const registry = openTaskRegistry(dbPath);
      try { return registry.gateState() === null; } finally { registry.close(); }
    };
    /**
     * 每个调用都显式带 --db。
     *
     * 不靠 process.env.ANS_DB_PATH：这个文件一忘就写进操作者真实的 ~/.ans，
     * 顺手把人家的准入关掉。显式传参错不了。
     */
    const run = (args: string[], identity: string, sink = io()) =>
      runUpgrade([...args, "--db", dbPath], { ...sink.opts, identity: () => identityOf(identity) })
        .then((code) => ({ code, out: sink.out, err: sink.err }));

    // 一个常驻入口，跑的还是旧版。它一直开着，所以会出现在 status 的重连清单里。
    const resident = openTaskRegistry(dbPath);
    const staleProcess = resident.registerProcess({ entry: "mcp", build: OLD });
    const unknownProcess = resident.registerProcess({ entry: "server" });

    // ---- 1. wait 写下暂停记录 -------------------------------------------
    {
      const s = io();
      const { code } = await run(["wait", "--timeout", "2000"], OLD, s);
      check("1: wait 退 0（没有活要等）", code === 0, s.err.join(""));
      check("1: wait 关掉了准入", !gateOpen());
      check("1: wait 写了暂停记录", existsSync(ansUpgradePausePath(env)));
      // 记录里必须有"从哪一版停的"，否则 finish 没有基准。
      const pause = JSON.parse(readFileSync(ansUpgradePausePath(env), "utf8")) as {
        from: { buildId: string };
        gateId: string;
      };
      check("1: 暂停记录里是从哪一版停的", pause.from.buildId === OLD, JSON.stringify(pause.from));
      check("1: 暂停记录里带着封门号", typeof pause.gateId === "string" && pause.gateId.length > 0);
      check("1: wait 之后准入没被它自己打开", !gateOpen());
    }

    // ---- 2. 文件没换：finish 必须拒绝 ------------------------------------
    {
      const s = io();
      const { code } = await run(["finish"], OLD, s);
      check("2: 同一版 finish 退 1", code === 1, s.out.join(""));
      check("2: 说清文件没换", s.err.join("").includes("文件没换"), s.err.join(""));
      check("2: 准入还关着", !gateOpen());
      check("2: 没写换版历史", !existsSync(ansUpgradeHistoryPath(env)));
      check("2: 暂停记录还在（下一次 finish 还能用）", existsSync(ansUpgradePausePath(env)));
    }

    // ---- 3. 真的换了：finish 收尾 ----------------------------------------
    {
      const s = io();
      const { code } = await run(["finish"], NEW, s);
      check("3: 换了版本 finish 退 0", code === 0, s.err.join("") + s.out.join(""));
      check("3: 报出从哪版到哪版", s.out.join("").includes(OLD + " → " + NEW), s.out.join(""));
      check("3: 打开了准入", gateOpen());
      check("3: 清掉了暂停记录", !existsSync(ansUpgradePausePath(env)));
      check("3: 写了换版历史", existsSync(ansUpgradeHistoryPath(env)));
      const history = JSON.parse(readFileSync(ansUpgradeHistoryPath(env), "utf8")) as Array<{
        from: { buildId: string };
        to: { buildId: string };
        pendingReconnect: Array<{ entry: string; build: string | null }>;
        unknownReconnect: Array<{ entry: string; build: string | null }>;
      }>;
      check("3: 历史里是这次换版", history.length === 1 && history[0]!.from.buildId === OLD && history[0]!.to.buildId === NEW,
        JSON.stringify(history));
      const pending = history[0]!.pendingReconnect.map((entry) => entry.entry);
      check("3: 记下了要重连的旧版入口", pending.includes("mcp"), JSON.stringify(history[0]!.pendingReconnect));
      // 没记版本的入口单独一栏：把它写进"还跑着旧版"，等于替一个判断不了的东西下结论。
      const unrecorded = history[0]!.unknownReconnect.map((entry) => entry.entry);
      check("3: 没记版本的入口单独记一栏，不塞进旧版",
        unrecorded.includes("server") && !pending.includes("server"), JSON.stringify(history[0]!));
      check("3: 报告里两条分开说", s.out.join("").includes("是不是旧版说不清"), s.out.join(""));
      check("3: 报告里说清本命令不重启进程", s.out.join("").includes("本命令不重启任何进程"), s.out.join(""));
    }

    // ---- 4. 没有暂停记录：不给基准 ---------------------------------------
    {
      const s = io();
      const { code } = await run(["finish"], NEW, s);
      check("4: 没有暂停记录 finish 退 1", code === 1, s.out.join(""));
      check("4: 说清缺的是什么", s.err.join("").includes("没有进行中的升级暂停记录"), s.err.join(""));
      check("4: 让人要么重走 wait 要么 cancel", s.err.join("").includes("ans upgrade cancel"), s.err.join(""));
    }

    // ---- 5. status 分开报两个版本，三态分清 -------------------------------
    {
      const s = io();
      await run(["status"], NEW, s);
      const text = s.out.join("");
      check("5: 报磁盘上那一版", text.includes("[版本] 磁盘上这份") && text.includes(NEW), text);
      check("5: 报来源和位置", text.includes("[版本] 来源：") && text.includes("/fake/@anysearch-cli/cli"), text);
      check("5: 把还在旧版上的入口列出来", text.includes("[重连] 这 1 个入口还在旧版上") && text.includes(OLD), text);
      check("5: 没记版本的入口单独列，不混进旧版",
        text.includes("没记下自己跑的是哪一版") && text.includes("server"), text);

      const jsonOut = io();
      await run(["status", "--json"], NEW, jsonOut);
      const parsed = JSON.parse(jsonOut.out.join("")) as {
        program: { installed: { buildId: string; source: string }; reconnect: { pending: Array<{ entry: string }>; unknown: Array<{ entry: string }> } };
        processes: Array<{ entry: string; build: string | null; stale: boolean | null }>;
        pause: unknown;
      };
      check("5: --json 报磁盘版本", parsed.program.installed.buildId === NEW, JSON.stringify(parsed.program.installed));
      check("5: --json 报来源", parsed.program.installed.source === "package");
      check("5: --json 分开列 pending 和 unknown",
        parsed.program.reconnect.pending.some((e) => e.entry === "mcp") &&
        parsed.program.reconnect.unknown.some((e) => e.entry === "server"),
        JSON.stringify(parsed.program.reconnect));
      const stale = parsed.processes.find((p) => p.entry === "mcp")!;
      const unknownRow = parsed.processes.find((p) => p.entry === "server")!;
      check("5: --json 每个进程带 stale 三态", stale.stale === true && unknownRow.stale === null,
        JSON.stringify(parsed.processes));
      check("5: 没有暂停记录时 pause 是 null", parsed.pause === null);
    }

    // ---- 6. 全换成新版以后，重连清单是空的 -------------------------------
    {
      staleProcess.end();
      unknownProcess.end();
      const registry = openTaskRegistry(dbPath);
      const fresh = registry.registerProcess({ entry: "mcp", build: NEW });
      const s = io();
      await run(["status"], NEW, s);
      check("6: 同版入口不进重连清单", s.out.join("").includes("[重连] 没有入口还在旧版上"), s.out.join(""));
      fresh.end();
      registry.close();
    }

    // ---- 8. 本机确认已经没了的入口，不算"还要重连" -----------------------
    {
      // 一行 pid 已经不在的旧版记录：它是"进程没了、行没收尾"，不是"还在跑旧版"。
      // 把它算进重连清单，等于让人去重启一个早就不存在的东西。
      const deadPid = await exitedPid();
      const ghost = openTaskRegistry(dbPath, {
        owner: { pid: deadPid, host: hostname() },
        isOwnerAlive: () => false,
      });
      const ghostRow = ghost.registerProcess({ entry: "mcp", build: OLD });
      // 另一个还在跑的旧版入口，用来证明这一条真的区分了两者。
      const live = openTaskRegistry(dbPath);
      const liveRow = live.registerProcess({ entry: "server", build: OLD });
      try {
        const s = io();
        await run(["status"], NEW, s);
        const text = s.out.join("");
        // #343: 死掉的行不再逐条列，折进入口清单的一行汇总。它仍然"被报出来"，
        // 只是不再占一行——更不进制重连清单，那才是这一条要守的事。
        check("8: 死掉的那行折进入口清单的汇总行",
          /另有 1 条入口进程本机已经确认不在了/.test(text), text);
        check("8: 不再逐条念出死掉的行", !text.includes("本机确认已经没了，但没写结束"), text);
        // 只取 [重连] 那一段来判断：死掉的那行必须不在里面，还在跑的那个必须在。
        const reconnectText = text.slice(text.indexOf("[重连]"));
        check("8: 重连清单里没有那个死掉的 pid",
          !reconnectText.includes("mcp pid " + deadPid), reconnectText);
        check("8: 重连清单里有还在跑的那个", reconnectText.includes("server pid "), reconnectText);

        const jsonOut = io();
        await run(["status", "--json"], NEW, jsonOut);
        const parsed = JSON.parse(jsonOut.out.join("")) as {
          program: { reconnect: { pending: Array<{ entry: string }> } };
          processes: Array<{ entry: string; ownerState: string; build: string | null }>;
        };
        const pending = parsed.program.reconnect.pending.map((e) => e.entry);
        check("8: --json 的重连清单只有还在跑的那个", pending.length === 1 && pending[0] === "server",
          JSON.stringify(parsed.program.reconnect));
        const dead = parsed.processes.find((p) => p.ownerState === "dead");
        check("8: 死掉的那行仍然出现在进程清单里（只是不算重连）", dead?.build === OLD,
          JSON.stringify(parsed.processes));
      } finally {
        ghostRow.end();
        ghost.close();
        liveRow.end();
        live.close();
      }
    }

    // ---- 10. 磁盘上这一份没打标：核对不了，finish 不许报通过 --------------
    {
      const waited = await run(["wait", "--timeout", "2000"], NEW);
      check("10: 又暂停了一次（基准是 NEW）", waited.code === 0 && existsSync(ansUpgradePausePath(env)),
        "code=" + waited.code + " out=" + waited.out.join("") + " err=" + waited.err.join(""));
      const historyBefore = readSwitchHistory(env).length;
      const s = io();
      const code = await runUpgrade(["finish", "--db", dbPath], { ...s.opts, identity: unstampedIdentity });
      check("10: 磁盘没打标时 finish 退 1", code === 1, "code=" + code + " " + s.out.join(""));
      check("10: 说清核对不了哪一版", s.err.join("").includes("没打标"), s.err.join(""));
      check("10: 磁盘这份没打标时也给一条放弃的出路",
        s.err.join("").includes("ans upgrade cancel"), s.err.join(""));
      check("10: 准入还关着（没报一个核对不了的通过）", !gateOpen());
      check("10: 没写换版历史", readSwitchHistory(env).length === historyBefore, String(historyBefore));

      // status 也不能把说不清的进程报成旧版：磁盘没打标，就没有"当前版本"可比。
      const live = openTaskRegistry(dbPath);
      const row = live.registerProcess({ entry: "mcp", build: OLD });
      try {
        const st = io();
        await runUpgrade(["status", "--json", "--db", dbPath], { ...st.opts, identity: unstampedIdentity });
        const parsed = JSON.parse(st.out.join("")) as {
          processes: Array<{ stale: boolean | null }>;
          program: { installed: { buildId: string | null } };
        };
        check("10: --json 里磁盘版本是 null", parsed.program.installed.buildId === null,
          JSON.stringify(parsed.program.installed));
        check("10: 磁盘没打标时每个进程都判不了（stale 全是 null）",
          parsed.processes.length > 0 && parsed.processes.every((p) => p.stale === null),
          JSON.stringify(parsed.processes));

        // 文字报告也得和 finish 一个口径：磁盘这份没打标时，不能一边说没打标、
        // 一边又说"可以 ans upgrade finish 收尾"。
        const stText = io();
        await runUpgrade(["status", "--db", dbPath], { ...stText.opts, identity: unstampedIdentity });
        const text = stText.out.join("");
        check("10: status 说清磁盘这份没打标、finish 会拒", text.includes("现在磁盘上这份没打标"), text);
        check("10: status 没让人去跑一个会被拒的 finish",
          !text.includes("可以 ans upgrade finish 收尾"), text);
        // 前缀和分支各讲一遍「没打标」，一行里就会出现三次以上。每侧只该说一次。
        check("10: status 没把「没打标」反复说",
          (text.match(/没打标/g) ?? []).length <= 2, text);
      } finally {
        row.end();
        live.close();
      }
    }

    // ---- 11. 暂停时那一份没打标：没有基准，finish 也不许报通过 --------------
    {
      const s = io();
      const waited = await runUpgrade(["wait", "--timeout", "2000", "--db", dbPath], {
        ...s.opts, identity: unstampedIdentity,
      });
      check("11: 没打标时 wait 也退 0（活干完了就能停）", waited === 0, s.err.join(""));
      const pause = JSON.parse(readFileSync(ansUpgradePausePath(env), "utf8")) as {
        from: { buildId: string | null };
      };
      check("11: 暂停记录里基准是 null", pause.from.buildId === null, JSON.stringify(pause.from));

      const historyBefore = readSwitchHistory(env).length;
      const fin = io();
      const { code } = await run(["finish"], NEW, fin);
      check("11: 基准没打标时 finish 退 1", code === 1, "code=" + code + " " + fin.out.join(""));
      check("11: 说清没有可核对的基准", fin.err.join("").includes("没有可核对的基准"), fin.err.join(""));
      check("11: 准入还关着", !gateOpen());
      check("11: 没写换版历史", readSwitchHistory(env).length === historyBefore, String(historyBefore));

      const st = io();
      await run(["status"], NEW, st);
      check("11: status 说清当时那一份没打标、要重跑 wait",
        st.out.join("").includes("没有可核对的基准"), st.out.join(""));

      // 两边都没打标：只叫人「装一个打过标的版本」是半句话——装完基准还是 null，
      // finish 第二道门照样拒，人得再跑一趟。
      const bothSt = io();
      await runUpgrade(["status", "--db", dbPath], { ...bothSt.opts, identity: unstampedIdentity });
      const both = bothSt.out.join("");
      check("11: 两边都没打标时说清这次暂停补不出基准",
        both.includes("这次暂停补不出基准") && both.includes("ans upgrade cancel"), both);
      check("11: 两边都没打标时不叫人去重跑一个注定写 null 的 wait",
        !both.includes("再重跑一次 ans upgrade wait 建基准"), both);

      // finish 说的是同一句话：两边共用 pauseOutcome，不能再出现「重跑 wait 建立
      // 一个打了标的基准」这种注定被拒的劝法。
      const bothFin = io();
      const bothCode = await runUpgrade(["finish", "--db", dbPath], { ...bothFin.opts, identity: unstampedIdentity });
      check("11: 两边都没打标时 finish 也拒", bothCode === 1, "code=" + bothCode);
      check("11: finish 和 status 说同一句（补不出基准）",
        bothFin.err.join("").includes("这次暂停补不出基准"), bothFin.err.join(""));
      check("11: finish 不再劝人重跑 wait 建基准",
        !bothFin.err.join("").includes("重跑一次 ans upgrade wait 建立一个打了标的基准"), bothFin.err.join(""));

      const cancel = io();
      const c = await run(["cancel"], NEW, cancel);
      check("11: cancel 退 0", c.code === 0, cancel.err.join(""));
    }

    // ---- 9. cancel 也清暂停记录，免得下次 finish 拿过期基准去比 -----------
    {
      const wait = io();
      await run(["wait", "--timeout", "2000"], NEW, wait);
      check("7: 又暂停了一次", existsSync(ansUpgradePausePath(env)));
      const cancel = io();
      const { code } = await run(["cancel"], NEW, cancel);
      check("7: cancel 退 0", code === 0, cancel.err.join(""));
      check("7: cancel 清掉了暂停记录", !existsSync(ansUpgradePausePath(env)));
      check("7: cancel 打开了准入", gateOpen());
    }

    resident.close();
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\nupgrade finish tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("upgrade finish test threw:", e);
  process.exit(1);
});
