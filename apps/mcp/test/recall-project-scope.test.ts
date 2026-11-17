// #305: the MCP recall fallback names its project.
//
// The plugin server owns the project index, so MCP must send the explicit
// project root instead of opening a second database handle. These tests use a
// local stand-in for the plugin server and assert the request body plus the
// unknown-project report; the plugin server's own scoping is covered by
// apps/plugin/test/project-scope.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recallProjectIndex } from "../src/project-index.js";

function project(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ans-mcp-scope-" + tag + "-"));
  mkdirSync(join(dir, ".anysearch"), { recursive: true });
  writeFileSync(join(dir, ".anysearch", "config.toml"), "", "utf8");
  return dir;
}

async function fakePluginServer(
  hits: unknown[],
): Promise<{ url: string; bodies: Array<Record<string, unknown>>; close: () => Promise<void> }> {
  const bodies: Array<Record<string, unknown>> = [];
  const srv = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => raw += chunk);
    req.on("end", () => {
      try { bodies.push(JSON.parse(raw) as Record<string, unknown>); } catch { bodies.push({}); }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ hits }));
    });
  });
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const address = srv.address();
  const port = address && typeof address === "object" ? address.port : 0;
  return {
    url: "http://127.0.0.1:" + port,
    bodies,
    close: () => new Promise<void>((resolve) => srv.close(() => resolve())),
  };
}

test("recall fallback sends the current project and parses the hits", async () => {
  const current = project("current");
  const other = project("other");
  const previous = { cwd: process.cwd(), url: process.env.ANS_SERVER_URL, token: process.env.ANS_SERVER_TOKEN };
  const server = await fakePluginServer([
    { title: "Knicks win 2026 NBA Finals", url: "https://www.nba.com/news/x", snippet: "New York beat San Antonio", source: "tavily", rank: 1, createdAt: "now", projectPath: realpathSync(current) },
  ]);
  process.chdir(current);
  process.env.ANS_SERVER_URL = server.url;
  process.env.ANS_SERVER_TOKEN = "mcp-scope-token";
  try {
    const single = await recallProjectIndex("Knicks Finals", 3);
    assert.equal(single.hits.length, 1);
    assert.equal(single.hits[0]!.title, "Knicks win 2026 NBA Finals");
    assert.equal(server.bodies[0]!.projectPath, realpathSync(current), "one project is the default scope");
    assert.deepEqual(single.projects, [realpathSync(current)]);

    const cross = await recallProjectIndex("Knicks Finals", 3, [other]);
    assert.deepEqual(
      server.bodies[1]!.projects,
      [realpathSync(current), realpathSync(other)],
      "only an explicit projectPaths list widens the scope",
    );
    assert.equal(cross.projects.length, 2);
  } finally {
    process.chdir(previous.cwd);
    if (previous.url === undefined) delete process.env.ANS_SERVER_URL; else process.env.ANS_SERVER_URL = previous.url;
    if (previous.token === undefined) delete process.env.ANS_SERVER_TOKEN; else process.env.ANS_SERVER_TOKEN = previous.token;
    await server.close();
    rmSync(current, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test("recall fallback reports an unknown project instead of borrowing one", async () => {
  const plain = mkdtempSync(join(tmpdir(), "ans-mcp-scope-plain-"));
  const home = mkdtempSync(join(tmpdir(), "ans-mcp-scope-home-"));
  const previous = {
    cwd: process.cwd(),
    url: process.env.ANS_SERVER_URL,
    token: process.env.ANS_SERVER_TOKEN,
    home: process.env.HOME,
    profile: process.env.USERPROFILE,
  };
  process.chdir(plain);
  // No env token and an empty install dir: sharedToken() must not read or
  // create anything in the operator's home.
  delete process.env.ANS_SERVER_TOKEN;
  process.env.ANS_SERVER_URL = "http://127.0.0.1:1";
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const recall = await recallProjectIndex("anything", 3);
    assert.equal(recall.hits.length, 0);
    assert.match(recall.note ?? "", /project index unavailable/);
  } finally {
    process.chdir(previous.cwd);
    for (const [key, value] of Object.entries({
      ANS_SERVER_URL: previous.url,
      ANS_SERVER_TOKEN: previous.token,
      HOME: previous.home,
      USERPROFILE: previous.profile,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(plain, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
