// ans domain: switch or show Active Domain (cc-persona TOML).
// decision 4A: loads TOML from domains/<name>.toml convention directory.
// G016: persists domain to ~/.ans/config.env for cross-session recall.
//
// #306: validate first, persist second. The old order wrote the name and then
// tried to load it, so a typo left a persisted selection that resolves to
// silent full-fanout — and the command still exited 0. Now a name that does not
// resolve changes nothing: the previous selection stays, and the exit code says
// the switch did not happen.

import { configPath, readConfig, writeConfig } from "../config-env";
import { domainSearchDirs } from "../db";
import {
  describeDomainFailure,
  describeDomainFallback,
  resolveDomainConstraint,
  type DomainConstraint,
} from "@anysearch-cli/kernel";
import { listDomainTomls } from "@anysearch-cli/store";
import { resolveActiveDomain } from "@anysearch-cli/store/local-service";

// Domain names discoverable on the resolution chain (shared lister; one
// implementation for both call sites).
function listDomains(): Set<string> {
  return new Set([...listDomainTomls(domainSearchDirs()).keys()].map((f) => f.replace(/\.toml$/, "")));
}

function printAvailable(): void {
  const names = listDomains();
  if (names.size > 0) console.log("可选：" + [...names].join(", "));
}

function printResolved(constraint: Extract<DomainConstraint, { state: "established" }>): void {
  const schema = constraint.schema;
  console.log("  信息源：" + schema.sources.enabled.join(", "));
  console.log("  技能：" + schema.skills.active.join(", "));
  console.log("  可用工具：" + schema.hooks.toolWhitelist.join(", "));
  console.log("  领域检索适配器：" + schema.rag.adapter);
}

export async function runDomain(args: string[]): Promise<number> {
  // The persisted selection is already in the env (index.ts rehydrates it), so
  // `resolveActiveDomain` sees exactly what every other command sees. readConfig
  // is only here to say WHERE the selection came from.
  const persisted = readConfig();
  const active = resolveActiveDomain();
  const current = active.name;

  if (args.length === 0) {
    const constraint = resolveDomainConstraint({
      name: active.name,
      declared: active.declared,
      dirs: domainSearchDirs(),
    });
    console.log("当前领域：" + current + (active.declared ? "" : "（没指定，用默认）"));
    if (persisted.ANS_DOMAIN) {
      console.log("  记在 " + configPath() + " 里");
    }
    if (constraint.state === "failed") {
      // #306: a declared domain that will stop every command is a failure to
      // report; a convention default that is simply absent is a legal state and
      // must not exit non-zero over it.
      if (constraint.fatal) {
        process.stderr.write(describeDomainFailure(constraint) + "\n");
        printAvailable();
        return 1;
      }
      process.stderr.write(describeDomainFallback(constraint) + "\n");
    }
    if (constraint.state === "established") printResolved(constraint);
    printAvailable();
    console.log("换领域：ans domain <名字>");
    return 0;
  }

  // The name goes into a file path, so the accepted shape is a bare name:
  // trimming keeps the validated name and the persisted one identical, and
  // banning separators keeps `ans domain ../../x` inside the domains dirs.
  const newDomain = args[0]!.trim();
  if (!newDomain || newDomain === "." || newDomain === ".." || /[\\/]/.test(newDomain)) {
    process.stderr.write("领域名要写成不带路径的单名，例如 docs。\n");
    printAvailable();
    return 2;
  }
  // Validate the whole thing — file, inheritance chain, every field — before
  // anything is written. Nothing below can leave the old selection replaced by
  // one that does not load.
  const constraint = resolveDomainConstraint({ name: newDomain, declared: true, dirs: domainSearchDirs() });
  if (constraint.state === "failed") {
    process.stderr.write(
      "没换成 " + newDomain + "。原来用的是 " + current + "，没动。\n" +
      describeDomainFailure(constraint) + "\n",
    );
    printAvailable();
    return 1;
  }
  if (constraint.state === "established") {
    // The file loads; now it has to be writable. A write fault is a failed
    // switch too — the in-process env must not claim a selection that would
    // disappear on the next command.
    try {
      writeConfig("ANS_DOMAIN", newDomain);
    } catch (e) {
      process.stderr.write(
        "没换成 " + newDomain + "。配置写不进去（" + (e instanceof Error ? e.message : String(e)) + "），" +
        "原来用的是 " + current + "，没动。\n",
      );
      return 1;
    }
    process.env.ANS_DOMAIN = newDomain;
    console.log("领域已换成：" + newDomain);
    console.log("  记在 " + configPath() + " 里，下次也用它");
    printResolved(constraint);
    return 0;
  }
  process.stderr.write("没换成 " + newDomain + "：没有可用的领域配置。\n");
  return 1;
}
