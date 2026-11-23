// ans skill: directory convention + manifest + validation (#109, decision #92).
// Installation never changes the Active Domain or its active skill list.

import { join } from "node:path";
import {
  inspectInstalledSkills, installSkill, MANAGED_SKILLS_REL_PATH,
  managedSkillsRoot, skillManifestPath, skillNotes,
  uninstallSkill, validateInstalledSkills, SkillError, type SkillOptions,
} from "../skill-store";

export interface SkillCommandOptions extends SkillOptions {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

const HELP = `Usage: ans skill <command> [options]

Commands:
  install <source>   Copy a directory containing SKILL.md from a local Git checkout
  validate [name]    Check installed SKILL.md against the Agent Skills spec (all, or one skill)
  list               List skills recorded in installed.json
  uninstall <name>   Remove only the directory recorded in installed.json

Options:
  --project          Use .ans/${MANAGED_SKILLS_REL_PATH} (default: user scope)
  --user             Use ~/.ans/${MANAGED_SKILLS_REL_PATH} explicitly
  --help, -h         Show this help

The source's current Git HEAD is recorded; checkout a commit/tag before installing.
Checked rules (agentskills.io/specification plus a few house rules): frontmatter is a YAML
mapping; name is 1–64 lowercase letters/digits with single hyphens and is not a Windows
device name; description is 1–1024 characters; the body stays under 500 lines. A description
that never says when to use the skill gets a note (keyword match: when / 什么时候用 / 使用时 /
とき …) and is still accepted. validate also requires name to equal the installed directory name;
install accepts any source folder name (a cloned repo usually has its own) and installs
under the name the frontmatter declares.
Managed skills live in ${MANAGED_SKILLS_REL_PATH}; sibling directories under skills/ are user-authored.
install copies the whole skill directory into ${MANAGED_SKILLS_REL_PATH}; the runtime never loads it (a host agent reads the files directly).
[skills].active is just a list of keys for [skills.toolRequires], unrelated to directories in ${MANAGED_SKILLS_REL_PATH}.
Without [skills.toolRequires] (all shipped domains omit it), [skills].active changes nothing at runtime.
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
        const entry = await installSkill(positional[0], scopeOpts);
        // The note reads what was installed, like validate does — the source may
        // already have moved on. Installing is never blocked by it either way.
        const notes = skillNotes(join(managedSkillsRoot(scopeOpts), entry.name, "SKILL.md"));
        out(`Installed ${entry.name} to ${managedSkillsRoot(scopeOpts)}\n`
          + `Source: ${entry.source}\nCommit: ${entry.commit}${entry.tag ? ` (tag ${entry.tag})` : ""}${entry.dirty ? " [dirty source]" : ""}\n`
          + "Installed only; activation remains in Active Domain TOML ([skills].active).\n");
        for (const note of notes) out(`note: ${note}\n`);
        return 0;
      }
      case "validate": {
        const selected = positional[0];
        if (selected === undefined) {
          for (const warning of inspectInstalledSkills(scopeOpts).warnings) err(`ans skill: ${warning}\n`);
        }
        const results = validateInstalledSkills(scopeOpts, selected);
        if (results.length === 0) out("No installed skills to validate.\n");
        for (const result of results) {
          if (!result.ok) {
            out(`[FAIL] ${result.name}: ${result.error}\n`);
            continue;
          }
          out(`[OK] ${result.name}: SKILL.md name, description and body follow the spec\n`);
          for (const note of result.notes ?? []) out(`note: ${note}\n`);
        }
        return results.every((result) => result.ok) ? 0 : 1;
      }
      case "list": {
        // inspectInstalledSkills reconciles residue when no writer holds the lock.
        const listing = inspectInstalledSkills(scopeOpts);
        for (const warning of listing.warnings) err(`ans skill: ${warning}\n`);
        out(`Installed skills (${scopeOpts.project ? "project" : "user"}): ${skillManifestPath(scopeOpts)}\n`);
        if (listing.skills.length === 0) out("No installed skills.\n");
        for (const entry of listing.skills) {
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
