// #305: the local service is found by installation identity.
//
// The token file and the published address live under the user config root,
// not under whatever directory a hook or the server started in. These tests
// pin that layout, the env override precedence, the loopback-only record, and
// the dead-process guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SERVER_URL,
  clearServerRegistry,
  projectIndexDbPath,
  readServerRegistry,
  resolveServerEndpoint,
  resolveServerToken,
  serverRegistryPath,
  serverTokenPath,
  writeServerRegistry,
} from "../src/server/token.js";

function homeEnv(tag: string): { home: string; env: NodeJS.ProcessEnv } {
  const home = mkdtempSync(join(tmpdir(), "ans-discovery-" + tag + "-"));
  return { home, env: { HOME: home, USERPROFILE: home } as NodeJS.ProcessEnv };
}

test("token: one file per installation, shared by every project's hook", () => {
  const { home, env } = homeEnv("token");
  try {
    assert.equal(serverTokenPath(env), join(home, ".anysearch-cli", "server-token"));
    const first = resolveServerToken(env);
    assert.equal(first.generated, true);
    assert.equal(readFileSync(first.path, "utf8").trim(), first.token, "the token is persisted for the next caller");
    const second = resolveServerToken(env);
    assert.equal(second.generated, false);
    assert.equal(second.token, first.token, "a second caller reads the same token instead of minting one");
    assert.equal(projectIndexDbPath(env), join(home, ".anysearch", "project-index.db"), "the shared index lives in the data root");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("endpoint: explicit env, then the published address, then the default", () => {
  const { home, env } = homeEnv("endpoint");
  try {
    assert.equal(resolveServerEndpoint(env).source, "default");
    assert.equal(resolveServerEndpoint(env).url, DEFAULT_SERVER_URL);

    writeServerRegistry("http://127.0.0.1:45678", env);
    const published = resolveServerEndpoint(env);
    assert.equal(published.source, "registry");
    assert.equal(published.url, "http://127.0.0.1:45678");
    assert.equal(published.token, resolveServerToken(env).token);

    const withEnv = { ...env, ANS_SERVER_URL: "http://127.0.0.1:45679/", ANS_SERVER_TOKEN: "env-token" } as NodeJS.ProcessEnv;
    const explicit = resolveServerEndpoint(withEnv);
    assert.equal(explicit.source, "env");
    assert.equal(explicit.url, "http://127.0.0.1:45679", "trailing slash is trimmed");
    assert.equal(explicit.token, "env-token", "an explicit token wins without reading the file");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("published address: loopback only, and a dead owner is ignored", () => {
  const { home, env } = homeEnv("registry");
  try {
    assert.throws(() => writeServerRegistry("http://example.com:1234", env), /loopback/);
    writeServerRegistry("http://127.0.0.1:45680", env);
    const entry = readServerRegistry(env);
    assert.equal(entry?.url, "http://127.0.0.1:45680");
    assert.equal(entry?.pid, process.pid);

    // A record whose process is gone must not keep pointing callers at a port
    // nobody listens on.
    writeFileSync(serverRegistryPath(env), JSON.stringify({ url: "http://127.0.0.1:45681", pid: 2147483646 }), "utf8");
    assert.equal(readServerRegistry(env), null);
    assert.equal(resolveServerEndpoint(env).source, "default");

    writeServerRegistry("http://127.0.0.1:45682", env);
    clearServerRegistry(env);
    assert.equal(readServerRegistry(env), null, "our own record is removed on shutdown");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
