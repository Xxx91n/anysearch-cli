// #311 — build-info.json 只认自己的格式。
//
// 这份文件回答"磁盘上这份代码是哪一版"，升级报告整个版本栏都读它。不是我们的
// 文件不能混进来：别的工具写的 JSON 也有 version/commit，照着读过来就会把别人的
// 版本当成"我们装的是这一版"。
//
// 钉住三件事：
//  1. 格式对的文件读得出来，字段照原样给；
//  2. schema 对不上、缺 schema、字段不全，一律 null（不替别人的文件编一个 tag）；
//  3. 没有 build-info 的构建报 null，`buildId` 只在有戳时才有值。
//
// Run: pnpm -C packages/store test

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILD_INFO_SCHEMA, buildId, readBuildInfo } from "../src/build-info";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log("  PASS " + label); }
  else { failed++; console.error("  FAIL " + label + (detail ? ": " + detail : "")); }
}

const dir = mkdtempSync(join(tmpdir(), "ans-311-build-info-"));
let seq = 0;
function writeFile(body: unknown): string {
  const file = join(dir, "info-" + seq++ + ".json");
  writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body, null, 2), "utf8");
  return file;
}

function main(): void {
  try {
    // ---- 1. 我们的文件：字段照原样 ----
    {
      const file = writeFile({
        schema: BUILD_INFO_SCHEMA,
        packageName: "@anysearch-cli/cli",
        version: "0.2.0",
        commit: "cbefccab90e66d54fe03c712b6232c3bec029347",
        dirty: true,
        builtAt: "2026-11-20T00:00:00.000Z",
      });
      const info = readBuildInfo(file);
      check("1: 读得出来", info !== null, String(info));
      check("1: 版本、commit、构建时间原样给",
        info?.version === "0.2.0" &&
        info?.commit === "cbefccab90e66d54fe03c712b6232c3bec029347" &&
        info?.builtAt === "2026-11-20T00:00:00.000Z",
        JSON.stringify(info));
      check("1: buildId 是短标识", info !== null && buildId(info) === "0.2.0+cbefccab-dirty",
        info === null ? "读不出来" : buildId(info));
    }

    // ---- 2. 不是我们的文件：一律 null ----
    {
      const foreign = writeFile({ schema: "someone-elses/build@7", version: "9.9.9", commit: "deadbeef" });
      check("2: schema 对不上就是 null", readBuildInfo(foreign) === null, JSON.stringify(readBuildInfo(foreign)));

      const untagged = writeFile({ version: "0.2.0", commit: "cbefccab", dirty: false });
      check("2: 没有 schema 也是 null（不替它贴我们的 tag）", readBuildInfo(untagged) === null,
        JSON.stringify(readBuildInfo(untagged)));

      const truncated = writeFile({ schema: BUILD_INFO_SCHEMA, version: "0.2.0" });
      check("2: 字段不全就是 null", readBuildInfo(truncated) === null, JSON.stringify(readBuildInfo(truncated)));

      check("2: 坏 JSON 是 null", readBuildInfo(writeFile("{ not json")) === null);
      check("2: 文件不在也是 null", readBuildInfo(join(dir, "absent.json")) === null);
    }

    // ---- 3. 老构建没记的字段：报 null，不补 ----
    {
      const file = writeFile({
        schema: BUILD_INFO_SCHEMA,
        version: "0.1.0",
        commit: "nogit",
        dirty: null,
      });
      const info = readBuildInfo(file);
      check("3: 缺 builtAt 报 null（不填当下时间）", info !== null && info.builtAt === null,
        JSON.stringify(info));
      check("3: 没记脏不脏也是 null（不猜干净）", info !== null && info.dirty === null, JSON.stringify(info));
      check("3: 没 packageName 就不给这一栏", info !== null && info.packageName === undefined,
        JSON.stringify(info));
      check("3: nogit 构建的 buildId 不带 commit", info !== null && buildId(info) === "0.1.0+nogit",
        info === null ? "读不出来" : buildId(info));
    }
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\nbuild-info tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main();
