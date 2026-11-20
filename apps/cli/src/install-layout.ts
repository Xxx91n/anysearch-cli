// #311: 旧的多包安装怎么看、怎么换成一个完整产品。
//
// 背景：0.2.0 以前是三个全局包各装一次（`@anysearch-cli/cli`、
// `@anysearch-cli/mcp`、`@anysearch-cli/plugin`），三个包都往同一个
// 全局 bin 目录里写命令。`ans-mcp`、`ans-plugin-server`、几个钩子命令的名字
// 被两个包同时声明，谁最后装谁赢——于是"装的是哪个版本"和"命令实际指向哪个包"
// 可以不一致。现在只有一个完整产品包，这些名字都由它提供。
//
// 这个模块只做三件事：看清楚（谁装着、命令指向谁）、给出可审阅的方案、按方案
// 执行。看清楚和执行分开是有意的——删全局包是对机器动手，必须先让人看见。
//
// 不碰的三种情况：
//   - 命令指向的东西认不出是哪个产品包（用户自己写的 `ans` 脚本、别的工具）：
//     报出来，一个文件都不动。
//   - 同一个命令被两个产品包同时声明，而 bin 里没有 shim 能定案：报冲突，
//     不动。
//   - 旧包里没有产品包：只报"这里没有装过"，不替人装。
//
// 只用 node 内置模块：这个模块会被编译成可以单独 `node dist/migrate-install.js`
// 跑的入口，那条路必须在全局命令坏掉的时候也能走通（新包的 bin 还没链接上、
// 旧包的 `ans` 还占着名字），所以它不能依赖任何别的东西。

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** 这个产品提供（提供过）的命令名。看 bin 之前先用它兜底，免得"没装"等于"没看过"。 */
export const PRODUCT_COMMANDS = [
  "ans",
  "ans-mcp",
  "ans-plugin-server",
  "ans-hook-claude",
  "ans-hook-session-start",
  "ans-hook-codex",
  "ans-hook-antigravity",
  "ans-hook-codebuddy",
];

/** 完整产品的包名：只有一个包，全部命令都该来自它。 */
export const PRODUCT_PACKAGE = "@anysearch-cli/cli";

/** 一条命令现在归谁。 */
export type CommandOwnerState =
  /** 指向完整产品。 */
  | "product"
  /** 指向旧布局里的另一个包。 */
  | "legacy"
  /** 两个包都声明了这个名字，bin 里没有能定案的 shim。 */
  | "conflict"
  /** 有个东西占着这个名字，但认不出是哪个产品包。 */
  | "unknown"
  /** 这个名字没装。 */
  | "missing";

export interface CommandOwnership {
  name: string;
  state: CommandOwnerState;
  /** 认出来的包名。 */
  packageName: string | null;
  /** 那个包的版本（读得到才填）。 */
  version: string | null;
  /** shim 指向的路径（认得出来才填）。 */
  target: string | null;
  /** 为什么是这个判定，一句话。 */
  note: string;
}

export interface InstalledProductPackage {
  name: string;
  version: string;
  binNames: string[];
}

/** 一个待办动作。`note` 只是说明，没有可执行的命令。 */
export interface InstallStep {
  kind: "remove" | "install" | "note";
  text: string;
  /** 真要执行时敲的命令；note 没有。 */
  command?: string;
}

export type InstallVerdict =
  /** 这个前缀里一个产品包都没有。 */
  | "absent"
  /** 只有一个完整产品，命令都指向它。 */
  | "clean"
  /** 旧包还在，或者命令还指着旧包。可以按方案换掉。 */
  | "legacy"
  /** 有认不出来或定不了的命令。什么都别动。 */
  | "blocked";

