// ans doctor：分层诊断。四层：安装 / 能力 / 宿主 / 数据。
//
// 每条结果只说四种状态：ready、unconfigured、unchecked、failed。每层分开写，
// 免得一个没配的 key 把整台机器说成坏的，也免得“没查”被当成“没问题”。
// 每条还标 offline 或 live：离线检查只证明本机文件/解析/构造器没问题，不证明
// 联网、模型、宿主真的能用。真实能力要在 live 里单独跑，doctor 不替它打包票。

import { TavilyProvider, ExaProvider, AnySearchProvider } from "@anysearch-cli/retriever/providers";
import type { SearchProvider } from "@anysearch-cli/retriever";
import {
  MANUAL_RECOVERY_NOTE,
  SEARCH_PROVIDER_IDS,
  type SearchProviderId,
  SqliteSessionStore,
  domainTomlPath,
  listDomainTomls,
  loadDomainByNameIn,
  loadDomainFromString,
  preMigrationBackupPath,
  preMigrationRecordPath,
  readMigrationStatus,
  type MigrationLayoutStatus,
  readUserCredentials,
  resolveConfigHome,
  resolveSearchCredentials,
  userCredentialsPath,
} from "@anysearch-cli/store";
import { classifyProviderBuildError, resolveDbPath, resolveDomainConstraint } from "@anysearch-cli/kernel";
import { resolveActiveDomain } from "@anysearch-cli/store/local-service";
import { domainSearchDirs } from "../db";
import { resolveLlmConfig } from "../config-llm";
import { DiagReport } from "../diagnostics";
import { describeIdentity, installedProduct } from "../build-identity";
import { INSTALL_BINS, binOnPath, getHost, listHostIds } from "../host-wiring/hosts";
import { computePlan } from "../host-wiring/plan";
import { findInterrupted, wiringRoot } from "../host-wiring/journal";
import { readSwitchHistory } from "../upgrade-record";
import { MANAGED_SKILLS_REL_PATH, managedSkillsRoot, readInstalledSkillsReadOnly } from "../skill-store";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import path from "node:path";

declare const __PACKAGE_VERSION__: string | undefined;
const PKG_VERSION: string =
  typeof __PACKAGE_VERSION__ === "string" && __PACKAGE_VERSION__ ? __PACKAGE_VERSION__ : "0.0.0";

const HELP = `ans doctor [--json] [--strict]

分层诊断：安装 / 能力 / 宿主 / 数据。每条结果只取四种状态之一：
  可用     查过，是好的
  未配置   还没配，或者本来就不需要配（合法的空，不是坏）
  未检查   没能查，或者没去查（不等于没问题）
  失败     查过，确实坏了

每条还标着是离线检查还是真实调用。默认只读本机，不联网、不启动宿主。
--json 输出结构化结果。退出码：有失败是 1；加了 --strict 又有未检查是 5；
其余是 0。`;

export interface DoctorOptions {
  stdout?: (line: string) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readNodeFloor(packageRoot: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
      engines?: { node?: unknown };
    };
    const floor = parsed.engines?.node;
    return typeof floor === "string" ? floor : null;
  } catch {
    return null;
  }
}

function parseVersion(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** 只认 `>=X.Y.Z` 这种写法；认不出来就返回 null，不猜。 */
function meetsFloor(running: string, floor: string): boolean | null {
  const match = /^>=\s*(\d+)\.(\d+)\.(\d+)/.exec(floor);
  if (!match) return null;
  const actual = parseVersion(running);
  if (!actual) return null;
  const wanted: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] > wanted[index]) return true;
    if (actual[index] < wanted[index]) return false;
  }
  return true;
}

