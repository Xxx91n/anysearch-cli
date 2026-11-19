// #305 / #297 S3 + N2: project index and URL policy follow the explicit
// project, and the plugin service is found by installation identity.
//
// N2 materials come from the existing project-index fixture: NBA/Knicks/
// Brunson rows in project A, a different NBA row in project B. The original
// query runs in B and must not surface A's rows; an explicit projects list
// is the only way to reuse A. Relevance rungs (strict then relaxed) and the
// bearer-token checks stay as they were.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectIndexStore } from "../src/index.js";
import { resolveHookProject } from "../src/hooks/project-identity.js";
import { resolveProjectContext } from "@anysearch-cli/store";

const PLUGIN_ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const TOKEN = "project-scope-token";

const A_ROWS = [
  ["Knicks win 2026 NBA Finals", "https://www.nba.com/news/knicks-win-2026-finals", "New York beat San Antonio 4-1 to claim the championship"],
  ["Brunson named NBA Finals MVP", "https://www.espn.com/nba/story/brunson-finals-mvp", "Jalen Brunson scored 45 in Game 5"],
] as const;
const B_ROWS = [
  ["NBA preseason schedule", "https://example.com/nba-schedule", "Preseason games start in October"],
] as const;

function project(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ans-scope-" + tag + "-"));
  // A Git root marks the project (the store resolver accepts a .git directory).
  mkdirSync(join(dir, ".git"));
  return dir;
}

function seed(store: ProjectIndexStore, root: string, rows: ReadonlyArray<readonly [string, string, string]>): void {
  rows.forEach(([title, url, snippet], index) => {
    store.indexEntry({
      projectPath: root, toolName: "search_web", title, url, snippet,
      source: "tavily", contentHash: root + "-h" + index,
    });
  });
}

test("project index: default scope is this project only (N2)", () => {
  const a = project("a");
  const b = project("b");
  const dbDir = mkdtempSync(join(tmpdir(), "ans-scope-db-"));
  const store = new ProjectIndexStore(join(dbDir, "pi.db"));
  try {
    seed(store, a, A_ROWS);
    seed(store, b, B_ROWS);

    const inB = store.search("latest NBA champion NBA Finals MVP", [b], 5);
    assert.equal(inB.length, 0, "project B must not see project A's rows");
    assert.ok(store.search("latest NBA champion NBA Finals MVP", [a], 5).length >= 2, "A keeps the original relevance rung");

    // The strict-then-relaxed rungs still work inside one project.
    const strict = store.search("Brunson Finals MVP", [a], 1);
    assert.equal(strict.length, 1);
    assert.match(strict[0]!.title, /Brunson/);
    assert.equal(strict[0]!.projectPath, a, "a hit names the project it came from");
    assert.ok(strict[0]!.createdAt, "a hit carries its create time (column alias)");
  } finally {
    store.close();
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  }
});

test("project index: cross-project read happens only when the caller asks (N2)", () => {
  const a = project("a2");
  const b = project("b2");
  const dbDir = mkdtempSync(join(tmpdir(), "ans-scope-db2-"));
  const store = new ProjectIndexStore(join(dbDir, "pi.db"));
  try {
    seed(store, a, A_ROWS);
    seed(store, b, B_ROWS);
    const both = store.search("latest NBA champion NBA Finals MVP", [a, b], 5);
    assert.ok(both.length >= 2, "explicit projects list reuses A");
    assert.equal(new Set(both.map((h) => h.projectPath)).size, 1, "B contributes no match for that query");
    assert.deepEqual(store.search("preseason schedule", [a, b], 5).map((h) => h.projectPath), [b]);
  } finally {
    store.close();
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  }
});

test("project index: dedupe and purge stay inside one project", () => {
  const a = project("a3");
  const b = project("b3");
  const dbDir = mkdtempSync(join(tmpdir(), "ans-scope-db3-"));
  const store = new ProjectIndexStore(join(dbDir, "pi.db"));
  try {
    // Same content hash in two projects: each keeps its own copy.
    for (const root of [a, b]) {
      store.indexEntry({ projectPath: root, toolName: "t", title: "same row", url: "u", snippet: "s", source: "x", contentHash: "same" });
      store.indexEntry({ projectPath: root, toolName: "t", title: "same row", url: "u", snippet: "s", source: "x", contentHash: "same" });
    }
    assert.equal(store.search("same row", [a], 10).length, 1);
    assert.equal(store.search("same row", [b], 10).length, 1);
    // Whitespace and duplicates are normalized before binding, so the number
    // of placeholders and the number of values always agree.
    assert.equal(store.search("same row", [" " + a + " ", a, ""], 10).length, 1);

    assert.equal(store.purgeProject(a), 1);
    assert.equal(store.search("same row", [a], 10).length, 0, "purge removes only the named project");
    assert.equal(store.search("same row", [b], 10).length, 1, "the other project is untouched");
    // An empty scope is a caller bug: it must not mean "everything".
    assert.throws(() => store.search("same row", [], 10), /project scope required/);
  } finally {
    store.close();
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  }
});