export interface InstallInspection {
  /** npm 的全局前缀。 */
  prefix: string;
  /** 全局 node_modules 里属于这个产品的包。 */
  packages: InstalledProductPackage[];
  /** 每个命令的归属。 */
  commands: CommandOwnership[];
  /** 要卸掉的旧包名。方案和执行都读这一份，不各算一次。 */
  removals: string[];
  verdict: InstallVerdict;
  steps: InstallStep[];
  /** 前缀是怎么来的（环境变量 / 问 npm / 调用方给的），报告里要说清。 */
  prefixSource: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 全局 node_modules 在哪：Windows 在前缀下，POSIX 在前缀的 lib 下。 */
export function globalNodeModules(prefix: string): string {
  const direct = join(prefix, "node_modules");
  if (existsSync(direct)) return direct;
  const lib = join(prefix, "lib", "node_modules");
  if (existsSync(lib)) return lib;
  return process.platform === "win32" ? direct : lib;
}

/** 全局命令 shim 在哪。 */
export function globalBinDir(prefix: string): string {
  return process.platform === "win32" ? prefix : join(prefix, "bin");
}

/**
 * 问 npm 全局前缀是什么。
 *
 * 先看环境变量：npm 和 corepack 都认 `npm_config_prefix`，容器和 CI 里常见。
 * 都没有才去问 npm 自己——这一步会起一个进程，所以只在真需要的时候做。
 * 问不出来就返回 null，让调用方报"说不清前缀"，而不是猜一个目录然后删东西。
 */
export function resolveNpmPrefix(opts: {
  env?: NodeJS.ProcessEnv;
  run?: (command: string, args: string[]) => { status: number | null; stdout: string; stderr: string };
} = {}): { prefix: string | null; source: string } {
  const env = opts.env ?? process.env;
  const fromEnv = (env.npm_config_prefix || env.NPM_CONFIG_PREFIX || "").trim();
  if (fromEnv) return { prefix: resolve(fromEnv), source: "环境变量 npm_config_prefix" };
  const run = opts.run ?? defaultRun;
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = run(npm, ["prefix", "-g"]);
  const text = (result.stdout || "").trim();
  if (result.status !== 0 || !text) {
    return { prefix: null, source: "问不到（npm prefix -g 没给出路径）" };
  }
  return { prefix: resolve(text.split(/\r?\n/).pop()!.trim()), source: "npm prefix -g" };
}

function defaultRun(command: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    // Windows 上 npm 是个 .cmd，node 不能直接执行它；别的平台不要 shell，
    // 免得参数被再解释一遍。
    shell: process.platform === "win32",
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * 能被本命令管理的包名形状。
 *
 * 这些名字会被拼进 `npm rm -g`，而 Windows 上 spawnSync 开了 shell（npm 是 .cmd），
 * 参数交给 cmd.exe 再解释一遍：名字里带 `&`、`|`、`^` 就成了命令分隔符。名字来自
 * node_modules 里的 package.json，不是代码里的常量，所以在入口就把形状钉死。
 */
const MANAGED_PACKAGE_NAME = /^@anysearch-cli\/[a-z0-9][a-z0-9._-]*$/;

/** 读一个包的 name/version/bin，读不出来（或名字不是本 scope 的形状）就是 null。 */
function readPackageManifest(dir: string): InstalledProductPackage | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof parsed.name !== "string" || !MANAGED_PACKAGE_NAME.test(parsed.name)) return null;
  if (typeof parsed.version !== "string") return null;
  const bin = parsed.bin;
  const binNames = typeof bin === "string"
    ? [parsed.name.split("/").pop() ?? parsed.name]
    : typeof bin === "object" && bin !== null ? Object.keys(bin) : [];
  return { name: parsed.name, version: parsed.version, binNames };
}

/**
 * 全局 node_modules 里属于本产品的包，按名字排序。
 *
 * 只看 `@anysearch-cli/*` 这一层：产品不会装在别的 scope 下，多扫一遍只会让
 * 报告里混进无关的东西。
 */
export function installedProductPackages(prefix: string): InstalledProductPackage[] {
  const scopeDir = join(globalNodeModules(prefix), "@anysearch-cli");
  let names: string[];
  try {
    names = readdirSync(scopeDir);
  } catch {
    return [];
  }
  const found: InstalledProductPackage[] = [];
  for (const name of names.sort()) {
    const manifest = readPackageManifest(join(scopeDir, name));
    if (manifest) found.push(manifest);
  }
  return found;
}

/**
 * 从一段路径或 shim 内容里认出产品包名。
 *
 * 一个正则两处用：符号链接的目标是一段路径，Windows 的 .cmd 是一段脚本，包名
 * 在两处的写法一样。两份正则会慢慢长得不一样，最后一份认得出、另一份认不出。
 */
