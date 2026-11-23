// #311: 磁盘上是哪一版、这个进程执行的是哪一版，分开答。
//
// npm 换文件不会让已经在跑的进程跟着换：一个常驻 MCP 服务可能已经跑了三天，磁盘
// 上早就是新版，它执行的还是三天前那份代码。所以给两个读数——磁盘（installed）
// 读 `<包根>/dist/build-info.json`；执行（executing）在本进程启动时读一次就固定，
// 之后不再重读。两者不同，就说明"文件换了但进程没换"。
//
// 进程自己在登记表里记的就是 executing 那一份（见 cli-task-tracking.ts），所以
// `ans upgrade status` 能拿别人的记录和磁盘版本对比，算出"谁还在旧版上"。
//
// 读不出戳时 buildId 是 null，不编一个 "unknown" 字符串：null 拿去比只会得到
// "判断不了"，而字符串会在某处被当成"和磁盘不一样"，把一个说不清的进程报成旧版。

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildId, readBuildInfo, type BuildInfo } from "@anysearch-cli/store";

/** 这份安装从哪来的。 */
export type InstallSource =
  /** 仓库检出（自己 build 的，或者 pnpm link 过去的）。 */
  | "checkout"
  /** 装出来的包（npm i -g / npx 之类）。 */
  | "package"
  /** 说不清：兜底值——detectSource 的 try/catch 只在 existsSync 抛异常时才走到。 */
  | "unknown";

/** 一次版本的三句话：标识、版本号、commit。缺的部分留 null，不补。 */
export interface BuildStamp {
  /** `0.2.0+cbefccab`；这份构建没打标就是 null。 */
  buildId: string | null;
  version: string | null;
  commit: string | null;
  /** 构建时间；这份构建没记就是 null。 */
  builtAt: string | null;
}

export interface ProductIdentity {
  /** 包根目录（含 package.json 和 dist/ 的那一层）。 */
  packageRoot: string;
  /** 包名；读不出来时为 null。 */
  packageName: string | null;
  /** 磁盘上这份构建的标识；没有 build-info.json 时为 null。 */
  info: BuildInfo | null;
  /** 一句话版本号 `0.2.0+cbefccab`；没有 build-info.json 时是 null。 */
  buildId: string | null;
  source: InstallSource;
}

/**
 * 本模块所在的那一层目录。
 *
 * 打包后是 `<包根>/dist`，dev（tsx 直接跑 src）时是 `<包根>/src`。两种情况
 * 包根都是它的上一级，所以不用判断自己在哪。
 */
function moduleDir(): string {
  const self = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  return self;
}

/**
 * 这份进程是不是在直接跑源码（tsx 跑 `src/`）。
 *
 * 是的话就不能读 `dist/build-info.json`：那是上一次构建的戳，而正在执行的是
 * 源码，两者可能早就不是一回事。拿旧戳当"我在跑这一版"，正是本模块要避免的
 * 那种错。
 */
function runningFromSource(): boolean {
  return moduleDir().replace(/\\/g, "/").endsWith("/src");
}

/**
 * 判断这份安装是仓库检出还是装出来的包。
 *
 * 判据是「往上找，同一个目录里既有 .git 又有 pnpm-workspace.yaml」。只看
 * .git 会把 clone 下来自己 npm install 的东西也算成检出——那种情况装的确实是
 * 包，不该报成源码目录。只看 pnpm-workspace.yaml 又会把用户自己的 monorepo
 * 算进来。
 */
function detectSource(packageRoot: string): InstallSource {
  let head = resolve(packageRoot);
  for (let depth = 0; depth < 6; depth++) {
    try {
      if (existsSync(join(head, ".git")) && existsSync(join(head, "pnpm-workspace.yaml"))) return "checkout";
    } catch {
      return "unknown";
    }
    const parent = dirname(head);
    if (parent === head) break;
    head = parent;
  }
  return "package";
}

function readPackageName(packageRoot: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}

/**
 * 读一个包根目录下的构建身份。
 *
 * build-info.json 不存在时不编一个出来：`info` 和 `buildId` 都是 null。这样报
 * 告里能看出"这一份没打标"，而不是把它冒充成一个有 commit 的构建。
 */
export function readProductIdentity(packageRoot: string): ProductIdentity {
  const root = resolve(packageRoot);
  const info = readBuildInfo(join(root, "dist", "build-info.json"));
  return {
    packageRoot: root,
    packageName: readPackageName(root),
    info,
    buildId: info ? buildId(info) : null,
    source: detectSource(root),
  };
}

/** 本进程所在的那份安装（磁盘上的当前状态）。 */
export function installedProduct(): ProductIdentity {
  const root = resolve(moduleDir(), "..");
  const identity = readProductIdentity(root);
  // 直接跑源码时不认 dist 的戳（见 runningFromSource）：报成"没打标"，比拿上一
  // 次构建的 commit 冒充"正在跑的就是它"要诚实。
  return runningFromSource() ? { ...identity, info: null, buildId: null } : identity;
}

/**
 * 本进程正在执行的构建，在模块加载时读一次就固定。
 *
 * 不重读是有意的：进程活过整场升级的时候，"磁盘上现在是什么"会变，而这个
 * 进程执行的代码不会变。`ans upgrade status` 要报的就是这个不变的值。
 */
let executing: ProductIdentity | undefined;
export function executingProduct(): ProductIdentity {
  executing ??= installedProduct();
  return executing;
}

/** 记进升级记录的那一份：只留能核对的部分，缺的写 null。 */
export function stampOf(identity: ProductIdentity): BuildStamp {
  return {
    buildId: identity.buildId,
    version: identity.info?.version ?? null,
    commit: identity.info?.commit ?? null,
    builtAt: identity.info?.builtAt ?? null,
  };
}

/** 写进进程登记表的那一句：`0.2.0+cbefccab`；读不到就是 null（登记成 NULL）。 */
export function executingBuildId(): string | null {
  return executingProduct().buildId;
}

const SOURCE_TEXT: Record<InstallSource, string> = {
  checkout: "仓库检出（自己 build 的）",
  package: "装出来的包",
  unknown: "说不清（包根读不出来）",
};

/** 人读的来源说明。 */
export function describeSource(source: InstallSource): string {
  return SOURCE_TEXT[source];
}

/** 版本标识的人读写法：没打标就说没打标，不拿别的字符串顶。 */
export function describeBuildId(buildId: string | null): string {
  return buildId ?? "没打标";
}

function describeDirty(dirty: boolean | null): string {
  if (dirty === true) return "，工作区有未提交改动";
  if (dirty === null) return "，改没改过说不清";
  return "";
}

/** 人读的版本说明，缺什么就说什么，不补。 */
export function describeIdentity(identity: ProductIdentity): string {
  const info = identity.info;
  if (!info) {
    return "没打标（没有 dist/build-info.json；这份构建没记下 commit，版本号不可核对）";
  }
  const builtAt = info.builtAt ? "，构建于 " + info.builtAt : "，构建时间没记";
  return describeBuildId(identity.buildId) + describeDirty(info.dirty) + builtAt +
    "（commit " + info.commit + "）";
}