test("project identity: the hook copy matches the store resolver", () => {
  const gitProject = project("drift-git");
  const configured = mkdtempSync(join(tmpdir(), "ans-scope-drift-config-"));
  mkdirSync(join(configured, ".ans"), { recursive: true });
  writeFileSync(join(configured, ".ans", "config.toml"), "", "utf8");
  const plain = mkdtempSync(join(tmpdir(), "ans-scope-drift-plain-"));
  const nested = join(gitProject, "src", "deep");
  mkdirSync(nested, { recursive: true });
  try {
    for (const dir of [gitProject, nested, configured, plain]) {
      const hook = resolveHookProject(dir);
      const store = resolveProjectContext(dir);
      assert.equal(hook.root, store.root, "same root for " + dir);
      assert.equal(hook.source, store.source, "same source for " + dir);
      assert.equal(hook.reason, "reason" in store ? store.reason : undefined, "same reason for " + dir);
    }
    assert.equal(resolveHookProject(nested).root, realpathSync(gitProject), "a nested directory resolves to the project root");
    assert.equal(resolveHookProject(plain).root, null, "a plain directory has no project identity");
  } finally {
    for (const dir of [gitProject, configured, plain]) rmSync(dir, { recursive: true, force: true });
  }
});

function writeDomainToml(root: string, allow: string[], deny: string[]): void {
  mkdirSync(join(root, "domains"), { recursive: true });
  writeFileSync(join(root, "domains", "default.toml"), [
    'name = "default"',
    "[sources]",
    'enabled = ["tavily"]',
    "urlAllowlist = [" + allow.map((h) => JSON.stringify(h)).join(", ") + "]",
    "urlDenylist = [" + deny.map((h) => JSON.stringify(h)).join(", ") + "]",
    "[skills]",
    'active = ["search"]',
    "[hooks]",
    'toolWhitelist = ["search"]',
    "[rag]",
    'adapter = "none"',
    "",
  ].join("\n"), "utf8");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = address && typeof address === "object" ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

test("plugin server: recall, index and policy require the explicit project", async () => {
  const a = project("server-a");
  const b = project("server-b");
  const home = mkdtempSync(join(tmpdir(), "ans-scope-home-"));
  const plain = mkdtempSync(join(tmpdir(), "ans-scope-plain-"));
  writeDomainToml(a, ["a.example"], ["deny.example"]);
  writeDomainToml(b, ["b.example"], []);
  const port = await freePort();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^ANS_/.test(key)));
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    ANS_PROJECT_DB: join(home, "project-index.db"),
    ANS_SERVER_REGISTRY: join(home, "server.json"),
    ANS_SERVER_PORT: String(port),
    ANS_SERVER_TOKEN: TOKEN,
  });
  const proc = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
    cwd: PLUGIN_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    env,
  });
  const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
  const base = "http://127.0.0.1:" + port;
  const call = async (pathname: string, body: unknown) => {
    const response = await fetch(base + pathname, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    // Wait for the server.
    let ready = false;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(base + "/health", { headers: { Authorization: "Bearer " + TOKEN } });
        if (response.status === 200) { ready = true; break; }
      } catch { /* not up yet */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(ready, "plugin server did not become ready");

    // The server publishes the address it really bound, for hooks in any project.
    const published = JSON.parse(readFileSync(join(home, "server.json"), "utf8")) as { url?: string; pid?: number };
    assert.equal(published.url, base, "the published address is the listening address");
    assert.equal(published.pid, proc.pid, "the record names the live process");

    const indexedA = await call("/index", {
      projectPath: a, toolName: "search_web",
      entries: A_ROWS.map(([title, url, snippet], index) => ({ title, url, snippet, source: "tavily", contentHash: "a" + index })),
    });
    assert.equal(indexedA.status, 200);
    assert.equal(indexedA.body.project, realpathSync(a));
    const indexedB = await call("/index", {
      projectPath: b, toolName: "search_web",
      entries: B_ROWS.map(([title, url, snippet], index) => ({ title, url, snippet, source: "tavily", contentHash: "b" + index })),
    });
    assert.equal(indexedB.body.indexed, 1);

    const noProjectIndex = await call("/index", { toolName: "t", entries: [{ title: "x" }] });
    assert.equal(noProjectIndex.status, 400, "an index write without a project is refused");
    assert.match(noProjectIndex.body.error, /project identity required/);

    const noProjectRecall = await call("/recall", { query: "NBA" });
    assert.equal(noProjectRecall.status, 400, "an unscoped recall is refused");
    assert.match(noProjectRecall.body.error, /project identity required/);

    const unknownProject = await call("/recall", { query: "NBA", projectPath: plain });
    assert.equal(unknownProject.status, 400, "a directory that is not a project is refused");
    assert.match(unknownProject.body.error, /project identity unavailable/);

    const recallB = await call("/recall", { query: "latest NBA champion NBA Finals MVP", projectPath: b });
    assert.equal(recallB.status, 200);
    assert.deepEqual(recallB.body.projects, [realpathSync(b)]);
    assert.equal(recallB.body.hits.length, 0, "B does not receive A's rows");

    const recallA = await call("/recall", { query: "latest NBA champion NBA Finals MVP", projectPath: a });
    assert.ok(recallA.body.hits.length >= 2, "A keeps its own rows and relevance");

    const crossProject = await call("/recall", {
      query: "latest NBA champion NBA Finals MVP",
      projects: [a, b],
    });
    assert.equal(crossProject.status, 200);
    assert.ok(crossProject.body.hits.length >= 2, "the explicit cross-project read reuses A");
    assert.ok(
      crossProject.body.hits.every((hit: { projectPath: string }) => hit.projectPath === realpathSync(a)),
      "B still contributes no match for that query",
    );

    const policyA = await fetch(base + "/policy?project=" + encodeURIComponent(a), {
      headers: { Authorization: "Bearer " + TOKEN },
    });
    assert.equal(policyA.status, 200);
    const policyABody = await policyA.json() as { allow: string[]; deny: string[] };
    assert.deepEqual(policyABody.allow, ["a.example"]);
    assert.deepEqual(policyABody.deny, ["deny.example"]);

    const policyB = await fetch(base + "/policy?project=" + encodeURIComponent(b), {
      headers: { Authorization: "Bearer " + TOKEN },
    });
    const policyBBody = await policyB.json() as { allow: string[]; deny: string[] };
    assert.deepEqual(policyBBody.allow, ["b.example"]);
    assert.deepEqual(policyBBody.deny, []);

    const policyNoProject = await fetch(base + "/policy", { headers: { Authorization: "Bearer " + TOKEN } });
    assert.equal(policyNoProject.status, 400, "a policy answer needs the project it belongs to");

    // Each project keeps its own materialized cache; neither borrows the other.
    const cacheA = JSON.parse(readFileSync(join(a, ".ans", "policy.json"), "utf8")) as { allow: string[] };
    const cacheB = JSON.parse(readFileSync(join(b, ".ans", "policy.json"), "utf8")) as { allow: string[] };
    assert.deepEqual(cacheA.allow, ["a.example"]);
    assert.deepEqual(cacheB.allow, ["b.example"]);

    const purged = await call("/purge", { projectPath: a });
    assert.equal(purged.status, 200);
    assert.ok(purged.body.deleted >= 2);
    const afterPurgeA = await call("/recall", { query: "latest NBA champion NBA Finals MVP", projectPath: a });
    assert.equal(afterPurgeA.body.hits.length, 0);
    const afterPurgeB = await call("/recall", { query: "preseason schedule", projectPath: b });
    assert.equal(afterPurgeB.body.hits.length, 1, "purging A leaves B's rows alone");

    const purgeNoProject = await call("/purge", {});
    assert.equal(purgeNoProject.status, 400);
  } finally {
    const pid = proc.pid;
    if (pid) {
      if (process.platform === "win32") {
        const { spawnSync } = await import("node:child_process");
        try { spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ }
      } else {
        try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
      }
    }
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
    for (const dir of [a, b, home, plain]) rmSync(dir, { recursive: true, force: true });
  }
});
