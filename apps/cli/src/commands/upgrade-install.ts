// `ans upgrade install`：看旧的多包安装，给出可审阅的换法，按需执行。
//
// 单独一个模块，是因为它有两个入口：
//   - `ans upgrade install`（正常情况：新命令能用）；
//   - `node <包根>/dist/migrate-install.js`（新命令还用不了的时候——旧包的
//     `ans` 还占着名字、新包的 bin 还没链上，只能照路径直接跑这个文件）。
//
// 两个入口走同一段代码，说的就是同一件事；不各写一份。

import { resolve } from "node:path";
import { ansInstallMigrationsDir } from "@anysearch-cli/store/paths";
import {
  applyInstallPlan,
  describeInspection,
  inspectInstall,
  PRODUCT_PACKAGE,
  resolveNpmPrefix,
  type ApplyResult,
  type InstallInspection,
} from "../install-layout";

const HELP = `Usage: ans upgrade install [options]

看清楚这台机器上的全局安装是"一个完整产品"还是"旧的三包布局"，给出换法。

Options:
  --prefix <dir>   npm 全局前缀（默认问 npm：环境变量 npm_config_prefix，再不行 npm prefix -g）
  --apply          真的执行方案（卸掉旧布局的独立包）。不加就只是预览
  --json           机器可读输出
  --help, -h       显示这段说明

说明：本命令只处理全局安装里的 @anysearch-cli 包和它们占的命令名。
认不出归属的命令（你自己写的脚本、别的工具）一个都不动，报出来让你决定。
删包之前会把动手前的现场写进数据根下的 .install-migrations 文件夹（就在 ~/.ans/ 里面），
事后照着能查回来。
换完要重开终端和宿主：已经在跑的进程不会自己换代码。

Exit codes: 0 干净（或 --apply 成功） · 1 有要处理的东西 / 有认不出归属的命令 / 执行失败 · 2 用法错误
`;

export interface UpgradeInstallOptions {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  env?: NodeJS.ProcessEnv;
  /** 注入的命令执行器（测试用）。 */
  run?: (command: string, args: string[]) => { status: number | null; stdout: string; stderr: string };
  /** 注入的前缀解析（测试用），省得真去起 npm。 */
  resolvePrefix?: () => { prefix: string | null; source: string };
  now?: () => Date;
}