const PACKAGE_IN_PATH = /node_modules[\\/]@anysearch-cli[\\/]([^\\/"'\s]+)/;

function packageNameIn(text: string): string | null {
  const match = text.match(PACKAGE_IN_PATH);
  return match ? "@anysearch-cli/" + match[1] : null;
}

interface ShimReading {
  /** 认出来的包名。 */
  packageName: string | null;
  /** shim 最终指向的路径。 */
  target: string | null;
  /** shim 是怎么写的：符号链接 / 脚本 / 读不出来。 */
  kind: "symlink" | "script" | "unreadable";
}

/**
 * 读一个全局命令 shim，认出它指向哪个包。
 *
 * POSIX 上 npm 建的是符号链接，直接读文件会读到被链接的 .cjs 内容——那里没有
 * 包路径，只会误判成"认不出"。所以先看它是不是链接，是就把链接目标当答案。
 * Windows 上是一个 .cmd 批处理，包路径写在里面，用正则捞。
 */
function readShim(shimPath: string): ShimReading {
  try {
    const stat = lstatSync(shimPath);
    if (stat.isSymbolicLink()) {
      const target = resolve(dirname(shimPath), readlinkSync(shimPath));
      return { packageName: packageNameIn(target), target, kind: "symlink" };
    }
  } catch {
    return { packageName: null, target: null, kind: "unreadable" };
  }
  let content: string;
  try {
    content = readFileSync(shimPath, "utf8");
  } catch {
    return { packageName: null, target: null, kind: "unreadable" };
  }
  const match = content.match(PACKAGE_IN_PATH);
  return {
    packageName: packageNameIn(content),
    target: match ? match[0] : null,
    kind: "script",
  };
}

/** 一个命令名在这台机器上可能的 shim 路径，按该平台的优先级排。 */
function shimCandidates(prefix: string, name: string): string[] {
  const bin = globalBinDir(prefix);
  if (process.platform === "win32") {
    return [join(bin, name + ".cmd"), join(bin, name), join(bin, name + ".ps1")];
  }
  return [join(bin, name)];
}

function packageVersion(packages: InstalledProductPackage[], name: string): string | null {
  return packages.find((pkg) => pkg.name === name)?.version ?? null;
}

/** 认出来的包是不是"完整产品"。 */
function isProductPackage(name: string): boolean {
  return name === PRODUCT_PACKAGE;
}

/**
 * 哪些旧包真的在抢命令名。
 *
 * 只认"声明的 bin 里有完整产品也提供的名字"这一种。一个 @anysearch-cli 包如果
 * 一个命令都不占（比如 dsh 插件），它和完整产品没有冲突，删它只会破坏别人的
 * 宿主接入——那不是迁移，那是越界。
 */
function conflictingPackages(packages: InstalledProductPackage[]): InstalledProductPackage[] {
  const productBins = new Set(
    packages.filter((pkg) => isProductPackage(pkg.name)).flatMap((pkg) => pkg.binNames),
  );
  const claimed = productBins.size > 0 ? productBins : new Set(PRODUCT_COMMANDS);
  return packages.filter((pkg) =>
    !isProductPackage(pkg.name) && pkg.binNames.some((binName) => claimed.has(binName)));
}

/**
 * 看一遍这个前缀：谁装着、每个命令归谁、能不能按方案换掉。
 *
 * 纯读：不写文件、不删包、不起 npm。执行是 {@link applyInstallPlan} 的事。
 */
export function inspectInstall(prefix: string, prefixSource = "调用方指定"): InstallInspection {
  const packages = installedProductPackages(prefix);
  const declared = new Map<string, string[]>();
  for (const pkg of packages) {
    for (const binName of pkg.binNames) {
      const owners = declared.get(binName) ?? [];
      owners.push(pkg.name);
      declared.set(binName, owners);
    }
  }
  // 命令清单 = 产品历来提供的名字 ∪ 这里实际声明了的名字。用并集是为了
  // 让"旧包装着但命令被别的包抢走"这种局面也出现在报告里。
  const names = [...new Set([...PRODUCT_COMMANDS, ...declared.keys()])].sort();
  const commands = names.map((name) => ownershipOf(prefix, name, packages, declared.get(name) ?? []));
  const removals = conflictingPackages(packages).map((pkg) => pkg.name);
  const verdict = verdictOf(packages, commands, removals);
  return {
    prefix,
    packages,
    commands,
    removals,
    verdict,
    steps: planSteps(verdict, packages, commands, removals),
    prefixSource,
  };
}

/**
 * shim 在不在。用 lstat 而不是 existsSync：后者跟着符号链接走，一条指向已经卸掉的
 * 旧包的链接会被当成"没有这个命令"，报告就成了 clean。
 */
function shimExists(shimPath: string): boolean {
  try {
    lstatSync(shimPath);
    return true;
  } catch {
    return false;
  }
}

function ownershipOf(
  prefix: string,
  name: string,
  packages: InstalledProductPackage[],
  declarers: string[],
): CommandOwnership {
  for (const shim of shimCandidates(prefix, name)) {
    if (!shimExists(shim)) continue;
    const reading = readShim(shim);
    if (reading.kind === "unreadable") {
      return {
        name, state: "unknown", packageName: null, version: null, target: shim,
        note: shim + " 读不出来，认不出这个命令归谁",
      };
    }
    if (reading.packageName === null) {
      return {
        name, state: "unknown", packageName: null, version: null, target: reading.target ?? shim,
        note: shim + " 指向的东西认不出是哪个产品包（可能是别处装的、或你自己写的脚本）",
      };
    }
    const product = isProductPackage(reading.packageName);
    return {
      name,
      state: product ? "product" : "legacy",
      packageName: reading.packageName,
      version: packageVersion(packages, reading.packageName),
      target: reading.target,
      note: product
        ? shim + " 指向完整产品"
        : shim + " 还指向旧布局里的 " + reading.packageName,
    };
  }
  if (declarers.length === 0) {
    return { name, state: "missing", packageName: null, version: null, target: null, note: "这个前缀里没装" };
  }
  if (declarers.length > 1) {
    return {
      name, state: "conflict", packageName: null, version: null, target: null,
      note: "找得到命令但没有 shim 能定案，" + declarers.join(" 和 ") + " 都声明了这个名字",
    };
  }
  const only = declarers[0]!;
  return {
    name,
    state: isProductPackage(only) ? "product" : "legacy",
    packageName: only,
    version: packageVersion(packages, only),
    target: null,
    note: "shim 没找到，但 " + only + " 声明了这个命令",
  };
}

function verdictOf(
  packages: InstalledProductPackage[],
  commands: CommandOwnership[],
  removals: string[],
): InstallVerdict {
  // 认不出归属排在"没装过"前面：一个空前缀里躺着一个别人的 `ans`，说"这里没装过"
  // 再建议 `npm i -g`，等于建议覆盖它。归属说不清就该停下来说清楚。
  if (commands.some((c) => c.state === "unknown" || c.state === "conflict")) return "blocked";
  // 包已经卸了、shim 还指着它：一个产品包都没有也得报 legacy。报"这里没装过"等于
  // 说"没什么要处理的"，而那条死链接还占着命令名。
  if (commands.some((c) => c.state === "legacy")) return "legacy";
  if (packages.length === 0) return "absent";
  return removals.length > 0 ? "legacy" : "clean";
}

/**
 * 按判定给出方案。方案是给人看的，不是给人猜的：每一步都写成一句能读懂的
 * 话，要动手的那步把命令原样写出来。
 *
 * `blocked` 不给删除步骤，也不给安装步骤。认不出归属就先别动——把别人的 `ans`
 * 删掉，或者建议一次会覆盖它的安装，比留着一份旧安装糟得多。
 */
function planSteps(
  verdict: InstallVerdict,
  packages: InstalledProductPackage[],
  commands: CommandOwnership[],
  removals: string[],
): InstallStep[] {
  const steps: InstallStep[] = [];
  const installStep = (text: string): InstallStep => ({
    kind: "install",
    text,
    command: "npm i -g " + PRODUCT_PACKAGE + "@latest",
  });
  const conflicts = commands.filter((c) => c.state === "unknown" || c.state === "conflict");

  if (verdict === "blocked") {
    for (const conflict of conflicts) {
      steps.push({ kind: "note", text: "`" + conflict.name + "` 不动：" + conflict.note });
    }
    steps.push({
      kind: "note",
      text: "归属说不清就一个包都不删，也不建议装：先弄清上面这些命令是谁的",
    });
    return steps;
  }

  if (verdict === "absent") {
    steps.push(installStep("这个前缀里还没装过这个产品：装一次完整产品就有了"));
    return steps;
  }

  if (removals.length > 0) {
    steps.push({
      kind: "remove",
      text: "卸掉旧布局里的独立包（" + removals.map((name) => name + "@" + (packageVersion(packages, name) ?? "?")).join("、") +
        "）：它们和完整产品抢同一批命令名，留着谁赢看安装顺序",
      command: "npm rm -g " + removals.join(" "),
    });
  }
  // 包已经卸了、shim 还指着它（版本读不到就是那个包不在了）：没有可删的东西，
  // 只有名字要收回来。一个包都没删也要重装一次，否则预览像"没什么要做的"，
  // 问题到 --apply 之后才冒出来。
  const product = packages.find((pkg) => isProductPackage(pkg.name));
  const legacy = commands.filter((c) => c.state === "legacy");
  const reclaimable = legacy.filter((c) => c.version === null && PRODUCT_COMMANDS.includes(c.name));
  if (product === undefined || (removals.length === 0 && reclaimable.length > 0)) {
    const reasons: string[] = [];
    if (product === undefined) reasons.push("完整产品不在这个前缀里");
    if (reclaimable.length > 0) {
      reasons.push("这些命令还指着已经不在的旧包（" + reclaimable.map((c) => c.name).join("、") + "）");
    }
    steps.push(installStep(reasons.join("，") + "：" + (product === undefined
      ? "先把产品装上，命令才有着落"
      : "重装一次完整产品把名字收回来")));
  }
  for (const orphan of legacy.filter((c) => !PRODUCT_COMMANDS.includes(c.name))) {
    steps.push({
      kind: "note",
      text: "`" + orphan.name + "` 不动：它指向 " + (orphan.packageName ?? "别的包") +
        "，完整产品不提供这个名字，本命令不替你决定它的去留",
    });
  }
  for (const conflict of conflicts) {
    steps.push({
      kind: "note",
      text: "`" + conflict.name + "` 不动：" + conflict.note,
    });
  }
  // 产品装着但 bin 里没有 shim：所有权都对，判定是 clean，可这几个名字敲不出来。
  // 不说清楚的话，--apply 会退 0 并说"换好了"。
  const shimless = commands.filter((c) => c.state === "product" && c.target === null);
  if (shimless.length > 0) {
    steps.push({
      kind: "note",
      text: "这些命令归完整产品，但 bin 里找不到 shim（" + shimless.map((c) => c.name).join("、") +
        "）：重装一次完整产品才敲得出来",
    });
  }
  if (verdict === "clean") {
    steps.push({ kind: "note", text: "命令都指向完整产品，没有要迁移的东西" });
  }
  // 一个文件都没换，就别叫人重开终端。
  if (removals.length > 0 || reclaimable.length > 0) {
    steps.push({
      kind: "note",
      text: "换完重开终端和宿主：已经在跑的进程还执行着旧代码，重启或重连才会用上新版",
    });
  }
  return steps;
}

/** 一次迁移的现场：动手之前先把这些写进文件，事后能照着恢复。 */
export interface InstallMigrationRecord {
  version: 1;
  at: string;
  prefix: string;
  prefixSource: string;
  verdict: InstallVerdict;
  /** 动手之前的完整读数。 */
  before: InstallInspection;
  /** 实际执行的命令。 */
  executed: Array<{ command: string; status: number | null; stderr: string }>;
  /** 动手之后的读数。没跑起来就是 null。 */
  after: InstallInspection | null;
}

export interface ApplyOptions {
  /** 恢复记录放哪：调用方给 `ansInstallMigrationsDir()`，即 `<数据根>/.install-migrations`。 */
  recordDir: string;
  /** 注入的命令执行器（测试用），默认 spawnSync。 */
  run?: (command: string, args: string[]) => { status: number | null; stdout: string; stderr: string };
  now?: () => Date;
}

export interface ApplyResult {
  record: InstallMigrationRecord;
  recordPath: string;
  /** 执行失败的原因；成功时没有。 */
  failure?: string;
}

/**
 * 按方案执行：先写恢复记录，再删旧包，然后重新看一遍。
 *
 * 只删方案里列出来的包。`blocked` 一律拒绝执行——命令归属认不出来的时候，
 * 任何删除都是在赌。写记录失败也不执行：删了包却没有"删之前是什么样"的存档，
 * 事后没人能说清原本装着什么。
 */
export function applyInstallPlan(
  inspection: InstallInspection,
  opts: ApplyOptions,
): ApplyResult {
  const now = opts.now ?? (() => new Date());
  const at = now().toISOString();
  if (inspection.verdict === "blocked") {
    throw new Error(
      "有命令认不出归属或归属定不下来，这次一个包都没删：" +
      inspection.commands
        .filter((c) => c.state === "unknown" || c.state === "conflict")
        .map((c) => c.name + "（" + c.note + "）")
        .join("；"),
    );
  }
  const removals = inspection.removals;
  const record: InstallMigrationRecord = {
    version: 1,
    at,
    prefix: inspection.prefix,
    prefixSource: inspection.prefixSource,
    verdict: inspection.verdict,
    before: inspection,
    executed: [],
    after: null,
  };
  const recordPath = join(opts.recordDir, at.replace(/[:.]/g, "-") + ".json");
  try {
    writeRecord(recordPath, record);
  } catch (error) {
    throw new Error("写不进恢复记录 " + recordPath + "（" + errorText(error) + "）——一个包都没删", { cause: error });
  }

  const run = opts.run ?? defaultRun;
  if (removals.length > 0) {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = run(npm, ["rm", "-g", ...removals]);
    record.executed.push({
      command: "npm rm -g " + removals.join(" "),
      status: result.status,
      stderr: result.stderr ?? "",
    });
  }
  record.after = inspectInstall(inspection.prefix, inspection.prefixSource);
  try {
    writeRecord(recordPath, record);
  } catch (error) {
    // 包已经按方案处理过了：这里只能报"事后读数没落盘"，不能假装什么都没发生。
    return {
      record,
      recordPath,
      failure: "包已经按方案处理过，但事后读数写不进恢复记录（" + errorText(error) + "）",
    };
  }
  const failed = record.executed.find((step) => step.status !== 0);
  if (failed) {
    return {
      record,
      recordPath,
      failure: failed.command + " 没跑通（退出码 " + String(failed.status) + "）" +
        (failed.stderr.trim() ? "：" + failed.stderr.trim().split(/\r?\n/).slice(-3).join(" / ") : ""),
    };
  }
  return { record, recordPath };
}

function writeRecord(path: string, record: InstallMigrationRecord): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = path + "." + process.pid + ".tmp";
  writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}


/** 人读的一段报告。 */
export function describeInspection(inspection: InstallInspection): string {
  const lines: string[] = [];
  lines.push("[安装] npm 全局前缀：" + inspection.prefix + "（来源：" + inspection.prefixSource + "）");
  if (inspection.packages.length === 0) {
    lines.push("[安装] 这个前缀里没有任何 @anysearch-cli 包");
  } else {
    lines.push("[安装] 装着的产品包：");
    for (const pkg of inspection.packages) {
      lines.push("  - " + pkg.name + "@" + pkg.version + (isProductPackage(pkg.name) ? "（完整产品）" : "（旧布局的独立包）"));
    }
  }
  const interesting = inspection.commands.filter((c) => c.state !== "missing");
  if (interesting.length > 0) {
    lines.push("[命令] 每个名字现在指向谁：");
    for (const command of interesting) {
      const mark = command.state === "product" ? "✓" : "!";
      lines.push("  " + mark + " " + command.name + " → " + (command.packageName ?? "认不出") +
        (command.version ? "@" + command.version : "") + "：" + command.note);
    }
  }
  lines.push("[判定] " + describeVerdict(inspection.verdict));
  if (inspection.steps.length > 0) {
    lines.push("[方案]");
    for (const step of inspection.steps) {
      lines.push("  - " + step.text + (step.command ? "：" + step.command : ""));
    }
  }
  return lines.join("\n") + "\n";
}

function describeVerdict(verdict: InstallVerdict): string {
  switch (verdict) {
    case "absent": return "这里没装过这个产品";
    case "clean": return "干净：只有一个完整产品，命令都指向它";
    case "legacy": return "旧布局：旧包还在，或者命令还指着旧包，可以按下面的方案换掉";
    case "blocked": return "有命令认不出归属，一个包都别动，先看清这些命令是谁的";
  }
}
