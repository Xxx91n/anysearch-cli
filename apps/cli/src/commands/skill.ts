// ans skill: directory convention + manifest + validation (#109, decision #92).
// Installation never changes the Active Domain or its Skill Active List.

import {
  installSkill, listInstalledSkills, managedSkillsRoot, skillManifestPath,
  uninstallSkill, validateInstalledSkills, SkillError, type SkillOptions,
} from "../skill-store";

export interface SkillCommandOptions extends SkillOptions {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

const HELP = `Usage: ans skill <command> [options]

Commands:
  install <source>   Copy a directory containing SKILL.md from a local Git checkout
  validate [name]    Validate installed SKILL.md frontmatter (all, or one skill)
  list               List skills recorded in installed.json
  uninstall <name>   Remove only the directory recorded in installed.json

Options:
  --project          Use .anysearch/skills/synced/ (default: user scope)
  --user             Use ~/.anysearch-cli/skills/synced/ explicitly
  --help, -h         Show this help

The source's current Git HEAD is recorded; checkout a commit/tag before installing.
Frontmatter must be a YAML mapping with a safe lowercase name (1–64 characters).
Machine-managed skills live in synced/; sibling directories are user-authored.
Installation does not activate a skill: edit [skills].active in Active Domain TOML.
Exit codes: 0 success · 1 validation/filesystem/manifest failure · 2 usage error
`;

/** Dispatch ans skill subcommands and map installer failures to CLI exit codes. */
export async function runSkill(args: string[], opts: SkillCommandOptions = {}): Promise<number> {
  const out = opts.stdout ?? ((text: string) => process.stdout.write(text));
  const err = opts.stderr ?? ((text: string) => process.stderr.write(text));
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    out(HELP);
    return 0;
  }
  const [command, ...rest] = args;
  if (!["install", "validate", "list", "uninstall"].includes(command)) {
    err(`ans skill: unknown subcommand ${command}\n${HELP}`);
    return 2;
  }
  let scope: "user" | "project" | undefined;
  const positional: string[] = [];
  for (const arg of rest) {
    if (arg === "--project" || arg === "--user") {
      const next = arg === "--project" ? "project" : "user";
      if (scope && scope !== next) {
        err("ans skill: choose only one of --project and --user\n");
        return 2;
      }
      scope = next;
    } else if (arg.startsWith("-") || !arg.trim()) {
      err(`ans skill: unknown option or empty argument: ${arg}\n`);
      return 2;
    } else {
      positional.push(arg);
    }
  }
  const minimum = command === "install" || command === "uninstall" ? 1 : 0;
  const maximum = command === "list" ? 0 : 1;
  if (positional.length < minimum || positional.length > maximum) {
    err(`ans skill: invalid arguments for ${command}\n${HELP}`);
    return 2;
  }
  const scopeOpts: SkillOptions = { ...opts, project: scope ? scope === "project" : opts.project };
  try {
    switch (command) {
      case "install": {
        const entry = installSkill(positional[0], scopeOpts);
        out(`Installed ${entry.name} to ${managedSkillsRoot(scopeOpts)}\n`
          + `Source: ${entry.source}\nCommit: ${entry.commit}${entry.tag ? ` (tag ${entry.tag})` : ""}${entry.dirty ? " [dirty source]" : ""}\n`
          + "Installed only; activation remains in Active Domain TOML ([skills].active).\n");
        return 0;
      }
      case "validate": {
        const results = validateInstalledSkills(scopeOpts, positional[0]);
        if (results.length === 0) out("No installed skills to validate.\n");
        for (const result of results) {
          out(result.ok ? `[OK] ${result.name}: SKILL.md frontmatter\n` : `[FAIL] ${result.name}: ${result.error}\n`);
        }
        return results.every((result) => result.ok) ? 0 : 1;
      }
      case "list": {
        const entries = listInstalledSkills(scopeOpts);
        out(`Installed skills (${scopeOpts.project ? "project" : "user"}): ${skillManifestPath(scopeOpts)}\n`);
        if (entries.length === 0) out("No installed skills.\n");
        for (const entry of entries) {
          out(`${entry.name}\t${entry.commit.slice(0, 12)}${entry.tag ? ` (${entry.tag})` : ""}${entry.dirty ? " [dirty]" : ""}\t${entry.source}\n`);
        }
        return 0;
      }
      case "uninstall": {
        const entry = uninstallSkill(positional[0], scopeOpts);
        out(`Uninstalled ${entry.name}. Domain TOML was not changed.\n`);
        return 0;
      }
    }
  } catch (error) {
    err(`ans skill: ${(error as Error).message}\n`);
    return error instanceof SkillError ? error.exitCode : 1;
  }
  return 2;
}
