// #311 — 常驻 MCP 服务自己那条进程记录。
//
// 为什么单独测它：升级报告里"哪些入口还在跑旧代码"靠的就是这条记录。宿主起的
// `ans-mcp` 是一个常驻进程，可以活过整场升级；它不登记，报告就只能说"没有入口
// 还在旧版上"——那是假的。
//
// 钉住三件事：
//  1. 登记出来的是 entry='mcp' 的一行，不是任务行；
//  2. 有 build-info 时记下自己的构建，没有时记 NULL（不拿磁盘上的版本冒充）；
//  3. 登记表坏了只 warn，服务照起（返回的句柄是个空操作，不抛）。
//
// Run: pnpm --filter @anysearch-cli/mcp test

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTaskRegistry } from "@anysearch-cli/store";
import { mcpBuildId, registerMcpProcess } from "../src/mcp-process";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log("  PASS " + label); }
  else { failed++; console.error("  FAIL " + label + (detail ? ": " + detail : "")); }
}

function main(): void {
  const dir = mkdtempSync(join(tmpdir(), "ans-311-mcp-process-"));
  try {
    const dbPath = join(dir, "anysearch.db");

    // ---- 1. 登记一行 entry='mcp'，不是任务 ----
    {
      const warnings: string[] = [];
      const record = registerMcpProcess(dbPath, (m) => { warnings.push(m); });
      check("1: 登记没有 warn", warnings.length === 0, warnings.join(" / "));
      const registry = openTaskRegistry(dbPath);
      try {
        const processes = registry.openProcesses();
        check("1: 有一行 entry=mcp 的进程记录",
          processes.length === 1 && processes[0]!.entry === "mcp", JSON.stringify(processes));
        check("1: 没有任务行（常驻服务不是一条永远干不完的活）",
          registry.openTasks().length === 0, JSON.stringify(registry.openTasks()));
        // 2. build：这个包本地单独构建时没有 dist/build-info.json → NULL。
        const expected = mcpBuildId();
        check("2: 记下的构建和这个包自己的戳一致",
          processes[0]!.build === (expected ?? null),
          "recorded=" + String(processes[0]!.build) + " expected=" + String(expected ?? null));
        if (expected === undefined) {
          check("2: 没打标就记 NULL，不拿磁盘上的版本补", processes[0]!.build === null);
        }
      } finally { registry.close(); }
      record.end();
      const after = openTaskRegistry(dbPath);
      try {
        check("1: end() 写下结束", after.openProcesses().length === 0);
      } finally { after.close(); }
      // 重复 end 是空操作，不抛。
      record.end();
      check("1: 重复 end() 不抛", true);
    }

    // ---- 3. 登记表坏了：warn 一句，服务照起 ----
    {
      const warnings: string[] = [];
      // 把库路径指到一个目录上：打不开，也就登记不了。
      const record = registerMcpProcess(dir, (m) => { warnings.push(m); });
      check("3: 打不开库时 warn 一句", warnings.length === 1, warnings.join(" / "));
      check("3: warn 说清是没登记，不是服务失败",
        warnings[0]!.includes("unrecorded"), warnings[0]);
      record.end();
      check("3: 空句柄的 end() 不抛", true);
    }
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\nmcp process tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main();
