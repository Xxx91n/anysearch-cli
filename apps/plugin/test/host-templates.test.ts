// Host template checks — one test per rule, covering all four shipped
// configs/*/hooks.json at once.
//
// The templates are what a user copies into a host, and the `ans host connect`
// candidates in apps/cli/src/host-wiring/hosts.ts are what the CLI writes.
// The two must describe the same hooks: same event, matcher, command and
// timeout. They drifted apart before (codebuddy kept a `node "$(npm root -g)"`
// command while hosts.ts used ans-hook-codebuddy), and no test compared them.
//
// The comparison normalizes both sides to { event: [{ matcher?, hooks: [...] }] }:
// the Codex candidates live in a TOML array table, the Antigravity template is
// a named-hook map whose invocation events are flat handlers, and the other
// three templates are settings JSON. Only hook units are compared — MCP
// registrations stay out of scope.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOSTS } from "../../cli/src/host-wiring/hosts.ts";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("  PASS " + name); }
  catch (e) { failed++; console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message : String(e))); }
}

const PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONFIGS = join(PLUGIN_ROOT, "configs");

/** The bin each host's hooks must call, and the shared SessionStart command where the host takes the envelope. */
const HOST_BIN: Record<string, { adapter: string; sessionStart?: string }> = {
  claude: { adapter: "ans-hook-claude", sessionStart: "ans-hook-session-start --envelope" },
  // CodeBuddy's SessionStart takes raw stdout text, not the shared
  // --envelope shape, so its own adapter stays on all three events.
  codebuddy: { adapter: "ans-hook-codebuddy" },
  codex: { adapter: "ans-hook-codex", sessionStart: "ans-hook-session-start --envelope" },
  antigravity: { adapter: "ans-hook-antigravity" },
};

function expectedCommand(hostId: string, event: string): string {
  const bins = HOST_BIN[hostId];
  assert.ok(bins, "no bin mapping for host " + hostId + " — add one when a host is added");
  if (event === "SessionStart" && bins.sessionStart) return bins.sessionStart;
  return hostId === "antigravity" ? bins.adapter + " " + event : bins.adapter;
}

function templateHostIds(): string[] {
  return readdirSync(CONFIGS).filter((name) => existsSync(join(CONFIGS, name, "hooks.json"))).sort();
}

/** Event map of one template, whether it is `{hooks:{...}}` or a named-hook map `{"<name>":{...}}`. */
function templateEvents(hostId: string): Record<string, unknown[]> {
  const cfg = JSON.parse(readFileSync(join(CONFIGS, hostId, "hooks.json"), "utf8"));
  if (cfg.hooks && typeof cfg.hooks === "object" && !Array.isArray(cfg.hooks)) return cfg.hooks;
  const names = Object.keys(cfg);
  assert.equal(names.length, 1, hostId + ": a named-hook map must hold exactly one hook name");
  return cfg[names[0]];
}

type Handler = { type: string; command: string; timeout: number };
type Group = { matcher?: string; hooks: Handler[] };

/** Both hosts use matcher groups with `hooks[]` for tool events and flat handlers for the rest. */
function normalizeGroup(entry: any): Group {
  if (Array.isArray(entry?.hooks)) {
    return entry.matcher === undefined ? { hooks: entry.hooks } : { matcher: entry.matcher, hooks: entry.hooks };
  }
  return { hooks: [entry] };
}

function templateUnits(hostId: string): Record<string, Group[]> {
  const out: Record<string, Group[]> = {};
  for (const [event, entries] of Object.entries(templateEvents(hostId))) {
    assert.ok(Array.isArray(entries) && entries.length > 0, hostId + "." + event + ": entries required");
    out[event] = entries.map(normalizeGroup);
  }
  return out;
}

function isHookEventMap(value: unknown): value is Record<string, unknown[]> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value).every((entries) => Array.isArray(entries) && entries.length > 0);
}

function candidateUnits(hostId: string): Record<string, Group[]> {
  const host = HOSTS[hostId];
  assert.ok(host, "hosts.ts HOSTS has no " + hostId + " — the template would have nowhere to connect");
  const out: Record<string, Group[]> = {};
  const add = (event: string, group: Group) => (out[event] ??= []).push(group);
  for (const file of host.files) {
    for (const unit of file.units) {
      if (unit.type === "json-hook-array") {
        add(String(unit.path[unit.path.length - 1]), normalizeGroup(unit.candidate));
      } else if (unit.type === "toml-array-table") {
        add(unit.name.split(".").pop(), normalizeGroup(unit.candidate));
      } else if (unit.type === "json-key" && isHookEventMap(unit.candidate)) {
        for (const [event, entries] of Object.entries(unit.candidate)) {
          for (const entry of entries) add(event, normalizeGroup(entry));
        }
      }
    }
  }
  return out;
}

function eachHandler(visit: (hostId: string, event: string, handler: Handler) => void) {
  for (const hostId of templateHostIds()) {
    for (const [event, groups] of Object.entries(templateUnits(hostId))) {
      for (const group of groups) for (const handler of group.hooks) visit(hostId, event, handler);
    }
  }
}

test("hosts.ts HOSTS and the shipped templates name the same hosts", () => {
  assert.deepEqual(templateHostIds(), Object.keys(HOSTS).sort(),
    "every host in HOSTS needs a template, and every template needs a HOSTS entry");
});

test("every timeout is a positive whole number of seconds", () => {
  eachHandler((hostId, event, handler) => {
    const where = hostId + "." + event + " (" + handler.command + ")";
    assert.ok(Number.isInteger(handler.timeout), where + ": timeout must be a whole number, got " + JSON.stringify(handler.timeout));
    assert.ok(handler.timeout > 0, where + ": timeout must be positive, got " + handler.timeout);
  });
});

test("every template command is the host's own adapter or bin", () => {
  eachHandler((hostId, event, handler) => {
    assert.equal(handler.command, expectedCommand(hostId, event),
      hostId + "." + event + ": a copied adapter from another host fails here");
  });
});

test("shipped hook entries match the hosts.ts connect candidates", () => {
  for (const hostId of templateHostIds()) {
    assert.deepEqual(templateUnits(hostId), candidateUnits(hostId),
      "configs/" + hostId + "/hooks.json and HOSTS." + hostId + " describe different hooks");
  }
});

process.on("exit", () => {
  console.log("  host-templates: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exitCode = 1;
});
