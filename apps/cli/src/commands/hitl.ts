// ans hitl — HITL review queue for shouldAllowUrl-blocked retrieved-derived URLs.
// headless runs deny-first + enqueue to .anysearch-cli/hitl.pending (JSONL);
// `ans hitl review` lists the queue; `--allow-url <host>` pre-authorizes a host by writing
// it into the active domain's [sources] urlAllowlist and drops matching pending entries.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { atomicWriteFile, canonicalVersion, defaultDomainsDirs, domainTomlPath, emitConfigChangeAudit, loadDomainByNameIn } from "@anysearch-cli/store";
import { resolveActiveDomain } from "@anysearch-cli/store/local-service";
import { domainSearchDirs } from "../db";
import { resolveDbPath } from "@anysearch-cli/kernel";

interface HitlEntry {
  url: string;
  host: string;
  toolName: string;
  reason: string;
  at: string;
}

function queuePath(): string {
  return join(process.cwd(), ".anysearch-cli", "hitl.pending");
}

function readQueue(): HitlEntry[] {
  const p = queuePath();
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l) as HitlEntry; } catch { return null; }
    })
    .filter((e): e is HitlEntry => !!e);
}

// Add host to the active domain TOML [sources].urlAllowlist (append-style, section-replace
// semantics preserved). Returns true on write.
function allowHost(host: string): boolean {
  const domainName = resolveActiveDomain().name;
  const dirs = domainSearchDirs();
  const tomlPath = domainTomlPath(process.cwd(), domainName, dirs);
  if (!existsSync(tomlPath)) throw new Error("domain TOML not found: " + tomlPath);
  const beforeHosts = loadDomainByNameIn(domainName, dirs).sources.urlAllowlist ?? [];
  // An already-allowed host writes nothing but still clears its queue entries,
  // so it must not trip the writability check below.
  if (beforeHosts.includes(host)) return false;
  // Only the operator's own dirs are writable: a TOML found elsewhere (the
  // packaged domains dir, or a parent project's) is shared by other projects,
  // replaced on upgrade, or read-only in a global install.
  const writableDirs = defaultDomainsDirs();
  if (!writableDirs.map((d) => resolve(d)).includes(resolve(dirname(tomlPath)))) {
    throw new Error(
      "refusing to write " + tomlPath + ": it is outside your own domains dirs ("
      + writableDirs.join(", ") + "). Copy the TOML there, or set ANS_DOMAINS_DIR, and re-run.",
    );
  }
  const src = readFileSync(tomlPath, "utf8");
  const lines = src.split("\n");
  const srcStart = lines.findIndex((l) => l.trim() === "[sources]");
  let next: string[];
  if (srcStart < 0) {
    next = [...lines, "", "[sources]", 'urlAllowlist = ["' + host + '"]', ""];
  } else {
    let srcEnd = lines.length;
    for (let i = srcStart + 1; i < lines.length; i++) {
      if (/^\s*\[.+\]\s*$/.test(lines[i]!)) { srcEnd = i; break; }
    }
    const alIdx = lines.findIndex((l, i) => i >= srcStart && i < srcEnd && /^\s*urlAllowlist\s*=/.test(l));
    if (alIdx >= 0) {
      const m = lines[alIdx]!.match(/^(.*urlAllowlist\s*=\s*\[)([^\]]*)(\].*)$/);
      if (!m) throw new Error("cannot parse urlAllowlist line: " + lines[alIdx]);
      const hosts = m[2]!.split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
      hosts.push(host);
      next = [...lines];
      next[alIdx] = m[1] + hosts.map((h) => '"' + h + '"').join(", ") + m[3];
    } else {
      next = [...lines.slice(0, srcStart + 1), 'urlAllowlist = ["' + host + '"]', ...lines.slice(srcStart + 1)];
    }
  }
  // D5: structured atomic write (tmp + rename); round-trip verify below.
  atomicWriteFile(tomlPath, next.join("\n"));
  // Verify: the written TOML must still parse and expose the host.
  const schema = loadDomainByNameIn(domainName, domainSearchDirs());
  if (!(schema.sources.urlAllowlist ?? []).includes(host)) {
    throw new Error("allowlist write did not round-trip for host" + host);
  }
  // D8: ConfigChange audit event into the local trace store (fail-open).
  void emitConfigChangeAudit(resolveDbPath(), {
    actor: "cli",
    source: "cli",
    path: tomlPath,
    change: { before: beforeHosts, after: schema.sources.urlAllowlist ?? [] },
    policyVersion: canonicalVersion(schema.sources.urlAllowlist ?? [], schema.sources.urlDenylist ?? []),
  });
  return true;
}

export async function runHitl(args: string[]): Promise<number> {
  const sub = args[0];
  const allowIdx = args.indexOf("--allow-url");
  const allowHostArg = allowIdx >= 0 ? args[allowIdx + 1] : undefined;

  if (allowIdx >= 0 && !allowHostArg) {
    process.stderr.write("ans hitl: --allow-url requires a host\n");
    return 1;
  }

  if (!sub || sub === "--help" || sub === "-h" || (sub === "review" && !allowHostArg)) {
    if (sub !== "review") {
      process.stdout.write([
        "ans hitl — review queue for blocked retrieved-derived URLs",
        "",
        "Commands:",
        "  review                    List queued URLs awaiting human review",
        "  review --allow-url <host> Allow a host persistently (writes [sources] urlAllowlist) and clear its queue entries",
        "",
      ].join("\n"));
      return 0;
    }
    const entries = readQueue();
    if (entries.length === 0) {
      process.stdout.write("hitl queue empty\n");
      return 0;
    }
    for (const e of entries) {
      process.stdout.write(e.at + "  " + e.host + "  " + e.url + "  (" + e.reason + ")\n");
    }
    process.stdout.write(entries.length + " pending; run `ans hitl review --allow-url <host>` to authorize\n");
    return 0;
  }

  if (sub === "review" && allowHostArg) {
    const host = allowHostArg.trim().toLowerCase().replace(/^\.+/, "");
    if (!/^[a-z0-9.-]+$/.test(host)) {
      process.stderr.write("ans hitl: invalid host" + allowHostArg + "\n");
      return 1;
    }
    const changed = allowHost(host);
    const remaining = readQueue().filter((e) => e.host !== host && !e.host.endsWith("." + host));
    mkdirSync(join(process.cwd(), ".anysearch-cli"), { recursive: true });
    writeFileSync(queuePath(), remaining.map((e) => JSON.stringify(e)).join("\n") + (remaining.length ? "\n" : ""), "utf8");
    process.stdout.write(
      (changed ? "allowed " + host : "already allowed" + host) +
      "; queue now" + remaining.length + " pending\n",
    );
    return 0;
  }

  process.stderr.write("ans hitl: unknown subcommand" + sub + "\n");
  return 1;
}
