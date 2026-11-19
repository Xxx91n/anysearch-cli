// ans domain: switch or show Active Domain (cc-persona TOML).
// decision 4A: loads TOML from domains/<name>.toml convention directory.
// G016: persists domain to ~/.anysearch/config.env for cross-session recall.
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
  resolveDomainConstraint,
  type DomainConstraint,
} from "@anysearch-cli/kernel";
import { listDomainTomls } from "@anysearch-cli/store";

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
  // Explicit env wins, then the persisted selection; neither means nobody has
  // declared a domain, which is a legal state (the "default" convention applies).
  const persisted = readConfig();
  const declared = process.env.ANS_DOMAIN || persisted.ANS_DOMAIN;
  const current = declared || "default";

  if (args.length === 0) {
    const constraint = resolveDomainConstraint({
      name: current,
      declared: !!declared,
      dirs: domainSearchDirs(),
    });
    console.log("当前领域：" + current + (declared ? "" : "（没指定，用默认）"));
    if (persisted.ANS_DOMAIN) {
      console.log("  记在 " + configPath() + " 里");
    }
    if (constraint.state === "failed") {
      // Showing the state is not a successful switch, but it is a real problem
      // the operator needs to see: exit non-zero so a script notices too.
      process.stderr.write(describeDomainFailure(constraint) + "\n");
      printAvailable();
      return 1;
    }
    if (constraint.state === "established") printResolved(constraint);
    printAvailable();
    console.log("换领域：ans domain <名字>");
    return 0;
  }

  const newDomain = args[0]!;
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
    } catch (e: any) {
      process.stderr.write(
        "没换成 " + newDomain + "。配置写不进去（" + (e?.message || String(e)) + "），" +
        "原来用的是 " + current + "，没动。\n",
      );
      return 1;
    }
    process.env.ANS_DOMAIN = newDomain;
    console.log("领域已换成：" + newDomain);
    console.log("  记在 " + configPath() + " 里，下次也用它");
    printResolved(constraint);
    console.log("");
    return 0;
  }
  // Unreachable: a name was given, so the constraint cannot be "undeclared".
  process.stderr.write("没换成 " + newDomain + "：没有可用的领域配置。\n");
  return 1;
}