export async function runUpgradeInstall(
  args: string[],
  opts: UpgradeInstallOptions = {},
): Promise<number> {
  const out = opts.stdout ?? ((text: string) => process.stdout.write(text));
  const err = opts.stderr ?? ((text: string) => process.stderr.write(text));
  const env = opts.env ?? process.env;

  if (args.includes("--help") || args.includes("-h")) {
    out(HELP);
    return 0;
  }

  let prefixArg: string | undefined;
  let apply = false;
  let json = false;
  for (let at = 0; at < args.length; at++) {
    const arg = args[at]!;
    if (arg === "--apply") { apply = true; continue; }
    if (arg === "--json") { json = true; continue; }
    if (arg === "--prefix") {
      const next = args[at + 1];
      if (next === undefined || next.startsWith("--")) {
        err("ans upgrade install: --prefix 后面要跟一个目录\n");
        return 2;
      }
      prefixArg = next;
      at += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      err("ans upgrade install: 不认识的选项 " + arg + "\n");
      return 2;
    }
    err("ans upgrade install: 不接位置参数（收到 " + arg + "）\n");
    return 2;
  }

  let prefix: string | null;
  let prefixSource: string;
  if (prefixArg !== undefined) {
    prefix = resolve(prefixArg);
    prefixSource = "命令行 --prefix";
  } else if (opts.resolvePrefix) {
    const resolved = opts.resolvePrefix();
    prefix = resolved.prefix;
    prefixSource = resolved.source;
  } else {
    const resolved = resolveNpmPrefix({ env, ...(opts.run ? { run: opts.run } : {}) });
    prefix = resolved.prefix;
    prefixSource = resolved.source;
  }

  if (!prefix) {
    // 没有前缀就没法看清，更没法删。说清缺什么，别猜一个目录出来。
    err("ans upgrade install: 说不清 npm 的全局前缀（" + prefixSource + "）。" +
      "用 --prefix <目录> 直接指，或者先确认 npm 能跑\n");
    return 1;
  }

  let inspection: InstallInspection;
  try {
    inspection = inspectInstall(prefix, prefixSource);
  } catch (e) {
    err("ans upgrade install: 看不了 " + prefix + "（" + errText(e) + "）\n");
    return 1;
  }

  if (!apply) {
    if (json) {
      out(JSON.stringify({ applied: false, ...inspection }, null, 2) + "\n");
    } else {
      out(describeInspection(inspection));
      if (inspection.verdict === "legacy") {
        out("说明：这是预览，一个文件都没动。确认方案没问题就加 --apply 执行。\n");
      }
    }
    return inspection.verdict === "clean" ? 0 : 1;
  }

  // --apply：认不出归属就一个包都不删，这是 applyInstallPlan 的前置条件。
  if (inspection.verdict === "blocked" || inspection.verdict === "absent") {
    if (json) {
      out(JSON.stringify({ applied: false, ...inspection }, null, 2) + "\n");
    } else {
      out(describeInspection(inspection));
      out(inspection.verdict === "absent"
        ? "说明：这里没装过，没有可迁移的东西。装一次完整产品就有了。\n"
        : "说明：有命令认不出归属，这次一个包都没删。先看清上面那些命令是谁的。\n");
    }
    return 1;
  }

  let result: ApplyResult;
  try {
    result = applyInstallPlan(inspection, {
      recordDir: ansInstallMigrationsDir(env),
      ...(opts.run ? { run: opts.run } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    });
  } catch (e) {
    err("ans upgrade install: 没执行（" + errText(e) + "）\n");
    return 1;
  }

  const after = result.record.after;
  if (json) {
    out(JSON.stringify({
      applied: true,
      prefix: result.record.prefix,
      executed: result.record.executed,
      recordPath: result.recordPath,
      after,
      ...(result.failure ? { failure: result.failure } : {}),
    }, null, 2) + "\n");
    return result.failure ? 1 : 0;
  }

  if (result.record.executed.length === 0) {
    // 没卸包不等于"本来就都指向完整产品"：也可能是命令指着已经不在的旧包，
    // 只是没东西可删。那种局面下面会报"还有命令指着旧包"。
    const orphaned = inspection.commands.filter((c) => c.state === "legacy");
    out(orphaned.length === 0
      ? "没有要卸的旧包：命令本来就都指向完整产品。\n"
      : "没有要卸的旧包，但有 " + orphaned.length + " 个命令指着已经不在的旧包（见下面的方案）。\n");
  } else {
    for (const step of result.record.executed) {
      out("[执行] " + step.command + " → 退出码 " + String(step.status) + "\n");
    }
  }
  out("[恢复依据] 动手前的现场记在 " + result.recordPath + "（卸了哪些包、每个命令当时指向谁）\n");
  if (result.failure) {
    err("ans upgrade install: " + result.failure + "\n");
    err("旧包没卸干净，命令归属可能还混着。修好上面的错误再跑一次。\n");
    return 1;
  }
  if (after) out(describeInspection(after));
  // 卸完必须先看"还剩什么"，再说"换好了"。旧布局是完整的三个包时，卸完可能一个
  // 命令都不剩——那时说"换好了"是最糟的谎：用户以为装好了，其实 `ans` 已经没了。
  const productLeft = after?.packages.some((pkg) => pkg.name === PRODUCT_PACKAGE) ?? false;
  if (!productLeft) {
    err("[安装] 这个前缀里现在没有完整产品：旧包卸了，命令也跟着没了。先把它装上：" +
      "npm i -g " + PRODUCT_PACKAGE + "@latest\n");
    return 1;
  }
  const stillLegacy = after?.commands.filter((c) => c.state === "legacy") ?? [];
  if (stillLegacy.length > 0) {
    err("[安装] 还有命令指着旧包：" + stillLegacy.map((c) => c.name).join("、") +
      "。重装一次完整产品把名字收回来：npm i -g " + PRODUCT_PACKAGE + "@latest\n");
    return 1;
  }
  out("[安装] 换好了。重开终端和宿主：已经在跑的进程还执行着旧代码，重启或重连才会用上新版。\n");
  return 0;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
