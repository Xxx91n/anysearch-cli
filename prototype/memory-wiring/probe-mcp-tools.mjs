// PROTOTYPE — what tools does the r19 arm's MCP filter expose to the host?
// Spawns the paper repo's harness filter exactly as arm-profiles.mjs builds it:
//   node mcp-tool-filter.mjs --allow ans_chat -- node <anysearch-mcp dist>
// and compares with the unfiltered server. No LLM call is made here.
//
// Run: node prototype/memory-wiring/probe-mcp-tools.mjs

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

// Override these two if the paper checkout or the MCP build lives elsewhere.
const FILTER = process.env.PROBE_FILTER
  || "D:/Aworker/research/ALL/papers/anysearch-cli-demo/eval-r19/lib/mcp-tool-filter.mjs";
const MCP = process.env.PROBE_MCP
  || fileURLToPath(new URL("../../apps/mcp/dist/index.cjs", import.meta.url));

function rpcSession(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env, shell: false });
    const rl = createInterface({ input: child.stdout });
    const pending = new Map();
    const messages = [];
    let initialized = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error(label + ": timed out")); }, 60000);

    rl.on("line", (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { messages.push({ raw: line }); return; }
      messages.push(msg);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    });
    child.stderr.on("data", (d) => messages.push({ stderr: String(d).slice(0, 300) }));
    child.on("error", reject);

    const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
    const call = (id, method, params) => new Promise((res) => {
      pending.set(id, res);
      send({ jsonrpc: "2.0", id, method, params });
    });

    (async () => {
      const init = await call(1, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "memory-wiring-probe", version: "0.0.0" },
      });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      initialized = true;
      const list = await call(2, "tools/list", {});
      const blocked = await call(3, "tools/call", { name: "recall_memory", arguments: { query: "probe" } });
      clearTimeout(timer);
      child.kill();
      resolve({
        label,
        initialized: initialized && !init.error,
        tools: (list.result?.tools || []).map((t) => t.name),
        recallCall: blocked.error ? { error: blocked.error.message } : { result: "reached upstream" },
        messageCount: messages.length,
      });
    })().catch((e) => { clearTimeout(timer); child.kill(); reject(e); });
  });
}

const filtered = await rpcSession("node", [FILTER, "--allow", "ans_chat", "--", "node", MCP], "filtered-allow-ans_chat");
const unfiltered = await rpcSession("node", [MCP], "unfiltered");

console.log("filtered tools   =" + JSON.stringify(filtered.tools));
console.log("unfiltered tools =" + JSON.stringify(unfiltered.tools));
console.log("filtered recall_memory call = " + JSON.stringify(filtered.recallCall));
console.log("unfiltered recall_memory call = " + JSON.stringify(unfiltered.recallCall));

writeFileSync(join(OUT, "probe-mcp-tools.json"), JSON.stringify({ filtered, unfiltered }, null, 2));

const verdict = {
  sameToolSurface: JSON.stringify(filtered.tools) === JSON.stringify(unfiltered.tools),
  onlyAnsChat: filtered.tools.length === 1 && filtered.tools[0] === "ans_chat",
  recallBlockedLocally: !!filtered.recallCall.error,
  unfilteredHasRecall: unfiltered.tools.includes("recall_memory"),
};
console.log("VERDICT " + JSON.stringify(verdict));