export async function runDoctor(args: string[] = [], opts: DoctorOptions = {}): Promise<number> {
  const write = opts.stdout ?? ((line: string) => process.stdout.write(line + "\n"));
  const json = args.includes("--json");
  const strict = args.includes("--strict");
  if (args.includes("--help") || args.includes("-h")) {
    write(HELP);
    return 0;
  }

  const report = new DiagReport("ans", PKG_VERSION);
  const cwd = process.cwd();
  // 一份家目录走到底：凭据、配置、宿主接线都从同一个根算，别一半读到临时家目录。
  const configHome = resolveConfigHome();
  const identity = installedProduct();

  // ── 安装层 ────────────────────────────────────────────────────────────
  report.add({
    layer: "install",
    name: "版本",
    // 没打标就是没法核对版本号，报"未检查"比报"可用"诚实。
    state: identity.buildId ? "ready" : "unchecked",
    mode: "offline",
    detail: describeIdentity(identity),
  });
  report.add({
    layer: "install",
    name: "安装位置",
    state: "ready",
    mode: "offline",
    detail: identity.packageRoot,
  });
  {
    const floor = readNodeFloor(identity.packageRoot);
    const running = process.versions.node;
    const meets = floor ? meetsFloor(running, floor) : null;
    if (meets === null) {
      report.add({
        layer: "install",
        name: "运行时 Node",
        state: "unchecked",
        mode: "offline",
        detail: floor
          ? `当前 ${running}，包里的 engines.node 写法认不出来：${floor}`
          : `当前 ${running}，包里没有 engines.node，核对不了下限`,
      });
    } else if (meets) {
      report.add({
        layer: "install",
        name: "运行时 Node",
        state: "ready",
        mode: "offline",
        detail: `${running}，满足 ${floor}`,
      });
    } else {
      report.add({
        layer: "install",
        name: "运行时 Node",
        state: "failed",
        mode: "offline",
        detail: `${running}，低于包要求的 ${floor}`,
      });
    }
  }
  {
    const missing = INSTALL_BINS.filter((bin) => !binOnPath(bin));
    if (missing.length === 0) {
      report.add({
        layer: "install",
        name: "完整产品的 bin",
        state: "ready",
        mode: "offline",
        detail: `${INSTALL_BINS.length} 个都在 PATH 上`,
      });
    } else {
      report.add({
        layer: "install",
        name: "完整产品的 bin",
        state: "unconfigured",
        mode: "offline",
        detail: `PATH 上缺 ${missing.join(", ")}；从检出直接跑时正常，装好以后应该都在`,
      });
    }
  }

  // ── 能力层 ────────────────────────────────────────────────────────────
  // Design: 一次诊断只读一次凭据文件，读坏了只报一条 — 搜索解析器、模型解析器和
  // 这一行吃的是同一份结果，不用再判断「这条是不是上面说过的那条」。
  const credentialFile = readUserCredentials({ home: configHome });
  const credentials = resolveSearchCredentials(process.env, {
    home: configHome,
    credentialsFile: credentialFile,
  });
  {
    // 凭据要显式传进去：key 存在 ~/.ans/credentials.json 里是产品推荐的做法，
    // 只回落到环境变量的构造器会把这类机器误判成失败。规则和运行时一致。
    const make: Record<SearchProviderId, () => SearchProvider> = {
      tavily: () => new TavilyProvider(credentials.tavily?.apiKey),
      exa: () => new ExaProvider(credentials.exa?.apiKey),
      anysearch: () => new AnySearchProvider(credentials.anysearch?.apiKey, credentials.anysearch?.endpoint),
    };
    for (const id of SEARCH_PROVIDER_IDS) {
      try {
        const instance = make[id]();
        report.add({
          layer: "capability",
          name: `provider ${id}`,
          state: instance.id.length > 0 && instance.modes.length >= 3 ? "ready" : "failed",
          mode: "offline",
          detail: `id=${instance.id} modes=${instance.modes.join(",")}（只验构造器能建，key 另见「搜索源」）`,
        });
      } catch (error) {
        // 有的构造器没 key 就拒（exa 就是）。没配 key 是合法的空，不是坏了；
        // 配了 key 还构造不出来，那才是真的坏了。
        //
        // 原始报错一个字都不打：构造器手里就有 key，运行时报错可能把它带出来
        // （Node 的 "Headers.append: <value> is an invalid header value"）。
        const configured = Boolean(credentials[id]);
        let detail: string;
        if (!configured) detail = "没配 key，构造器会拒；配好了才会用";
        else if (classifyProviderBuildError(error) === "credential")
          detail = "配了 key，但构造器没建起来：key 可能格式不对或服务端不认。原始报错不打印，免得把 key 带出来";
        else detail = "构造器出了意外的错。原始报错不打印，免得把 key 带出来";
        report.add({
          layer: "capability",
          name: `provider ${id}`,
          state: configured ? "failed" : "unconfigured",
          mode: "offline",
          detail,
        });
      }
    }
  }
  {
    // 构造器自己会建表、跑列迁移、加载原生模块，任何一步都可能抛。放在 try
    // 外面就是整轮 doctor 崩掉、前面查过的一行都出不来。
    let store: SqliteSessionStore | undefined;
    try {
      store = new SqliteSessionStore(":memory:");
      const session = await store.createSession("doctor");
      await store.append(session.id, { role: "user", content: "doctor smoke test" });
      const hits = await store.searchFts5(session.id, "doctor");
      report.add({
        layer: "capability",
        name: "内存会话库",
        state: hits.length >= 1 ? "ready" : "failed",
        mode: "offline",
        detail: `建会话、写一条、FTS 搜到 ${hits.length} 条`,
      });
      // 单独一段：向量臂坏了要报在它自己名下，别让「内存会话库」出现两条一好
      // 一坏、看的人还要猜哪条算数。
      try {
        const telemetry = await store.vectorTelemetry();
        if (telemetry.absent) {
          report.add({
            layer: "capability",
            name: "vector arm",
            state: "unconfigured",
            mode: "offline",
            detail: "@anysearch-cli/embedding absent — FTS-only; enable: npm i -g @anysearch-cli/embedding (pnpm add -g @anysearch-cli/embedding) && ans memory backfill-vectors",
          });
        } else {
          report.add({
            layer: "capability",
            name: "vector arm",
            state: "ready",
            mode: "offline",
            detail: `present embeds=${telemetry.embeds} failures=${telemetry.failures}${telemetry.circuitOpen ? " circuitOpen" : ""}`,
          });
        }
      } catch (error) {
        report.add({
          layer: "capability",
          name: "vector arm",
          state: "failed",
          mode: "offline",
          detail: errorText(error).slice(0, 160),
        });
      }
    } catch (error) {
      report.add({
        layer: "capability",
        name: "内存会话库",
        state: "failed",
        mode: "offline",
        detail: errorText(error).slice(0, 160),
      });
    } finally {
      store?.close();
    }
  }
  {
    const testToml = [
      'name = "doctor"',
      'description = "Doctor smoke test domain"',
      "",
      "[settings]",
      'language = "TypeScript"',
      "",
      "[skills]",
      'active = ["doctor"]',
      "",
      "[sources]",
      'enabled = ["tavily"]',
      "",
      "[rag]",
      'adapter = "none"',
      "",
      "[hooks]",
      'toolWhitelist = ["ctx_execute"]',
    ].join("\n");
    try {
      const schema = loadDomainFromString(testToml);
      report.add({
        layer: "capability",
        name: "领域 TOML 解析",
        state: schema.name === "doctor" && schema.rag.adapter === "none" ? "ready" : "failed",
        mode: "offline",
        detail: `name=${schema.name} rag=${schema.rag.adapter} skills=${schema.skills.active.join(",")}`,
      });
    } catch (error) {
      report.add({
        layer: "capability",
        name: "领域 TOML 解析",
        state: "failed",
        mode: "offline",
        detail: errorText(error).slice(0, 160),
      });
    }
  }
  {
    const credentialsPath = userCredentialsPath(configHome);
    if (credentialFile.error) {
      report.add({
        layer: "capability",
        name: "user credential file",
        state: "failed",
        mode: "offline",
        detail: `${credentialFile.error} — 修好或删掉它，再跑 ans auth set <provider>`,
      });
    } else {
      report.add({
        layer: "capability",
        name: "user credential file",
        state: "ready",
        mode: "offline",
        detail: existsSync(credentialsPath)
          ? `${credentialsPath} (${credentialFile.bindings.length} key(s), plain text)`
          : `${credentialsPath} (not created yet)`,
      });
    }
    for (const provider of SEARCH_PROVIDER_IDS) {
      const entry = credentials[provider];
      if (!entry) {
        report.add({
          layer: "capability",
          name: `搜索源 ${provider}`,
          state: "unconfigured",
          mode: "offline",
          detail: "没有 key，这个源不会参与检索",
        });
        continue;
      }
      // 只有 endpoint、没有 key 也算没配：install-smoke 把 arm 指到死端口时就是这种现场。
      if (!entry.apiKey) {
        report.add({
          layer: "capability",
          name: `搜索源 ${provider}`,
          state: "unconfigured",
          mode: "offline",
          detail: "endpoint 设了，但没有 key；这个源不会参与检索",
        });
        continue;
      }
      report.add({
        layer: "capability",
        name: `搜索源 ${provider}`,
        state: "ready",
        mode: "offline",
        detail: entry.source === "env" ? "key 来自环境变量" : "key 来自用户凭据文件",
      });
    }
  }
  {
    // 模型解析器拿同一份已解析结果：它不再读盘，也不再就这份文件报第二条。
    const configWarnings: string[] = [];
    const llm = resolveLlmConfig({
      cwd,
      home: configHome,
      env: process.env,
      credentialsFile: credentialFile,
      warn: (msg) => configWarnings.push(msg),
    });
    const configured = Boolean(llm.provider && llm.model);
    report.add({
      layer: "capability",
      name: "模型配置",
      state: configured ? "ready" : "unconfigured",
      mode: "offline",
      detail: configured
        ? `${llm.provider}/${llm.model}（来源：${llm.sources.provider ?? "?"} / ${llm.sources.model ?? "?"}）`
        : "没配模型；ans chat / consolidate 要用它（ans llm 配）",
    });
    report.add({
      layer: "capability",
      name: "模型密钥",
      state: llm.apiKey ? "ready" : "unconfigured",
      mode: "offline",
      detail: llm.apiKey ? `有（来源：${llm.sources.apiKey ?? "?"}）` : "没配；模型调用会失败（ans auth 配）",
    });
    for (const warning of configWarnings) {
      report.add({
        layer: "capability",
        name: "配置文件",
        state: "failed",
        mode: "offline",
        detail: warning,
      });
    }
    report.add({
      layer: "capability",
      name: "真实模型调用",
      state: "unchecked",
      mode: "live",
      detail: "doctor 不联网；要验真调用就用 ans chat",
    });
    report.add({
      layer: "capability",
      name: "真实检索调用",
      state: "unchecked",
      mode: "live",
      detail: "doctor 不联网；要验真检索就用 ans search",
    });
  }
  {
    const dirs = domainSearchDirs();
    const found = listDomainTomls(dirs);
    const parsedDomains = new Map<string, { dir: string; schema?: ReturnType<typeof loadDomainByNameIn>; error?: unknown }>();
    for (const [file, dir] of found) {
      const domainName = file.replace(/\.toml$/, "");
      try {
        parsedDomains.set(file, { dir, schema: loadDomainByNameIn(domainName, dirs) });
      } catch (error) {
        parsedDomains.set(file, { dir, error });
      }
    }

    const active = resolveActiveDomain();
    const constraint = resolveDomainConstraint({
      name: active.name,
      declared: active.declared,
      dirs,
    });
    if (constraint.state === "established") {
      const schema = constraint.schema;
      report.add({
        layer: "capability",
        name: `当前领域 ${active.name}`,
        state: "ready",
        mode: "offline",
        detail: `当前生效：${schema.name}（${domainTomlPath(cwd, active.name, dirs)}）${active.declared ? "" : "（没指定，用默认）"}`,
      });
      report.add({
        layer: "capability",
        name: "领域 sources.enabled",
        state: schema.sources.enabled.length > 0 ? "ready" : "failed",
        mode: "offline",
        detail: schema.sources.enabled.join(",") || "(空)",
      });
      const installedSkills = new Map<string, string[]>();
      const manifestErrors: string[] = [];
      const seenRoots = new Set<string>();
      for (const project of [false, true]) {
        const scopeOpts = { home: configHome, cwd, project };
        const root = managedSkillsRoot(scopeOpts);
        if (seenRoots.has(root)) continue;
        seenRoots.add(root);
        try {
          for (const skill of readInstalledSkillsReadOnly(scopeOpts)) {
            const roots = installedSkills.get(skill.name) ?? [];
            roots.push(root);
            installedSkills.set(skill.name, roots);
          }
        } catch (error) {
          manifestErrors.push(`${project ? "项目级" : "用户级"}清单读不出：${errorText(error).slice(0, 80)}`);
        }
      }
      const allActiveInDomains = new Set<string>(schema.skills.active);
      for (const entry of parsedDomains.values()) {
        if (entry.schema) {
          for (const s of entry.schema.skills.active) allActiveInDomains.add(s);
        }
      }
      const activeNotInstalled = schema.skills.active.filter((s) => !installedSkills.has(s));
      const installedNotInAnyDomain = [...installedSkills.keys()].filter((s) => !allActiveInDomains.has(s)).sort();
      const hasToolRequires = Boolean(schema.skills.toolRequires && Object.keys(schema.skills.toolRequires).length > 0);
      const skillNotes: string[] = [...manifestErrors];
      if (hasToolRequires && manifestErrors.length === 0 && activeNotInstalled.length > 0) {
        skillNotes.push(
          `未装进 ${MANAGED_SKILLS_REL_PATH}：${activeNotInstalled.join("、")}（不影响筛工具，只看域 TOML 的 toolRequires）`,
        );
      }
      if (installedNotInAnyDomain.length > 0) {
        const formatted = installedNotInAnyDomain
          .map((name) => `${name}（${(installedSkills.get(name) ?? []).join("、")}）`)
          .join("、");
        skillNotes.push(
          `装了但没在任何域里启用：${formatted}——宿主可以直接读；想让域按技能筛工具，才需要把它写进 [skills].active 和 [skills.toolRequires]`,
        );
      }
      const baseSkillsDetail = schema.skills.active.join("、") || "这个域没有启用技能";
      report.add({
        layer: "capability",
        name: "领域 skills.active",
        state: schema.skills.active.length > 0 ? "ready" : "unconfigured",
        mode: "offline",
        detail: skillNotes.length > 0 ? `${baseSkillsDetail}（${skillNotes.join("；")}）` : baseSkillsDetail,
      });
      report.add({
        layer: "capability",
        name: "领域 hooks.toolWhitelist",
        state: schema.hooks.toolWhitelist.length > 0 ? "ready" : "unconfigured",
        mode: "offline",
        detail: schema.hooks.toolWhitelist.length > 0
          ? `${schema.hooks.toolWhitelist.length} 个工具`
          : "没设白名单上限：所有工具都放行（声明了 toolRequires 时才按启用技能的工具集过滤）",
      });
      report.add({
        layer: "capability",
        name: "领域 prompts",
        state: (schema.prompts?.length ?? 0) > 0 ? "ready" : "unconfigured",
        mode: "offline",
        detail: `${schema.prompts?.length ?? 0} 条提示词`,
      });
      report.add({
        layer: "capability",
        name: "领域 rag.adapter",
        state: schema.rag.adapter.length > 0 ? "ready" : "failed",
        mode: "offline",
        detail: schema.rag.adapter,
      });
      if (schema.sources.urlAllowlist?.length) {
        report.add({
          layer: "capability",
          name: "领域 urlAllowlist",
          state: "ready",
          mode: "offline",
          detail: schema.sources.urlAllowlist.join(", "),
        });
      }
    } else if (constraint.state === "failed") {
      report.add({
        layer: "capability",
        name: `当前领域 ${active.name}`,
        state: constraint.fatal ? "failed" : "unconfigured",
        mode: "offline",
        detail: constraint.fatal
          ? `声明了但建不起来，运行时会被拦住：${constraint.reason}。修：ans domain <上面列的名字>`
          : `没指定领域，默认域也不存在：${constraint.reason}。这是合法状态，只是不做领域过滤`,
      });
    } else {
      report.add({
        layer: "capability",
        name: "当前领域",
        state: "unconfigured",
        mode: "offline",
        detail: "没指定领域，也不做领域过滤；想限定就 ans domain <名字>",
      });
    }
    if (found.size === 0) {
      report.add({
        layer: "capability",
        name: "领域文件发现",
        state: "failed",
        mode: "offline",
        detail: "解析链上没找到任何 domains/*.toml；装完整产品应该带一个",
      });
    }
    for (const [file, parsed] of parsedDomains) {
      if (parsed.schema) {
        report.add({
          layer: "capability",
          name: `领域文件 ${file.replace(/\.toml$/, "")}`,
          state: parsed.schema.name.length > 0 ? "ready" : "failed",
          mode: "offline",
          detail: parsed.dir,
        });
      } else {
        report.add({
          layer: "capability",
          name: `领域文件 ${file}`,
          state: "failed",
          mode: "offline",
          detail: errorText(parsed.error).slice(0, 160),
        });
      }
    }
  }

  // ── 宿主层 ────────────────────────────────────────────────────────────
  for (const hostId of listHostIds()) {
    const host = getHost(hostId);
    if (!host) continue;
    try {
      const plan = computePlan(host, "connect", { projectRoot: cwd, home: configHome });
      const roots = new Set(plan.files.map((file) => wiringRoot(file.file.scope, cwd, configHome)));
      const interrupted = [...roots].map((root) => findInterrupted(root, host.id)).find(Boolean);
      const units = plan.files.flatMap((file) => file.units);
      const conflicts = units.filter((unit) => unit.action === "conflict" || unit.action === "blocked");
      const pending = units.filter((unit) => unit.action === "add" || unit.action === "replace");
      const wired = !interrupted && conflicts.length === 0 && pending.length === 0;
      if (interrupted) {
        report.add({
          layer: "host",
          name: `宿主 ${host.id} 配置`,
          state: "failed",
          mode: "offline",
          detail: `上次 ${interrupted.op} 没收尾；先跑 ans host repair ${host.id}`,
        });
      } else if (conflicts.length > 0) {
        report.add({
          layer: "host",
          name: `宿主 ${host.id} 配置`,
          state: "failed",
          mode: "offline",
          detail: `${conflicts.length} 处冲突/读不了，不能覆盖；先看 ans host preview ${host.id}`,
        });
      } else if (pending.length > 0) {
        report.add({
          layer: "host",
          name: `宿主 ${host.id} 配置`,
          state: "unconfigured",
          mode: "offline",
          detail: `还没接入；要接就跑 ans host connect ${host.id}`,
        });
      } else {
        report.add({
          layer: "host",
          name: `宿主 ${host.id} 配置`,
          state: "ready",
          mode: "offline",
          detail: "配置在位，和候选一致",
        });
      }
      if (wired) {
        report.add({
          layer: "host",
          name: `宿主 ${host.id} 待信任`,
          state: "unchecked",
          mode: "live",
          detail: `宿主那边还要人做的：${host.todoAfterConnect.join("；")}——doctor 核不了，只能由人在宿主里确认`,
        });
      }
      report.add({
        layer: "host",
        name: `宿主 ${host.id} 实际连接`,
        state: "unchecked",
        mode: "live",
        detail: "doctor 不启动宿主；真正跑一轮要在宿主里确认",
      });
    } catch (error) {
      report.add({
        layer: "host",
        name: `宿主 ${host.id} 配置`,
        state: "failed",
        mode: "offline",
        detail: errorText(error).slice(0, 160),
      });
    }
  }
  {
    const history = readSwitchHistory();
    const latest = history[0];
    if (!latest) {
      report.add({
        layer: "host",
        name: "换版后待重连",
        state: "unconfigured",
        mode: "offline",
        detail: "还没有换版记录",
      });
    } else {
      const pending = latest.pendingReconnect.length + latest.unknownReconnect.length;
      report.add({
        layer: "host",
        name: "换版后待重连",
        state: pending === 0 ? "ready" : "unconfigured",
        mode: "offline",
        detail:
          pending === 0
            ? "上一轮换版没有留下待重连的入口"
            : `${pending} 个入口还活着，重启/重连后才用上新版；ans upgrade 里看明细`,
      });
    }
  }

  // ── 数据层 ────────────────────────────────────────────────────────────
  {
    const dbPath = resolveDbPath();
    const dbDir = path.dirname(dbPath);
    if (dbPath === ":memory:") {
      // 内存库没有文件也没有目录：dirname(":memory:") 是 "."，一定存在又可写，
      // 走下面那段探测会说「目录在」，和「库布局」那行的「内存库，不落盘」打架。
      report.add({
        layer: "data",
        name: "durable DB path",
        state: "unconfigured",
        mode: "offline",
        detail: "内存库，不落盘（ANS_DB_PATH=:memory:）",
      });
    } else if (existsSync(dbPath)) {
      report.add({
        layer: "data",
        name: "durable DB path",
        state: "ready",
        mode: "offline",
        detail: `${dbPath}（库文件在）`,
      });
    } else if (existsSync(dbDir)) {
      let writable = true;
      try {
        accessSync(dbDir, constants.W_OK);
      } catch {
        writable = false;
      }
      report.add({
        layer: "data",
        name: "durable DB path",
        state: writable ? "ready" : "failed",
        mode: "offline",
        detail: writable ? `${dbPath}（目录在，还没有库文件）` : `${dbDir} 写不进去，库建不起来`,
      });
    } else {
      report.add({
        layer: "data",
        name: "durable DB path",
        state: "unconfigured",
        mode: "offline",
        detail: `${dbPath}（还没建；第一次用时创建）`,
      });
    }
    const status = readMigrationStatus(dbPath);
    const layoutText: Record<Exclude<MigrationLayoutStatus, "unknown">, string> = {
      memory: "内存库，不落盘",
      absent: "还没有库，第一次用时按当前布局建",
      fresh: "库文件在，还没有表",
      legacy: "旧布局；下次用时先做迁移前备份，再迁移",
      sessionless: "只有观测数据，没有会话表；不需要迁移",
      current: "当前布局",
    };
    if (status.layout === "unknown") {
      report.add({
        layer: "data",
        name: "库布局",
        state: "failed",
        mode: "offline",
        detail: status.error ?? "打不开库，也说不出原因",
      });
    } else {
      report.add({
        layer: "data",
        name: "库布局",
        state: "ready",
        mode: "offline",
        detail: layoutText[status.layout],
      });
      if (status.layout === "current" || status.layout === "legacy") {
        const backup = preMigrationBackupPath(dbPath);
        const record = preMigrationRecordPath(dbPath);
        if (status.backupExists) {
          report.add({
            layer: "data",
            name: "迁移前备份",
            state: "ready",
            mode: "offline",
            detail: `${backup}${status.record ? `（${status.record.createdAt}，${status.record.bytes} 字节，记录 ${record}）` : ""}。${MANUAL_RECOVERY_NOTE}`,
          });
        } else {
          report.add({
            layer: "data",
            name: "迁移前备份",
            state: "unconfigured",
            mode: "offline",
            detail: status.layout === "legacy"
              ? "还没备份，下次用时才会做"
              : "当前布局本来就不需要迁移前备份",
          });
        }
      }
    }
  }

  const exitCode = report.exitCode(strict);
  if (json) {
    write(JSON.stringify(report.toJson(strict), null, 2));
  } else {
    write(`ans doctor v${PKG_VERSION}`);
    for (const line of report.render(strict)) write(line);
    let conclusion: string;
    if (exitCode === 0) conclusion = "结论：没有失败项。未配置和未检查不是坏，但也不是“已验证”。";
    else if (exitCode === 1) conclusion = "结论：有失败项，先修再继续。";
    else conclusion = "结论：没有失败项，但有未检查项；--strict 下未检查不算通过。";
    write(conclusion);
  }
  return exitCode;
}
