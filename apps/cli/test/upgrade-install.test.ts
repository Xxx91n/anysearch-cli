// #311 — 旧的多包全局安装怎么看、怎么换，以及"认不出来就一个都别动"。
//
// 这里钉住的几件事：
//  1. 旧布局（三个包各装一次、命令指着旧包）能认出来，方案里给出要卸的包；
//  2. 干净布局（只有完整产品）不给删除步骤，退 0；
//  3. 命令指向认不出的东西时判 blocked，--apply 一个包都不删、一条命令都不执行；
//  4. --apply 先写恢复记录再删包，删完重新看一遍，并把"哪些命令还指着旧包"报出来；
//  5. 包没了只剩一条断链接（POSIX 符号链接形态）也要判 legacy，不能报"没装过"；
//  6. PRODUCT_COMMANDS 必须和 apps/cli/package.json 的 bin 一致。
//
// 全程离线：前缀是临时目录里搭出来的假安装，npm 是注入的假执行器。
//
// Run: pnpm --filter @anysearch-cli/cli test

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runUpgrade } from "../src/commands/upgrade";
import { runUpgradeInstall } from "../src/commands/upgrade-install";
import {
  applyInstallPlan,
  globalBinDir,
  inspectInstall,
  PRODUCT_COMMANDS,
  resolveNpmPrefix,
} from "../src/install-layout";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log("  PASS " + label); }
  else { failed++; console.error("  FAIL " + label + (detail ? ": " + detail : "")); }
}

const PRODUCT_BIN = {
  ans: "bin/ans.cjs",
  "ans-mcp": "bin/ans-mcp.cjs",
  "ans-plugin-server": "bin/ans-plugin-server.cjs",
  "ans-hook-claude": "bin/ans-hook-claude.cjs",
  "ans-hook-session-start": "bin/ans-hook-session-start.cjs",
  "ans-hook-codex": "bin/ans-hook-codex.cjs",
  "ans-hook-antigravity": "bin/ans-hook-antigravity.cjs",
  "ans-hook-codebuddy": "bin/ans-hook-codebuddy.cjs",
};

/** 在临时前缀里装一个假的全局包。 */
function installPackage(prefix: string, name: string, version: string, bin: Record<string, string>): void {
  const dir = join(prefix, "node_modules", ...name.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version, bin }, null, 2) + "\n", "utf8");
}

/**
 * 写一个命令 shim。用"脚本形态"写，两个平台都能读：
 * Windows 的 .cmd 和 POSIX 的 sh 脚本里都写着同一段 node_modules 路径。
 */
function writeShim(prefix: string, name: string, target: string): void {
  const dir = globalBinDir(prefix);
  mkdirSync(dir, { recursive: true });
  const file = process.platform === "win32" ? join(dir, name + ".cmd") : join(dir, name);
  writeFileSync(file, "#!/bin/sh\nexec node \"$(dirname \"$0\")/" + target + "\" \"$@\"\n", "utf8");
}

const productTarget = (entry: string): string => "node_modules/@anysearch-cli/cli/" + entry;
const legacyTarget = (entry: string): string => "node_modules/@anysearch-cli/mcp/" + entry;

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "ans-311-install-"));
  try {
    // ---- 1. 旧布局：三个包各装一次 ----------------------------------------
    {
      const prefix = join(root, "legacy-prefix");
      installPackage(prefix, "@anysearch-cli/cli", "0.2.0", PRODUCT_BIN);
      installPackage(prefix, "@anysearch-cli/mcp", "0.2.0", { "ans-mcp": "dist/index.js" });
      installPackage(prefix, "@anysearch-cli/plugin", "0.2.0", { "ans-plugin-server": "dist/server/index.cjs" });
      // 命令名谁赢看安装顺序：这里让 ans-mcp 还是旧包的。
      writeShim(prefix, "ans", productTarget("bin/ans.cjs"));
      writeShim(prefix, "ans-mcp", legacyTarget("dist/index.js"));
      writeShim(prefix, "ans-plugin-server", "node_modules/@anysearch-cli/plugin/dist/server/index.cjs");

      const inspection = inspectInstall(prefix, "测试");
      check("1: 旧布局判成 legacy", inspection.verdict === "legacy", inspection.verdict);
      const byName = (name: string) => inspection.commands.find((c) => c.name === name)!;
      check("1: ans 指向完整产品", byName("ans").state === "product" && byName("ans").version === "0.2.0");
      check("1: ans-mcp 指着旧包，被认出来是旧布局",
        byName("ans-mcp").state === "legacy" && byName("ans-mcp").packageName === "@anysearch-cli/mcp",
        JSON.stringify(byName("ans-mcp")));
      const removal = inspection.steps.find((step) => step.kind === "remove");
      check("1: 方案里给出要卸的两个旧包",
        removal?.command === "npm rm -g @anysearch-cli/mcp @anysearch-cli/plugin", removal?.command);
      check("1: 方案里提醒要重开终端和宿主",
        inspection.steps.some((step) => step.text.includes("重开终端和宿主")));
    }

    // ---- 2. 干净布局：只有一个完整产品 ------------------------------------
    {
      const prefix = join(root, "clean-prefix");
      installPackage(prefix, "@anysearch-cli/cli", "0.2.0", PRODUCT_BIN);
      for (const [name, entry] of Object.entries(PRODUCT_BIN)) {
        writeShim(prefix, name, productTarget(entry));
      }
      const inspection = inspectInstall(prefix, "测试");
      check("2: 干净布局判成 clean", inspection.verdict === "clean", inspection.verdict);
      check("2: 没有删除步骤", inspection.steps.every((step) => step.kind !== "remove"));
      check("2: 说清没有要迁移的东西",
        inspection.steps.some((step) => step.text.includes("没有要迁移的东西")));
    }

    // ---- 3. 认不出来的命令：一个都别动 ------------------------------------
    {
      const prefix = join(root, "unknown-prefix");
      installPackage(prefix, "@anysearch-cli/cli", "0.2.0", PRODUCT_BIN);
      writeShim(prefix, "ans", "node_modules/@anysearch-cli/cli/bin/ans.cjs");
      // 用户自己写的 ans，装到 PATH 更前面或者手工放进了全局 bin。
      writeShim(prefix, "ans-mcp", "opt/my-own-tool/run.sh");

      const inspection = inspectInstall(prefix, "测试");
      check("3: 有认不出的命令就判 blocked", inspection.verdict === "blocked", inspection.verdict);
      check("3: 说清那个命令认不出来",
        inspection.commands.find((c) => c.name === "ans-mcp")!.note.includes("认不出"));
      check("3: blocked 时方案里没有删除步骤", inspection.steps.every((step) => step.kind !== "remove"));

      let refused = false;
      try {
        applyInstallPlan(inspection, { recordDir: join(root, "records-unknown") });
      } catch (e) {
        refused = (e as Error).message.includes("一个包都没删");
      }
      check("3: apply 拒绝执行，并说明一个包都没删", refused);
      check("3: 拒绝时连恢复记录都没写", !existsSync(join(root, "records-unknown")));
    }

    // ---- 4. --apply：先写恢复记录，再删包，然后重新看 ----------------------
    {
      const prefix = join(root, "apply-prefix");
      installPackage(prefix, "@anysearch-cli/cli", "0.2.0", PRODUCT_BIN);
      installPackage(prefix, "@anysearch-cli/mcp", "0.2.0", { "ans-mcp": "dist/index.js" });
      writeShim(prefix, "ans", productTarget("bin/ans.cjs"));
      writeShim(prefix, "ans-mcp", legacyTarget("dist/index.js"));

      const calls: string[] = [];
      const env = { ...process.env, USERPROFILE: root, HOME: root };
      const io = () => {
        const out: string[] = [];
        const err: string[] = [];
        return {
          out, err,
          opts: {
            stdout: (t: string) => { out.push(t); },
            stderr: (t: string) => { err.push(t); },
            env,
            // 假 npm：真把旧包目录删掉，模拟 npm rm -g 的效果。
            run: (command: string, args: string[]) => {
              calls.push(command + " " + args.join(" "));
              rmSync(join(prefix, "node_modules", "@anysearch-cli", "mcp"), { recursive: true, force: true });
              rmSync(globalBinDir(prefix) + (process.platform === "win32" ? "\\ans-mcp.cmd" : "/ans-mcp"), { force: true });
              return { status: 0, stdout: "", stderr: "" };
            },
          },
        };
      };

      // 先预览：不执行任何东西，退 1（还有要处理的）。
      const preview = io();
      const previewCode = await runUpgradeInstall(["--prefix", prefix], preview.opts);
      check("4: 预览退 1（还有要处理的）", previewCode === 1, String(previewCode));
      check("4: 预览一条命令都没跑", calls.length === 0, calls.join(" | "));
      check("4: 预览说清这是预览", preview.out.join("").includes("这是预览"));

      const applied = io();
      const applyCode = await runUpgradeInstall(["--prefix", prefix, "--apply"], applied.opts);
      check("4: --apply 退 0", applyCode === 0, applied.err.join("") + applied.out.join(""));
      check("4: 只跑了一条 npm rm -g", calls.length === 1 && /^npm(\.cmd)? rm -g/.test(calls[0]!), calls.join(" | "));
      check("4: 卸掉的是旧包", calls[0]!.includes("@anysearch-cli/mcp"));

      const recordsDir = join(root, ".ans", ".install-migrations");
      const records = existsSync(recordsDir) ? readdirSync(recordsDir).filter((f) => f.endsWith(".json")) : [];
      check("4: 写了一份恢复记录", records.length === 1, records.join(","));
      if (records.length === 1) {
        const record = JSON.parse(readFileSync(join(recordsDir, records[0]!), "utf8")) as {
          before: { verdict: string; packages: Array<{ name: string }> };
          after: { verdict: string } | null;
          executed: Array<{ command: string; status: number | null }>;
        };
        check("4: 恢复记录里有动手前的现场",
          record.before.verdict === "legacy" && record.before.packages.some((p) => p.name === "@anysearch-cli/mcp"));
        check("4: 恢复记录里记了执行结果",
          record.executed.length === 1 && record.executed[0]!.status === 0);
        check("4: 恢复记录里记了动手之后的样子", record.after?.verdict === "clean",
          JSON.stringify(record.after?.verdict));
      }
      check("4: 报告里说清换完要重开", applied.out.join("").includes("重开终端和宿主"));
    }

    // ---- 5. 什么都没装：不替人装 -------------------------------------------
    {
      const prefix = join(root, "absent-prefix");
      mkdirSync(prefix, { recursive: true });
      const inspection = inspectInstall(prefix, "测试");
      check("5: 空前缀判成 absent", inspection.verdict === "absent", inspection.verdict);
      check("5: 给出安装命令但不自己装",
        inspection.steps.length === 1 && inspection.steps[0]!.kind === "install" &&
        inspection.steps[0]!.command === "npm i -g @anysearch-cli/cli@latest");
    }

    // ---- 6. 前缀从哪来：环境变量优先，问不出来就说问不出来 ----------------
    {
      const fromEnv = resolveNpmPrefix({ env: { npm_config_prefix: join(root, "from-env") } as NodeJS.ProcessEnv });
      check("6: 环境变量的前缀优先", fromEnv.prefix === join(root, "from-env") && fromEnv.source.includes("环境变量"),
        JSON.stringify(fromEnv));

      let asked = 0;
      const askedResult = resolveNpmPrefix({
        env: {} as NodeJS.ProcessEnv,
        run: () => { asked++; return { status: 0, stdout: join(root, "from-npm") + "\n", stderr: "" }; },
      });
      check("6: 环境里没有就问 npm prefix -g", asked === 1 && askedResult.prefix === join(root, "from-npm"),
        JSON.stringify(askedResult));

      const failed = resolveNpmPrefix({
        env: {} as NodeJS.ProcessEnv,
        run: () => ({ status: 1, stdout: "", stderr: "npm: not found" }),
      });
      check("6: 问不出来就返回 null，不猜目录", failed.prefix === null, JSON.stringify(failed));

      const io = () => {
        const out: string[] = [];
        const err: string[] = [];
        return {
          out, err,
          opts: {
            stdout: (t: string) => { out.push(t); },
            stderr: (t: string) => { err.push(t); },
            env: {} as NodeJS.ProcessEnv,
            resolvePrefix: () => ({ prefix: null, source: "问不到（npm prefix -g 没给出路径）" }),
          },
        };
      };
      const s = io();
      const code = await runUpgradeInstall([], s.opts);
      check("6: 前缀说不清时退 1 并让人用 --prefix", code === 1 && s.err.join("").includes("--prefix"),
        s.err.join(""));
    }
    // ---- 7. 包没了、shim 还指着它：不能报"换好了" -------------------------
    {
      const prefix = join(root, "orphan-prefix");
      installPackage(prefix, "@anysearch-cli/cli", "0.2.0", PRODUCT_BIN);
      writeShim(prefix, "ans", productTarget("bin/ans.cjs"));
      // 旧包早就卸了，命令名还指着它。
      writeShim(prefix, "ans-mcp", legacyTarget("dist/index.js"));

      const inspection = inspectInstall(prefix, "测试");
      check("7: 旧包不在但命令还指着它，判 legacy", inspection.verdict === "legacy", inspection.verdict);
      check("7: 方案里说清要重装一次把名字收回来",
        inspection.steps.some((step) => step.kind === "install" && step.text.includes("收回来")),
        JSON.stringify(inspection.steps));

      const calls: string[] = [];
      const s = { out: [] as string[], err: [] as string[] };
      const code = await runUpgradeInstall(["--prefix", prefix, "--apply"], {
        stdout: (t: string) => { s.out.push(t); },
        stderr: (t: string) => { s.err.push(t); },
        env: { ...process.env, USERPROFILE: root, HOME: root },
        run: (command: string, args: string[]) => {
          calls.push(command + " " + args.join(" "));
          return { status: 0, stdout: "", stderr: "" };
        },
      });
      check("7: 没有可删的包就不跑 npm", calls.length === 0, calls.join(" | "));
      check("7: 退 1 并说清还要重装", code === 1 && s.err.join("").includes("重装一次完整产品"),
        s.err.join("") + s.out.join(""));
    }

    // ---- 8. `ans upgrade install` 这条路真的通（--apply 不被当成陌生选项）----
    {
      const prefix = join(root, "dispatch-prefix");
      installPackage(prefix, "@anysearch-cli/cli", "0.2.0", PRODUCT_BIN);
      writeShim(prefix, "ans", productTarget("bin/ans.cjs"));
      const out: string[] = [];
      const err: string[] = [];
      const code = await runUpgrade(["install", "--prefix", prefix], {
        stdout: (t: string) => { out.push(t); },
        stderr: (t: string) => { err.push(t); },
        env: { ...process.env, USERPROFILE: root, HOME: root },
      });
      check("8: ans upgrade install 退 0（干净）", code === 0, err.join("") + out.join(""));
      check("8: 没有把 --prefix 当成陌生选项", !err.join("").includes("不认识的选项"), err.join(""));

      const applyOut: string[] = [];
      const applyErr: string[] = [];
      const applyCode = await runUpgrade(["install", "--prefix", prefix, "--apply"], {
        stdout: (t: string) => { applyOut.push(t); },
        stderr: (t: string) => { applyErr.push(t); },
        env: { ...process.env, USERPROFILE: root, HOME: root },
      });
      check("8: --apply 也认得", !applyErr.join("").includes("不认识的选项") && applyCode === 0,
        applyErr.join("") + applyOut.join(""));
    }
    // ---- 9. 不抢命令名的包不删（比如 dsh 插件：一个 bin 都没有）----------
    {
      const prefix = join(root, "nobin-prefix");
      installPackage(prefix, "@anysearch-cli/cli", "0.2.0", PRODUCT_BIN);
      installPackage(prefix, "@anysearch-cli/dsh-plugin", "0.2.0", {});
      writeShim(prefix, "ans", productTarget("bin/ans.cjs"));

      const inspection = inspectInstall(prefix, "测试");
      check("9: 只有不占命令名的包时判 clean", inspection.verdict === "clean", inspection.verdict);
      check("9: 方案里没有要卸它的步骤",
        inspection.steps.every((step) => step.kind !== "remove" || !step.command?.includes("dsh-plugin")),
        JSON.stringify(inspection.steps));

      const calls: string[] = [];
      const s = { out: [] as string[], err: [] as string[] };
      const code = await runUpgradeInstall(["--prefix", prefix, "--apply"], {
        stdout: (t: string) => { s.out.push(t); },
        stderr: (t: string) => { s.err.push(t); },
        env: { ...process.env, USERPROFILE: root, HOME: root },
        run: (command: string, args: string[]) => {
          calls.push(command + " " + args.join(" "));
          return { status: 0, stdout: "", stderr: "" };
        },
      });
      check("9: --apply 不会去删一个不抢命令名的包", calls.length === 0 && code === 0,
        calls.join(" | ") + s.err.join(""));
      check("9: 那个包还在", existsSync(join(prefix, "node_modules", "@anysearch-cli", "dsh-plugin")));
    }
    // ---- 10. 只有旧包、没有完整产品：卸完不能报"换好了" -------------------
    {
      const prefix = join(root, "no-product-prefix");
      // 旧布局装齐了，完整产品从来没装过。
      installPackage(prefix, "@anysearch-cli/mcp", "0.2.0", { "ans-mcp": "dist/index.js" });
      installPackage(prefix, "@anysearch-cli/plugin", "0.2.0", { "ans-plugin-server": "dist/server/index.cjs" });
      writeShim(prefix, "ans-mcp", legacyTarget("dist/index.js"));
      writeShim(prefix, "ans-plugin-server", "node_modules/@anysearch-cli/plugin/dist/server/index.cjs");

      const inspection = inspectInstall(prefix, "测试");
      check("10: 有旧包没产品，判 legacy", inspection.verdict === "legacy", inspection.verdict);
      check("10: 预览就说要先装产品",
        inspection.steps.some((step) => step.kind === "install" && step.text.includes("先把产品装上")),
        JSON.stringify(inspection.steps));

      const s = { out: [] as string[], err: [] as string[] };
      const code = await runUpgradeInstall(["--prefix", prefix, "--apply"], {
        stdout: (t: string) => { s.out.push(t); },
        stderr: (t: string) => { s.err.push(t); },
        env: { ...process.env, USERPROFILE: root, HOME: root },
        run: (command: string, args: string[]) => {
          // 真把旧包删掉，模拟 npm rm -g 的效果。
          for (const name of args.slice(2)) {
            rmSync(join(prefix, "node_modules", ...name.split("/")), { recursive: true, force: true });
          }
          return { status: 0, stdout: "", stderr: "" };
        },
      });
      check("10: 卸完没有产品时退 1", code === 1, s.out.join("") + s.err.join(""));
      check("10: 说清现在一个命令都不剩，要装产品",
        s.err.join("").includes("现在没有完整产品") && s.err.join("").includes("npm i -g"),
        s.err.join(""));
      check("10: 没有说换好了", !s.out.join("").includes("换好了"), s.out.join(""));
    }

    // ---- 11. 空前缀里躺着别人的 ans：不能建议覆盖它 -----------------------
    {
      const prefix = join(root, "foreign-prefix");
      mkdirSync(prefix, { recursive: true });
      writeShim(prefix, "ans", "opt/someone-elses/ans");

      const inspection = inspectInstall(prefix, "测试");
      check("11: 没有本产品的包，但有别人的 ans → blocked", inspection.verdict === "blocked", inspection.verdict);
      check("11: 不给安装建议（那会覆盖别人的命令）",
        inspection.steps.every((step) => step.kind !== "install"), JSON.stringify(inspection.steps));

      const s = { out: [] as string[], err: [] as string[] };
      const code = await runUpgradeInstall(["--prefix", prefix, "--apply"], {
        stdout: (t: string) => { s.out.push(t); },
        stderr: (t: string) => { s.err.push(t); },
        env: { ...process.env, USERPROFILE: root, HOME: root },
      });
      check("11: --apply 拒绝动手", code === 1 && s.out.join("").includes("一个包都没删"),
        s.out.join("") + s.err.join(""));
    }
    // ---- 12. 断链接：包没了、符号链接还在（POSIX 的 shim 形态）----------
    //
    // existsSync 跟着链接走，断链会被当成"没有这个命令"——那样一个空目录加上一条
    // 死链接就报"这里没装过"，而那条链接还占着命令名。Windows 建符号链接要权限，
    // 建不出来就跳过并说明原因，不假装验过。
    const prefix = join(root, "dangling-prefix");
    const bin = join(root, "dangling-prefix", process.platform === "win32" ? "" : "bin");
    let canLink = true;
    try {
      mkdirSync(bin, { recursive: true });
      symlinkSync(join(prefix, "node_modules", "@anysearch-cli", "mcp", "dist", "index.js"),
        join(bin, "ans-mcp"));
    } catch {
      canLink = false;
      console.log("  SKIP 12: 断链接（这台机器建不了符号链接）");
    }
    if (canLink) {
      const inspection = inspectInstall(prefix, "测试");
      check("12: 一个产品包都没有、但有一条断链接 → legacy", inspection.verdict === "legacy",
        inspection.verdict);
      const dangling = inspection.commands.find((c) => c.name === "ans-mcp")!;
      check("12: 认得出它指的是哪个旧包", dangling.state === "legacy" && dangling.packageName === "@anysearch-cli/mcp",
        JSON.stringify(dangling));
      check("12: 方案里说这批命令指着已经不在的旧包、要装一次产品",
        inspection.steps.some((step) => step.kind === "install" &&
          step.text.includes("已经不在的旧包") && step.text.includes("ans-mcp") &&
          step.command?.includes("npm i -g")),
        JSON.stringify(inspection.steps));
    }

    // ---- 13. 命令没有 shim（产品装着，但 bin 里少几个）：说出来 -------------
    {
      const prefix = join(root, "shimless-prefix");
      installPackage(prefix, "@anysearch-cli/cli", "0.2.0", PRODUCT_BIN);
      writeShim(prefix, "ans", productTarget("bin/ans.cjs"));

      const inspection = inspectInstall(prefix, "测试");
      check("13: 所有权都对就还是 clean", inspection.verdict === "clean", inspection.verdict);
      check("13: 但要说清哪些命令没有 shim",
        inspection.steps.some((step) => step.kind === "note" && step.text.includes("找不到 shim")),
        JSON.stringify(inspection.steps));
      check("13: clean 而且什么都没换时，不叫人重开终端",
        !inspection.steps.some((step) => step.text.includes("重开终端和宿主")),
        JSON.stringify(inspection.steps));
    }

    // ---- 14. PRODUCT_COMMANDS 不能和 package.json 的 bin 漂开 --------------
    //
    // 这份清单决定"哪些名字归产品"：完整产品没装时靠它算要删谁，重装提示也靠它。
    // package.json 加了钩子命令、这里没跟上的话，少收一个名字，还不报错。
    {
      const manifest = JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      ) as { bin: Record<string, string> };
      const fromManifest = Object.keys(manifest.bin).sort();
      const fromCode = [...PRODUCT_COMMANDS].sort();
      check("14: PRODUCT_COMMANDS 和 package.json 的 bin 一致",
        JSON.stringify(fromCode) === JSON.stringify(fromManifest),
        "代码里：" + fromCode.join(",") + " / package.json：" + fromManifest.join(","));
    }
  } finally {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\nupgrade install tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("upgrade install test threw:", e);
  process.exit(1);
});
