#!/usr/bin/env node
// #267：包打出来装好以后，到底能不能用。
//
// 为什么要有这条车道
// ------------------
// install-smoke.mjs 已经在打包和安装了，但它只驱动安装后的
// `ans --version / doctor / domain / search`。装出来的 MCP 从来没被启动过，
// ans_chat 没跑过一轮，会话没续过，材料没整理过，旧库能不能打开也没查过。
// 于是"包能装上"和"人能拿它干活"是两句话，而只有前一句被自动检查了
// （这是 #255 里的 T6）。
//
// 这条车道查什么（全部对着这次刚打出来的包）
// ------------------------------------------
//   A. 装出来的 CLI：--version / doctor / consolidate 没范围要拒绝
//   B. 装出来的 MCP：initialize + tools/list，然后真跑一轮 ans_chat
//   C. 会话续接：第二轮请求里必须带着第一轮的问答
//   D. 整理：dry-run 不落库，apply 写一条知识行，用量和费用如实报
//   E. 内部搜索入库 → 另一个会话用 query_knowledge 把那行捞回来
//   F. 旧一点的库：能打开、能迁移、原来的行还在、再开一次不报错
//
// 这条车道守的三条规矩
// --------------------
// - 没配置模型端点就打 SKIPPED 并标成"这轮没跑全"，绝不把没跑的写成通过。
// - 模型是本地假端点。它只能证明接线、请求形状、记账路径，不能证明真实
//   模型判断得好不好。
// - 不碰 r19，也不碰任何正式实验库；所有东西都在临时目录里，跑完删掉。
//
// 用法：node scripts/installed-acceptance.mjs
// 环境：EXA_API_KEY / TAVILY_API_KEY（车道 E 用，没有就跳）
//      ANS_ACC_TARBALLS=<目录>  直接装这个目录里的包，不本地打包。
//                               用来在没编译的情况下核对脚本本身。
// 退出码 0 = 能跑的几条都过了；1 = 真的有失败。

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

let passed = 0;
let failed = 0;
let skipped = 0;
function check(cond, name, detail) {
  if (cond) { passed++; console.log("[OK]   " + name); }
  else { failed++; console.error("[FAIL] " + name + (detail ? " — " + String(detail).slice(0, 400) : "")); }
}
function skip(name, why) { skipped++; console.log("[SKIP] " + name + " — " + why); }

// ---------- the controlled model endpoint ----------
//
// 一个本地 SSE 端点，按请求内容分三类回话。不按到达顺序分，因为整理调用
// 和对话轮次真的会交错：
//   - 要搜索的     -> 回一个 tool_call，让内部搜索真跑起来
//   - 整理         -> 回那句事实文本
//   - 其他         -> 回一句带着轮次标记的话
const FACT = "Acme online support runs weekdays 9:00-17:00.";
// 只有"范围外"那份材料才带的事实。这样它有没有混进知识行，可以查。
const OUTSIDE_FACT = "UNRELATEDPARKING policy applies to the Berlin office only.";
const requestLog = [];

function sseChunk(delta, finish, usage) {
  return "data: " + JSON.stringify({
    id: "acc267", object: "chat.completion.chunk", created: 1, model: "probe-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  }) + "\n\n";
}
function sseText(text) {
  return [
    sseChunk({ role: "assistant", content: text }, null),
    sseChunk({}, "stop", { prompt_tokens: 40, completion_tokens: 5, total_tokens: 45, prompt_tokens_details: { cached_tokens: 0 } }),
    "data: [DONE]\n\n",
  ].join("");
}
function sseToolCall(name, args, preamble) {
  return [
    ...(preamble ? [sseChunk({ role: "assistant", content: preamble }, null)] : []),
    sseChunk({ role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_" + requestLog.length, type: "function", function: { name, arguments: "" } }] }, null),
    sseChunk({ tool_calls: [{ index: 0, function: { arguments: args } }] }, null),
    sseChunk({}, "tool_calls", { prompt_tokens: 40, completion_tokens: 8, total_tokens: 48, prompt_tokens_details: { cached_tokens: 0 } }),
    "data: [DONE]\n\n",
  ].join("");
}

function classify(body) {
  // 整理用的提示词带这些标题，普通对话请求不带。
  if (body.includes("Summarize these episodic memories") || body.includes("You are a memory adjudicator")
    || body.includes("You are a context summarization assistant")) return "consolidate";
  // 已经拿到过工具结果的轮次，不能再要搜索：请求历史里还留着原来那句话，
  // 只看文字就会一直循环下去。
  let messages = [];
  try { messages = JSON.parse(body)?.messages ?? []; } catch { /* not JSON */ }
  if (messages.some((m) => m?.role === "tool")) return "chat";
  if (body.includes("TOOL-CALL-PLEASE")) return "toolcall";
  return "chat";
}

const PRINT_SOURCE = "https://print.example/source";
const PRINT_REROUND_SOURCE = "https://print.example/second-source";
let onPrintInterrupted;
const endpoint = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (req.url === "/print-search") {
    const { id, method, params } = JSON.parse(body);
    if (method === "notifications/initialized") return res.writeHead(202).end();
    const url = params?.arguments?.query === "anysearch-cli GitHub repository" ? PRINT_SOURCE : PRINT_REROUND_SOURCE;
    const result = method === "initialize" ? { protocolVersion: params.protocolVersion } : {
      structuredContent: { results: [{ url, title: "Print source", snippet: "The print test source." }] },
    };
    return res.writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }
  const isPrintGap = body.includes("What is missing? Write a single search query") && body.includes("Print source");
  const role = isPrintGap ? "print-gap" : classify(body);
  requestLog.push({ role, body });
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  if (role === "toolcall") {
    return res.end(sseToolCall("search", JSON.stringify({ query: "anysearch-cli GitHub repository" }),
      body.includes("PRINT-SEARCH-QUESTION") ? "我先搜一下。" : undefined));
  }
  if (role === "print-gap") return res.end(sseText("Find the second print source"));
  if (role === "consolidate") return res.end(sseText(FACT));
  // 回最新一轮的问题。后面那次请求如果带着这句话，就说明会话记录真的接上了；
  // 写死一句固定回答不行，因为全新会话也会出现同一个常量。
  //
  // 要取最后一条用户消息，不能取整段文字里第一个匹配：续接时请求里还留着
  // 第一轮的问题，按原文匹配会一直回第一轮的标记，于是"重复问第一轮"也能
  // 通过续接检查。
  const marker = latestUserMarker(body);
  if (marker === "PRINT-INTERRUPTED-QUESTION" && onPrintInterrupted) {
    res.write(sseChunk({ role: "assistant", content: "PRINT-PARTIAL" }, null));
    onPrintInterrupted();
    return;
  }
  if (marker === "PRINT-EMPTY-QUESTION") return res.end(sseText(""));
  if (marker === "CANCEL-STREAM-QUESTION") {
    res.write(sseChunk({ role: "assistant", content: "CANCEL-STREAM-PARTIAL" }, null));
    return;
  }
  res.end(sseText("REPLY-TO-" + (marker ?? "UNKNOWN-TURN")));
});

/** 取最新一条用户消息里的轮次标记；没有就返回 undefined。 */
function latestUserMarker(body) {
  let messages = [];
  try { messages = JSON.parse(body)?.messages ?? []; } catch { return undefined; }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    const marker = (messageText(m).match(/(FIRST-TURN-QUESTION|SECOND-TURN-QUESTION|CANCEL-STREAM-QUESTION|PRINT-SEARCH-QUESTION|PRINT-INTERRUPTED-QUESTION|PRINT-EMPTY-QUESTION)/) ?? [])[1];
    if (marker) return marker;
  }
  return undefined;
}

function messageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content.map((part) => (typeof part === "string" ? part : part?.text ?? "")).join(" ");
}

/**
 * 从最近一次发给模型的请求里，读那条 search 工具结果：搜到几条、哪些源失败了。
 *
 * 为什么要读这里而不是直接查库：库里有没有行，可能是"搜到 0 条所以没写"，也
 * 可能是"搜到了却没写"。前者是外部的事，后者才是产品的问题。
 *
 * 结果的实际形状是 RetrievalContent：`{schema, url, title, snippet, ...}`，
 * 真正的 envelope（里面有 results / metadata.providersFailed）是
 * `snippet` 里的一段 JSON 字符串。这个包装层一开始漏了，于是有结果也会被读成
 * 0 条。三种形状都认：裸 envelope、`content.results`、以及 snippet 里那段。
 *
 * 返回 parsed=false 表示这段内容根本没解开（读不懂），跟"真搜到 0 条"是两件
 * 事，调用方要分开处理，不能把读不懂也算成没搜到。
 */
function lastToolResultResults() {
  for (let i = requestLog.length - 1; i >= 0; i--) {
    let messages = [];
    try { messages = JSON.parse(requestLog[i].body)?.messages ?? []; } catch { continue; }
    for (let j = messages.length - 1; j >= 0; j--) {
      const m = messages[j];
      if (!m || m.role !== "tool") continue;
      const raw = typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map((c) => (typeof c === "string" ? c : c?.text ?? "")).join(" ")
          : "";
      const env = findRetrievalEnvelope(raw);
      if (!env) return { parsed: false, count: 0, failed: [] };
      return {
        parsed: true,
        count: Array.isArray(env.results) ? env.results.length : 0,
        failed: Array.isArray(env.metadata?.providersFailed) ? env.metadata.providersFailed : [],
      };
    }
  }
  return { parsed: false, count: 0, failed: [] };
}

/**
 * 在一段工具输出里找检索 envelope。找不到返回 null。
 *
 * 依次试：整段就是 envelope；`content.results`；RetrievalContent 的 snippet
 * 字段里那段 JSON（这是产品实际发出来的形状）。
 */
function findRetrievalEnvelope(raw) {
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* 不是 JSON */ }
  if (!parsed || typeof parsed !== "object") return null;

  if (Array.isArray(parsed.results)) return parsed;
  if (Array.isArray(parsed.content?.results)) return parsed.content;

  // RetrievalContent：snippet 里装着真正的 envelope。
  const snippet = parsed.snippet;
  if (typeof snippet === "string") {
    try {
      const inner = JSON.parse(snippet);
      if (Array.isArray(inner?.results)) return inner;
      if (Array.isArray(inner?.content?.results)) return inner.content;
    } catch { /* snippet 不是 JSON */ }
  }
  return null;
}

// ---------- 小 MCP 客户端：一行一条 JSON-RPC，走 stdio ----------
function mcpClient(bin, env, tag) {
  const child = spawn(process.execPath, [bin, "--transport", "stdio"], { env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d.toString(); });
  const pending = new Map();
  let nextId = 1;
  let buf = "";
  child.stdout.on("data", (c) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  child.once("exit", () => {
    for (const [, fn] of pending) fn({ error: { message: tag + ": MCP exited" } });
    pending.clear();
  });
  const rpc = (method, params, ms = 240_000) => new Promise((res, rej) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(tag + ": timeout on " + method + "\nstderr: " + stderr.slice(-400))); }, ms);
    pending.set(id, (m) => { clearTimeout(timer); res(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const ready = async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: tag, version: "1" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    return init;
  };
  return {
    rpc,
    ready,
    /**
     * 停掉子进程，等它真的退出了才算完。
     *
     * Windows 上，被杀的子进程对库文件和 WAL 还握着句柄，要等进程对象被回收
     * 才松手。在那之前删沙箱会报 EPERM。所以这里等 exit 事件，删目录才稳定，
     * 不是碰运气；那个超时是为了防止卡死的子进程把整轮拖住。
     *
     * stderr 只给上面那条超时信息用：RPC 卡住基本都是子进程没起来，原因在
     * stderr 里。
     */
    kill: () => new Promise((res) => {
      if (child.exitCode !== null || child.signalCode !== null) return res();
      const timer = setTimeout(res, 5_000);
      child.once("exit", () => { clearTimeout(timer); res(); });
      try { child.kill(); } catch { clearTimeout(timer); res(); }
    }),
  };
}
const textOf = (r) => (r?.result?.content ?? []).map((c) => c?.text ?? "").join("\n");

// ---------- 环境和小工具 ----------

/**
 * 跑一条命令，把 stdout 和 stderr 一起收回来。
 *
 * 两个系统两种走法，因为同一行命令不可能在两边都安全：
 *
 * - POSIX：直接把参数数组交给 spawnSync，`shell: false`。临时目录名来自
 *   mkdtemp，路径里如果有 `&`、`;`、`$` 或反引号，经过 shell 会被当成别的
 *   意思。直接传参数就没有解析器可以骗，这些字符原样进去。
 * - Windows：装出来的 bin 是 `ans.cmd`，一个批处理壳子，只能通过 cmd.exe
 *   启动。所以这里自己拼命令行、自己加引号：带空格的路径要引号，裸名字像
 *   `npm` 不能加引号（cmd.exe 会把 `"npm"` 解析成另一个壳子，安装直接
 *   MODULE_NOT_FOUND）。
 *
 * 这里踩过两个坑，都记下来：
 *
 * 1. 一开始我把 `& | < > ^ %` 全拦了，理由是"cmd.exe 不可信"。实测这是错的：
 *    被引号包住的路径里，`&`、`!`、`^`、单个 `%` 都能正常跑，拦掉只会让合法
 *    目录（比如 `…\Tempcc&test`）跑不了。真正会坏的只有成对的 `%NAME%`，
 *    cmd.exe 即使有引号也会把它展开。现在只拦这一种。
 * 2. 参数也必须一律加引号，不能只给带空格的加。`&` 在 cmd.exe 里是命令
 *    分隔符，跟有没有空格无关；裸着进去会在 `&` 处截断。
 */
function sh(cmd, args, opts = {}) {
  if (process.platform !== "win32") {
    const r = spawnSync(cmd, args, { encoding: "utf8", shell: false, ...opts });
    return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
  }
  // cmd.exe 只在一种情况下会篡改被引号包住的内容：成对的 %NAME%。它会被
  // 展开成环境变量，路径随之变成别的东西。
  const EXPANDS = /%[^%]+%/;
  if (EXPANDS.test(cmd) || args.some((a) => EXPANDS.test(a))) {
    throw new Error("sh()：命令行里有成对的 %NAME%，cmd.exe 会把它展开成别的路径：" + cmd);
  }
  // 命令本身：路径要引号（可能带空格）；裸名字像 `npm` 不能加引号，否则
  // cmd.exe 会去解析另一个壳子。
  const isPath = cmd.includes("/") || cmd.includes("\\");
  const parts = [isPath ? '"' + cmd + '"' : cmd];
  // 参数一律加引号，不只是带空格的。
  //
  // 这里踩过坑：一开始只给带空格的参数加引号，于是像
  // …\Temp\acc&267\x.tgz 这种"没空格但带 &"的参数裸着进去，cmd.exe 在 &
  // 处截断，npm 转去读 …\Temp\acc\package.json，报 ENOENT。& 在 cmd.exe 里
  // 是命令分隔符，跟有没有空格无关。引号包住之后它就只是普通字符。
  for (const a of args) parts.push(a === "" || /["^]/.test(a) ? a : '"' + a + '"');
  const r = spawnSync(parts.join(" "), { encoding: "utf8", shell: true, ...opts });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

/**
 * 异步版 sh：同样的引号纪律，换成 spawn + 等待退出。
 *
 * 为什么要一个异步版：假模型端点就跑在当前进程里，spawnSync 会把整个事件
 * 循环冻住——聊天子进程发来的模型请求永远等不到回答，这条验收只能等超时。
 * 异步 spawn 让事件循环活着，端点照常应答。只有「要跟进程内端点说话的子进
 * 程」需要走这条路；纯本地的命令（--version、consolidate）继续用同步 sh，
 * 免去等待样板。
 *
 * 超时上限 240 秒，跟 MCP 车道同款：一轮真实（假端点的）对话不值得无限等，
 * 卡住就是发现了问题，该红就红。
 */
async function shAsync(cmd, args, opts = {}) {
  if (process.platform !== "win32") {
    const r = await new Promise((resolve) => {
      const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.stderr.on("data", (d) => (out += d.toString()));
      const timer = setTimeout(() => { child.kill(); resolve({ code: 1, out: out + "\n[timeout] " + cmd + " " + args.join(" ") }); }, 240_000);
      child.once("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out }); });
      child.once("error", (e) => { clearTimeout(timer); resolve({ code: 1, out: out + "\n[spawn error] " + e.message }); });
    });
    return r;
  }
  // cmd.exe 的引号纪律与 sh() 完全一致（同款两坑：成对 %NAME% 拦下、参数一律
  // 加引号），只是换成异步 spawn。
  const EXPANDS = /%[^%]+%/;
  if (EXPANDS.test(cmd) || args.some((a) => EXPANDS.test(a))) {
    throw new Error("shAsync()：命令行里有成对的 %NAME%，cmd.exe 会把它展开成别的路径：" + cmd);
  }
  const isPath = cmd.includes("/") || cmd.includes("\\");
  const parts = [isPath ? '"' + cmd + '"' : cmd];
  for (const a of args) parts.push(a === "" || /["^]/.test(a) ? a : '"' + a + '"');
  const r = await new Promise((resolve) => {
    const child = spawn(parts.join(" "), { ...opts, stdio: ["ignore", "pipe", "pipe"], shell: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    const timer = setTimeout(() => { child.kill(); resolve({ code: 1, out: out + "\n[timeout] " + cmd + " " + args.join(" ") }); }, 240_000);
    child.once("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out }); });
    child.once("error", (e) => { clearTimeout(timer); resolve({ code: 1, out: out + "\n[spawn error] " + e.message }); });
  });
  return r;
}

function writeDomain(dir, name, body) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name + ".toml"), body.join("\n") + "\n", "utf8");
}

const DOMAIN_MIN = (name, system, rag = "none") => [
  'name = "' + name + '"',
  'sources = { enabled = [] }',
  'prompts = [{ name = "system", content = "' + system + '" }]',
  'skills = { active = ["search"] }',
  'hooks = { toolWhitelist = ["search"] }',
  'rag = { adapter = "' + rag + '" }',
];

/**
 * 删掉沙箱，最多重试几次。
 *
 * Windows 上真正解决 EPERM 的办法不是重试，是把 better-sqlite3 从这个仓库
 * 加载，而不是从安装目录加载：原生模块一旦加载就握住文件句柄直到进程退出，
 * 而沙箱正好在那棵安装目录下面。这里的重试只是给"子进程刚被杀、句柄还没
 * 松"兜底。临时目录删不干净属于卫生问题，不是产品失败，所以这里从不抛错
 * ——结论只从上面那些检查来。
 */
function rmTempWithRetry(dir) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (e) {
      if (attempt === 4) {
        console.error("[WARN] could not delete the temp sandbox " + dir + " (" + (e?.code ?? e?.message) + "); it is a temp directory, not a product failure");
        return;
      }
      // 调用方是进程最后一步，所以这里同步等一会儿再试。
      const until = Date.now() + 200 * (attempt + 1);
      while (Date.now() < until) { /* wait */ }
    }
  }
}

async function main() {
  // ANS_ACC_TMPDIR 只挪沙箱的位置，不动 TEMP。改 TEMP 会连带影响子进程找
  // npm，那不是这条车道想测的东西。
  const work = mkdtempSync(join(process.env.ANS_ACC_TMPDIR?.trim() || tmpdir(), "ans-installed-acc-"));
  const outDir = join(work, "out");
  const prefix = join(work, "prefix");
  mkdirSync(outDir, { recursive: true });
  mkdirSync(prefix, { recursive: true });
  writeFileSync(join(prefix, "package.json"), JSON.stringify({ name: "ans-installed-acc", private: true }), "utf8");
  // #299: `--continue` and `--list` need a project root to scope the search. A
  // bare package.json directory is not one, so the sandbox gets a .git marker
  // and the CLI resolves `prefix` as the project here — the same way it would
  // in a real checkout.
  mkdirSync(join(prefix, ".git"), { recursive: true });

  const clients = [];
  try {
    // ================= 打包 + 安装 =================
    //
    // 设了 ANS_ACC_TARBALLS 就直接装那个目录里的包，用来在没编译的情况下核对
    // 这个脚本本身。CI 里不设它，自己打包。
    const preset = process.env.ANS_ACC_TARBALLS?.trim();
    const PACK_DIRS = ["apps/cli"];
    if (preset) {
      console.log("== 干净安装（用 " + preset + " 里现成的包）==");
      for (const f of readdirSync(preset)) {
        if (/^anysearch-cli-cli-.*\.tgz$/.test(f)) writeFileSync(join(outDir, f), readFileSync(join(preset, f)));
      }
    } else {
      console.log("== 打包 + 干净安装 ==");
      for (const d of PACK_DIRS) {
        const r = sh("pnpm", ["-C", join(ROOT, d), "pack", "--pack-destination", outDir], { cwd: ROOT });
        if (r.code !== 0) check(false, "打包 " + d, r.out);
      }
    }

    const tgz = readdirSync(outDir).filter((f) => f.endsWith(".tgz"));
    check(tgz.length === PACK_DIRS.length, "安装集合里有 " + PACK_DIRS.length + " 个 app 包", tgz.join(","));
    check(tgz.every((f) => !f.includes("0.0.0")), "打出来的包里没有 0.0.0 这种占位版本号", tgz.join(","));

    const appTgz = tgz.filter((f) => /anysearch-cli-cli-/.test(f));
    const inst = sh("npm", ["install", ...appTgz.map((f) => join(outDir, f))], { cwd: prefix });
    check(inst.code === 0, "包能装进一个干净的目录", inst.out);

    // better-sqlite3 从这个仓库加载，不从安装目录加载。Windows 上原生模块一
    // 加载就握住文件句柄到进程退出，而沙箱就在安装目录下面，那样删不掉。
    // 仓库钉的是同一个版本，读装好的产品建的库结果一样。
    const Database = createRequire(join(ROOT, "apps", "mcp", "package.json"))("better-sqlite3");

    const nm = join(prefix, "node_modules");
    const ansBin = join(nm, ".bin", process.platform === "win32" ? "ans.cmd" : "ans");
    const mcpBin = join(nm, "@anysearch-cli", "cli", "bin", "ans-mcp.cjs");
    check(existsSync(ansBin), "装出来的 ans 命令在", ansBin);
    check(existsSync(mcpBin), "装出来的 MCP 入口在", mcpBin);

    // 真正要跑的是这个入口文件。
    //
    // Windows 上不能靠 .bin\ans.cmd：那是 npm 生成的批处理壳子，里面自己就有
    // `&` 和 `||`（`endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & ...`）。
    // 一旦安装路径里带 `&`（比如 …\Temp\acc&267\…），cmd.exe 会把壳子内部那些
    // 符号和路径里的 `&` 混在一起解析，报 "…\node_modules\.bin\ is not recognized"。
    // 这是 shim 自己的毛病：同一路径下 `node <入口>` 跑得好好的。
    // 所以 Windows 走 node + 入口，POSIX 仍然用 .bin/ans（那边没这问题，也更接近
    // 用户实际敲的命令）。
    const cliEntry = join(nm, "@anysearch-cli", "cli", "bin", "ans.cjs");
    const runAns = process.platform === "win32"
      ? (args, opts = {}) => sh(process.execPath, [cliEntry, ...args], opts)
      : (args, opts = {}) => sh(ansBin, args, opts);
    // 要跟模型端点说话的子进程必须走异步版：端点在本进程里，spawnSync 冻住
    // 事件循环就没人应答了（见 shAsync 的注释）。C3 的两轮 chat 用它。
    const runAnsAsync = process.platform === "win32"
      ? (args, opts = {}) => shAsync(process.execPath, [cliEntry, ...args], opts)
      : (args, opts = {}) => shAsync(ansBin, args, opts);

    // ================= A. 装出来的 CLI =================
    //
    // 每条命令都把 HOME/USERPROFILE 和 ANS_DB_PATH 指进沙箱。doctor 会自己解析
    // 持久库的路径并建目录，继承真实环境就会动到操作者自己的 ~/.anysearch。
    console.log("\n== A. CLI ==");
    const cliEnv = {
      ...process.env,
      USERPROFILE: work,
      HOME: work,
      ANS_DB_PATH: join(work, "cli-probe.db"),
      ANS_DOMAINS_DIR: join(work, "empty-domains"),
    };
    mkdirSync(cliEnv.ANS_DOMAINS_DIR, { recursive: true });
    const v = runAns(["--version"], { cwd: prefix, env: cliEnv });
    check(v.code === 0, "装出来的 ans --version 退出码 0", v.out);
    check(/\d+\.\d+\.\d+/.test(v.out) && !/\b0\.0\.0\b/.test(v.out), "版本号是真实发布版本，不是 0.0.0", v.out);

    const doctor = runAns(["doctor"], { cwd: prefix, env: cliEnv });
    check(doctor.code === 0, "装出来的 ans doctor 退出码 0", doctor.out);
    check(/vector arm/.test(doctor.out), "doctor 报了向量臂的状态", doctor.out.slice(-400));

    const noScope = runAns(["consolidate"], { cwd: prefix, env: cliEnv });
    check(noScope.code === 2, "整理不带范围时退出码 2，不会去整理全库", noScope.out);
    check(/explicit scope is required/.test(noScope.out), "拒绝整理时说明了缺什么", noScope.out);

    // ================= 假模型端点 =================
    await new Promise((r) => endpoint.listen(0, "127.0.0.1", r));
    const port = endpoint.address().port;
    const llmEnv = {
      ANS_LLM_PROVIDER: "openai",
      ANS_LLM_MODEL: "probe-model",
      ANS_LLM_BASE_URL: "http://127.0.0.1:" + port + "/v1",
      ANS_LLM_API: "chat",
      ANS_LLM_API_KEY: "probe-key",
    };

    const domainsDir = join(work, "domains");
    writeDomain(domainsDir, "probe", DOMAIN_MIN("probe", "PROBE-SYSTEM-PROMPT."));
    writeDomain(domainsDir, "recall", DOMAIN_MIN("recall", "RECALL-SYSTEM.", "fts"));

    const baseEnv = {
      ...process.env,
      ...llmEnv,
      ANS_DOMAINS_DIR: domainsDir,
      ANS_DB_PATH: join(work, "anysearch.db"),
      ANS_PI_SESSION_DIR: join(work, "pi"),
      ANS_NO_INTERACTIVE: "1",
      // HOME/USERPROFILE 指到沙箱，开发机自己的 ~/.anysearch-cli 不会混进来。
      USERPROFILE: work,
      HOME: work,
    };

    // #299: reuse the existing two-turn material through the installed CLI.
    // Async children keep this process free to serve the same SSE endpoint.
    function startChatCli(args, cwd, domain = "probe", extraEnv = {}, interruptOnText) {
      const env = { ...baseEnv, ANS_DOMAIN: domain, ANS_SESSION_ID: "cli-wiring-session-129", ...extraEnv };
      const child = spawn(process.execPath, [cliEntry, "chat", ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
      const result = new Promise((resolve, reject) => {
        let out = "";
        let stdout = "";
        let stderr = "";
        let interrupted = false;
        let caughtSignals;
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
          out += chunk;
          if (interruptOnText && !interrupted && stdout.includes(interruptOnText)) {
            interrupted = true;
            if (process.platform === "linux") {
              try {
                const status = readFileSync("/proc/" + child.pid + "/status", "utf8");
                caughtSignals = status.match(/^SigCgt:\s*(\w+)/m)?.[1];
              } catch { /* the subprocess may already have exited */ }
            }
            child.kill("SIGINT");
          }
        });
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => { stderr += chunk; out += chunk; });
        const timer = setTimeout(() => { child.kill(); reject(new Error("CLI chat timed out")); }, 60_000);
        child.on("error", (error) => { clearTimeout(timer); reject(error); });
        child.on("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal, caughtSignals, out, stdout, stderr }); });
      });
      return { child, result };
    }
    function chatCli(...args) {
      return startChatCli(...args).result;
    }
    const projectA = join(work, "project-a");
    const projectB = join(work, "project-b");
    const unknown = join(work, "unknown-project");
    for (const project of [projectA, projectB]) mkdirSync(join(project, ".git"), { recursive: true });
    mkdirSync(unknown);
    const handleOf = (result) => result.out.match(/\[session\] (\S+)/)?.[1];
    const cliFirst = await chatCli(["FIRST-TURN-QUESTION"], projectA);
    const firstHandle = handleOf(cliFirst);
    check(cliFirst.code === 0 && !!firstHandle, "CLI 默认新建并显示会话句柄", cliFirst.out);
    const cliSecond = await chatCli(["SECOND-TURN-QUESTION"], projectA);
    const secondHandle = handleOf(cliSecond);
    check(cliSecond.code === 0 && !!secondHandle && secondHandle !== firstHandle, "设置观测身份时再次独立启动也不会接回前一段对话", cliSecond.out);
    let cliBody = requestLog.filter((r) => r.role === "chat").pop()?.body ?? "";
    check(cliBody.includes("SECOND-TURN-QUESTION") && !cliBody.includes("FIRST-TURN-QUESTION"), "新对话的上游请求没有前一段聊天历史");
    const cliContinue = await chatCli(["--continue", "FIRST-TURN-QUESTION"], projectA);
    cliBody = requestLog.filter((r) => r.role === "chat").pop()?.body ?? "";
    check(cliContinue.code === 0 && handleOf(cliContinue) === secondHandle, "--continue 选择当前项目最近会话", cliContinue.out);
    check(cliBody.includes("SECOND-TURN-QUESTION") && cliBody.includes("REPLY-TO-SECOND-TURN-QUESTION"), "CLI 续聊恢复完整问答历史");
    const beforeRefusal = requestLog.length;
    const otherProject = await chatCli(["--continue", "SECOND-TURN-QUESTION"], projectB);
    const unknownProject = await chatCli(["--continue", "SECOND-TURN-QUESTION"], unknown);
    const unknownList = await chatCli(["--list"], unknown);
    check(unknownList.code !== 0 && unknownList.out.includes("无法确定当前项目"),
      "未知项目查看当前会话时说明原因", unknownList.out);
    check(otherProject.code !== 0 && unknownProject.code !== 0 && requestLog.length === beforeRefusal,
      "其他项目和未知项目不会借用 A 的会话，也不会发模型请求");
    const crossDirectory = await chatCli(["--session", firstHandle ?? "missing", "SECOND-TURN-QUESTION"], projectB);
    cliBody = requestLog.filter((r) => r.role === "chat").pop()?.body ?? "";
    check(crossDirectory.code === 0 && handleOf(crossDirectory) === firstHandle && cliBody.includes("REPLY-TO-FIRST-TURN-QUESTION"),
      "指定句柄跨目录恢复完整历史", crossDirectory.out);
    const bList = await chatCli(["--list"], projectB);
    check(bList.code === 0 && !bList.out.includes(firstHandle ?? "missing") && !bList.out.includes(secondHandle ?? "missing"),
      "跨目录恢复不会把原会话搬进 B 的最近列表", bList.out);

    if (process.platform === "win32") {
      skip("CLI 收到 Ctrl-C 后保存半截回答", "Windows 的 child.kill 不会模拟终端 Ctrl-C");
    } else {
      const interrupted = await chatCli(["CANCEL-STREAM-QUESTION"], projectA, "probe", {}, "CANCEL-STREAM-PARTIAL");
      const interruptedHandle = handleOf(interrupted);
      const key = "ans-" + createHash("sha256").update(interruptedHandle ?? "").digest("hex").slice(0, 32);
      const file = readdirSync(baseEnv.ANS_PI_SESSION_DIR).find((name) => name.endsWith("_" + key + ".jsonl"));
      const entries = file
        ? readFileSync(join(baseEnv.ANS_PI_SESSION_DIR, file), "utf8").trimEnd().split("\n").map((line) => JSON.parse(line))
        : [];
      const answers = entries.filter((entry) => entry.type === "message" && entry.message.role === "assistant")
        .map((entry) => ({
          stopReason: entry.message.stopReason,
          text: entry.message.content.map((part) => part.type === "text" ? part.text : "").join(""),
        }));
      const saved = answers.some((answer) =>
        answer.stopReason === "aborted" && answer.text === "CANCEL-STREAM-PARTIAL");
      check(interrupted.code === 130 && saved, "CLI 收到 Ctrl-C 后保存半截回答",
        JSON.stringify({ code: interrupted.code, signal: interrupted.signal, caughtSignals: interrupted.caughtSignals, answers }) + "\n" + interrupted.out);
      if (interruptedHandle) {
        const resumed = await chatCli(["--session", interruptedHandle, "SECOND-TURN-QUESTION"], projectA);
        check(resumed.code === 0 && resumed.out.includes("上一轮没正常结束"),
          "从 Ctrl-C 中断的会话续聊时先看到提醒", resumed.out);
      }
    }

    console.log("\n== CLI print and interrupted turn ==");
    const printProject = join(work, "project-print");
    mkdirSync(join(printProject, ".git"), { recursive: true });
    for (const [name, callCap] of [["print", 20], ["print-capped", 4]]) {
      const domain = DOMAIN_MIN(name, "PRINT-SYSTEM-PROMPT.");
      domain[1] = 'sources = { enabled = ["anysearch"], urlAllowlist = ["print.example"] }';
      writeDomain(domainsDir, name, [...domain, "[budget]", "tokenCap = 100000", "callCap = " + callCap]);
    }
    writeDomain(domainsDir, "print-denied", [
      ...DOMAIN_MIN("print-denied", "PRINT-DENIED."), "[budget]", "callCap = 0",
    ]);
    const printEnv = {
      ANS_DB_PATH: join(work, "print.db"),
      ANS_PI_SESSION_DIR: join(work, "print-pi"),
      ANYSEARCH_ENDPOINT: "http://127.0.0.1:" + port + "/print-search",
      ANYSEARCH_API_KEY: "print-test-key",
    };
    const printed = await chatCli(["-p", "TOOL-CALL-PLEASE PRINT-SEARCH-QUESTION"], printProject, "print", printEnv);
    check(printed.code === 0 && printed.stdout === "REPLY-TO-PRINT-SEARCH-QUESTION\n\n来源\n- " + PRINT_SOURCE + "\n- " + PRINT_REROUND_SOURCE + "\n",
      "-p 只输出答案和两次检索的来源", printed.out);
    const beforePrintFailures = requestLog.length;
    const denied = await chatCli(["-p", "FIRST-TURN-QUESTION"], printProject, "print-denied", printEnv);
    check(denied.code === 1 && denied.stdout === "" && /Call budget exhausted/.test(denied.stderr),
      "-p 额度不足时报错，标准输出为空", denied.out);
    const blockedDbParent = join(work, "not-a-db-directory");
    writeFileSync(blockedDbParent, "");
    const untracked = await chatCli(["-p", "FIRST-TURN-QUESTION"], printProject, "print", {
      ...printEnv, ANS_DB_PATH: join(blockedDbParent, "print.db"),
    });
    check(untracked.code === 1 && untracked.stdout === "" && /无法为这次提问建立任务预算/.test(untracked.stderr),
      "-p 无法建立任务预算时退出非零，标准输出为空", untracked.out);
    const unconfigured = await chatCli(["-p", "FIRST-TURN-QUESTION"], printProject, "print", {
      ...printEnv, ANS_LLM_PROVIDER: "", ANS_LLM_MODEL: "", ANS_LLM_BASE_URL: "", ANS_LLM_API: "", ANS_LLM_API_KEY: "",
    });
    check(unconfigured.code === 3 && unconfigured.stdout === "" && /not configured/.test(unconfigured.stderr),
      "-p 没配模型时退出非零，标准输出为空", unconfigured.out);
    const finished = await chatCli(["-c"], printProject, "print", printEnv);
    check(finished.code === 1 && finished.stdout === "" && /没有被打断的问题/.test(finished.stderr)
      && requestLog.length === beforePrintFailures, "-c 遇到已完成的对话说明原因，不发送请求", finished.out);
    const empty = await chatCli(["-p", "PRINT-EMPTY-QUESTION"], printProject, "print", printEnv);
    check(empty.code === 1 && empty.stdout === "" && /没有返回答案/.test(empty.stderr),
      "-p 收到空回答时退出非零，标准输出为空", empty.out);

    const beforeCapped = requestLog.length;
    const capped = await chatCli(["-p", "TOOL-CALL-PLEASE PRINT-SEARCH-QUESTION"], printProject, "print-capped", printEnv);
    check(capped.code === 1 && capped.stdout === "" && /Call budget exhausted/.test(capped.stderr)
      && !requestLog.slice(beforeCapped).some((request) => request.role === "chat"),
      "-p 在工具调用后也检查额度，没额度就不再请求模型", capped.out);
    const requestStarted = new Promise((resolve) => { onPrintInterrupted = resolve; });
    const active = startChatCli(["-p", "PRINT-INTERRUPTED-QUESTION"], printProject, "print", printEnv);
    try {
      await Promise.race([requestStarted, active.result.then(({ out }) => { throw new Error(out); })]);
      const beforeBusy = requestLog.length;
      const startedWaiting = Date.now();
      const busy = await chatCli(["-p", "--continue", "SECOND-TURN-QUESTION"], printProject, "print", {
        ...printEnv, ANS_PI_LOCK_TIMEOUT_MS: "60000",
      });
      check(busy.code === 1 && busy.stdout === "" && /正在别处运行/.test(busy.stderr)
        && requestLog.length === beforeBusy && Date.now() - startedWaiting < 30_000,
        "-p 撞上占用当场退出，没发送请求", busy.out);
    } finally {
      onPrintInterrupted = undefined;
      active.child.kill("SIGKILL");
      await active.result;
    }
    const interruptedPrint = await active.result;
    const interruptedPrintHandle = handleOf({ out: interruptedPrint.stderr });
    check(!!interruptedPrintHandle && interruptedPrint.stdout === "",
      "-p 被打断时标准错误里有句柄，标准输出没有半截回答", interruptedPrint.out);
    const beforeResume = requestLog.length;
    const resumed = await chatCli(["-c"], printProject, "print", printEnv);
    const resumedMessages = JSON.parse(requestLog[beforeResume]?.body ?? "{}").messages ?? [];
    const resumedQuestions = resumedMessages.filter((message) => message.role === "user").map(messageText);
    check(resumed.code === 0 && resumed.stdout === "REPLY-TO-PRINT-INTERRUPTED-QUESTION\n"
      && /上一轮没正常结束/.test(resumed.stderr) && handleOf({ out: resumed.stderr }) === interruptedPrintHandle,
      "-c 用原句柄重问被打断的问题", resumed.out);
    check(resumedQuestions.filter((question) => question === "PRINT-INTERRUPTED-QUESTION").length === 2
      && resumedQuestions.at(-1) === "PRINT-INTERRUPTED-QUESTION",
      "-c 的模型请求保留原问题，并原样重问", JSON.stringify(resumedQuestions));
    const printCheck = new Database(printEnv.ANS_DB_PATH, { readonly: true });
    try {
      const spent = printCheck.prepare(
        "SELECT b.spent_tokens, b.billable_calls FROM task_budgets b JOIN task_records t USING (task_id) WHERE t.kind = 'cli.chat' AND t.exit_code = 0 ORDER BY b.billable_calls DESC"
      ).all();
      check(spent.length === 2 && spent.every((row) => row.spent_tokens > 0 && row.billable_calls > 0)
        && spent[0]?.billable_calls >= 5,
        "-p 和 -c 各自记入本次任务预算，-p 也记了补搜前的模型调用", JSON.stringify(spent));
    } finally {
      printCheck.close();
    }

    // ================= B/C. MCP：初始化、对话、显式续接 =================
    console.log("\n== B/C. installed MCP: initialize -> chat -> resume ==");
    const prober = mcpClient(mcpBin, { ...baseEnv, ANS_DOMAIN: "probe" }, "probe");
    clients.push(prober);
    const init = await prober.ready();
    check(!!init.result?.serverInfo?.name, "装出来的 MCP 能回 initialize", JSON.stringify(init).slice(0, 200));
    check(init.result?.serverInfo?.version && init.result.serverInfo.version !== "0.0.0",
      "initialize 报了真实的版本号", JSON.stringify(init.result?.serverInfo));

    const list = await prober.rpc("tools/list", {});
    const tools = (list.result?.tools ?? []).map((t) => t.name);
    check(["search_web", "research_web", "recall_memory", "query_knowledge", "ans_chat"].every((n) => tools.includes(n)),
      "装出来的 MCP 五个工具都在", tools.join(","));

    const turn1 = await prober.rpc("tools/call", { name: "ans_chat", arguments: { message: "FIRST-TURN-QUESTION" } });
    const t1text = textOf(turn1);
    check(turn1.result?.isError !== true, "第一轮对话完成，没有工具报错", t1text.slice(0, 200));
    check(/REPLY-TO-FIRST-TURN-QUESTION/.test(t1text), "第一轮带着模型的回答", t1text.slice(0, 200));

    const usage1 = turn1.result?.structuredContent?.usage?.run;
    check(!!usage1 && usage1.assistantCalls >= 1, "第一轮报了这次运行的用量", JSON.stringify(usage1));
    // 断言具体值，不是"能接受的一组值"。这个假端点不报价，pi-ai 用自己那张
    // 价目表补一个数，所以标签是 estimated。哪天它开始说 provider（服务端
    // 真给了价），那是行为变了，要在这里挡住。
    check(usage1?.costSource === "estimated",
      "主运行的费用标成「按价目表估的」，不是服务端给的价", JSON.stringify(usage1?.costSource));
    check(usage1?.costUsd === 0, "主运行的金额是估算出来的零，不是账单", JSON.stringify(usage1?.costUsd));
    check(Array.isArray(usage1?.missing) && usage1.missing.some((m) => m === "cost (estimated)"),
      "主运行点明了费用是估的，没有当成免费", JSON.stringify(usage1?.missing));
    const ctx1 = turn1.result?.structuredContent?.context;
    check(!!ctx1 && typeof ctx1.window === "number" && ctx1.window > 0, "第一轮报了这次用的上下文窗口", JSON.stringify(ctx1));

    const sid = turn1.result?.structuredContent?.sessionId;
    check(typeof sid === "string" && sid.length > 0, "第一轮返回了能续接的会话句柄", String(sid));

    const turn2 = await prober.rpc("tools/call", { name: "ans_chat", arguments: { message: "SECOND-TURN-QUESTION", sessionId: sid } });
    check(turn2.result?.isError !== true, "拿着句柄问第二轮，完成", textOf(turn2).slice(0, 200));
    const t2text = textOf(turn2);
    // 答复必须是第二轮那个问题的。不查这条，重复问第一轮也能过续接检查：
    // 不管怎样请求里都带着第一轮的问题和回答，只有新的一轮能证明它真的往前走了。
    check(/REPLY-TO-SECOND-TURN-QUESTION/.test(t2text),
      "第二轮的答复对应第二轮的问题，不是重复第一轮", t2text.slice(0, 200));
    check(turn2.result?.structuredContent?.sessionId === sid, "第二轮还是同一个会话句柄", String(turn2.result?.structuredContent?.sessionId));
    const turn2Body = requestLog.filter((r) => r.role === "chat").pop()?.body ?? "";
    check(turn2Body.includes("FIRST-TURN-QUESTION"), "第二轮的请求里带着第一轮的问题，说明记录接上了");
    check(turn2Body.includes("REPLY-TO-FIRST-TURN-QUESTION"), "第二轮的请求里带着第一轮的回答，说明记录接上了");
    check(turn2Body.includes("SECOND-TURN-QUESTION"), "第二轮的请求里也有它自己的问题", turn2Body.slice(-300));

    // 固定提示词不该每轮重新拼一遍：比同一会话两次请求里的 system 消息。
    //
    // 先确认两轮都真的有提示词再比。只比"两轮相同"不够：两轮都丢了系统消息
    // 时，两边都是 null，比较下来也"相同"，这条就白过了。所以既查存在、也查
    // 内容就是配置里那句。
    const systemOf = (body) => {
      try {
        const j = JSON.parse(body);
        const msgs = j.messages ?? [];
        const sys = msgs.find((m) => m.role === "system" || m.role === "developer");
        if (!sys) return null;
        return typeof sys.content === "string" ? sys.content : JSON.stringify(sys.content);
      } catch { return null; }
    };
    const chatBodies = requestLog.filter((r) => r.role === "chat").map((r) => r.body);
    const lastSys = chatBodies.length >= 1 ? systemOf(chatBodies[chatBodies.length - 1]) : null;
    const prevSys = chatBodies.length >= 2 ? systemOf(chatBodies[chatBodies.length - 2]) : null;

    check(prevSys !== null && lastSys !== null,
      "两轮请求里都带着系统提示词", JSON.stringify({ prev: prevSys, last: lastSys }));
    check(lastSys !== null && lastSys.includes("PROBE-SYSTEM-PROMPT."),
      "系统提示词里就是配置里那句", String(lastSys).slice(0, 200));
    check(prevSys !== null && lastSys !== null && prevSys === lastSys,
      "两轮的固定提示词逐字节相同，缓存前缀是稳的",
      JSON.stringify({ prev: String(prevSys).slice(0, 120), last: String(lastSys).slice(0, 120) }));

    // 同一已知项目会话可以经 MCP 续聊；CLI 最近会话要看到这次使用。
    const makeSecondRecent = await chatCli(["--session", secondHandle ?? "missing", "FIRST-TURN-QUESTION"], projectA);
    const mcpContinued = await prober.rpc("tools/call", { name: "ans_chat", arguments: { message: "SECOND-TURN-QUESTION", sessionId: firstHandle } });
    const recentAfterMcp = await chatCli(["--continue", "FIRST-TURN-QUESTION"], projectA);
    check(makeSecondRecent.code === 0 && mcpContinued.result?.isError !== true && recentAfterMcp.code === 0 && handleOf(recentAfterMcp) === firstHandle,
      "MCP 续聊后 CLI 选到同项目里刚续过的会话", recentAfterMcp.out);

    // ================= C2. 冷启动：两个服务，一个全新的库 =================
    //
    // 规格 D12 / T3：全新的库不能因为 SQLITE_BUSY 丢一个进程。store 那边有限
    // 重试，这里用装出来的服务再验一遍，不只信单测。两个进程同时初始化，之后
    // 各自都要能出 tools/list —— 只回 initialize 只说明通道开了，不说明表建好了。
    console.log("\n== C2. cold start: two installed servers on a brand-new database ==");
    {
      const coldDb = join(work, "cold.db");
      const coldA = mcpClient(mcpBin, { ...baseEnv, ANS_DOMAIN: "probe", ANS_DB_PATH: coldDb }, "cold-a");
      const coldB = mcpClient(mcpBin, { ...baseEnv, ANS_DOMAIN: "probe", ANS_DB_PATH: coldDb }, "cold-b");
      clients.push(coldA, coldB);
      const [initA, initB] = await Promise.all([coldA.ready(), coldB.ready()]);
      check(!!initA.result?.serverInfo?.name && !!initB.result?.serverInfo?.name,
        "两个进程对着同一个全新库都能初始化",
        JSON.stringify([initA.error, initB.error]).slice(0, 300));
      const [listA, listB] = await Promise.all([coldA.rpc("tools/list", {}), coldB.rpc("tools/list", {})]);
      check((listA.result?.tools ?? []).length === 5 && (listB.result?.tools ?? []).length === 5,
        "同时冷启动之后，两个进程都出五个工具",
        JSON.stringify([(listA.result?.tools ?? []).length, (listB.result?.tools ?? []).length]));
      const coldCheck = new Database(coldDb, { readonly: true });
      let coldTables = [];
      try {
        coldTables = coldCheck.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
      } finally { coldCheck.close(); }
      // 点名每一层要用的表，不数张数下限："至少 30 张"在后加的一整张表缺失时
      // 照样过，而那种残缺正是这条车道要抓的。
      const requiredTables = [
        "sessions", "messages", "retrieval_results", "resume_anchors", "budget_ledger",
        "semantic_memories", "summary_sources", "summary_suspensions",
        "legacy_summary_states", "legacy_summary_attempts", "entities", "edges",
        // #302：任务/进程/任务预算三张表也在同一处点名。
        "task_records", "process_records", "task_budgets",
      ];
      const missingTables = requiredTables.filter((t) => !coldTables.includes(t));
      check(missingTables.length === 0,
        "冷启动建出来的库每一层的表都在 (" + coldTables.length + " tables)",
        "missing: " + missingTables.join(","));
      await coldA.kill();
      await coldB.kill();
    }

    // ================= C3. CLI 聊天：一次执行一份预算 =================
    //
    // #302：CLI 的一次 chat 是一个任务，账记在这次执行自己的预算行上；
    // 会话的 budget_ledger 不再被 CLI 聊天动过（历史账不动），任务登记随主
    // 程序统一进行（进程登记与任务登记分表）。两轮同会话各自开新账——
    // 续聊不扣历史额度的结构性事实就在这三张表里。
    console.log("\n== C3. CLI chat: one execution, one budget ==");
    {
      const chatDb = join(work, "chat-budget.db");
      writeDomain(domainsDir, "chatbudget", [
        ...DOMAIN_MIN("chatbudget", "BUDGETED-SYSTEM-PROMPT."),
        "[budget]",
        "tokenCap = 100000",
        "callCap = 20",
      ]);
      const chatEnv = {
        ...baseEnv,
        ANS_DOMAIN: "chatbudget",
        ANS_DB_PATH: chatDb,
        // #299: CLI chat now starts a NEW conversation by default and
        // ANS_SESSION_ID is observation-only, so it is deliberately NOT set
        // here. This case needs two turns in ONE conversation and asks for it
        // explicitly with --continue below, which is also what a user does.
      };
      const r1 = await runAnsAsync(["chat", "FIRST-TURN-QUESTION"], { cwd: prefix, env: chatEnv });
      check(r1.code === 0, "带预算域的 CLI chat 退出码 0", r1.out.slice(-500));
      check(/REPLY-TO-FIRST-TURN-QUESTION/.test(r1.out), "第一轮带回了模型的回答", r1.out.slice(-300));
      check(/\[task-budget\] this execution:/.test(r1.out), "收尾时报了这次执行自己的预算", r1.out.slice(-500));
      check(/\[session-budget\] conversation history:/.test(r1.out) && /CLI chats no longer spend this account/.test(r1.out),
        "同屏把会话历史账（累计）单独报出来，和本次执行的两行不混", r1.out.slice(-500));
      // The handle this run created, so the second turn can continue it and the
      // session-budget assertion below names the row that actually exists.
      const handleOf = (result) => result.out.match(/\[session\] (\S+)/)?.[1];
      const chatHandle = handleOf(r1);
      check(!!chatHandle, "第一轮打印了会话句柄", r1.out.slice(-300));

      // 同一会话再来一轮：任务预算是新的，会话的账从头到尾没被 CLI 聊天碰过。
      // #299: `--continue` is the explicit way to reuse the conversation; a bare
      // `chat` would now start a second one, which is the behaviour that made
      // this assertion fail when the two tickets met.
      const r2 = await runAnsAsync(["chat", "--continue", "SECOND-TURN-QUESTION"], { cwd: prefix, env: chatEnv });
      check(r2.code === 0, "同会话第二轮退出码 0（续聊不受历史额度牵制）", r2.out.slice(-500));
      check(handleOf(r2) === chatHandle, "第二轮续的是同一段会话", r2.out.slice(-300));

      const chatCheck = new Database(chatDb, { readonly: true });
      try {
        const tasks = chatCheck.prepare(
          "SELECT task_id as id, session_id as session, ended_at IS NOT NULL as ended, exit_code as code FROM task_records WHERE kind = 'cli.chat' ORDER BY started_at"
        ).all();
        check(tasks.length === 2 && tasks.every((t) => t.ended && t.code === 0),
          "两次 CLI chat 各登记为一条任务，跑完即结束（两条都收尾）",
          JSON.stringify(tasks));
        check(!!chatHandle && tasks.every((t) => t.session === chatHandle),
          "两条任务都关联到同一个会话句柄（上下文挂钩会话，额度挂任务）",
          JSON.stringify(tasks));
        const budgets = chatCheck.prepare(
          "SELECT spent_tokens as spent, billable_calls as calls FROM task_budgets ORDER BY rowid"
        ).all();
        check(budgets.length === 2 && budgets.every((b) => b.spent > 0),
          "两次执行各有自己的一份预算行，各自记了真实花费（不共享会话账）",
          JSON.stringify(budgets));
        // 会话账的行还在（wireChatMemory 照旧登记会话预算，这是保留给未迁移
        // 调用方的旧形式），但 CLI 聊天一次都不能让它动过一个计数器——额度
        // 记在任务账上，会话的历史账不被这轮执行花掉。
        const sessionBilled = chatCheck.prepare(
          "SELECT COALESCE(SUM(reserved_tokens + spent_tokens + reserved_usd + spent_usd + reserved_calls + billable_calls), 0) as n FROM budget_ledger WHERE session_id = ?"
        ).get(chatHandle);
        check(sessionBilled.n === 0,
          "两轮 CLI 聊天后，会话预算行的一个计数器都没动过（额度记在任务账上）",
          JSON.stringify(sessionBilled));
        const processes = chatCheck.prepare(
          "SELECT COUNT(*) as n FROM process_records WHERE entry = 'cli' AND ended_at IS NOT NULL"
        ).get();
        check(processes.n >= 2, "每次 CLI 执行登记了一条进程记录且已收尾", JSON.stringify(processes));
      } finally {
        chatCheck.close();
      }
    }

    // ================= D. 装出来的整理 =================
    console.log("\n== D. consolidate: scope guard, dry-run, apply ==");

    const noScopeCall = await prober.rpc("tools/call", { name: "ans_chat", arguments: { operation: "consolidate" } });
    check(noScopeCall.result?.isError === true, "通过 MCP 整理不带范围，工具报错", textOf(noScopeCall).slice(0, 200));
    check(/explicit scope is required/.test(textOf(noScopeCall)), "MCP 的报错点明了缺范围", textOf(noScopeCall).slice(0, 200));

    // 先往装好的库里塞三条材料，这样下面的 dry-run 读到的是真范围，不是空的。
    // 顺序是故意的：在空会话上预览，写不写都过，那种断言什么也证明不了。
    // 范围外的材料跟选中的三条在同一个会话里，但实体和事实都不一样。
    //
    // 故意放三条。只放一条什么也证明不了：批量门槛不让单条材料建知识，按会话跑
    // 和按列表跑结果一模一样。放三条，两种范围才会分开——范围被放大就会多出
    // 一条知识行，下面的断言才抓得住。把 memoryIds 换成 sessionId 验过会红。
    const seedSession = "acc267-seed";
    let seededIds = [];
    let outsideIds = [];
    {
      const db = new Database(baseEnv.ANS_DB_PATH);
      try {
        db.prepare("INSERT OR IGNORE INTO sessions (id, domain) VALUES (?, ?)").run(seedSession, "probe");
        for (let i = 1; i <= 3; i++) {
          const r = db.prepare("INSERT INTO retrieval_results (session_id, url, title, snippet, source, entity) VALUES (?,?,?,?,?,?)")
            .run(seedSession, "https://acme.example/hours-v" + i, "acme hours v" + i, FACT, "exa", "acme-hours");
          seededIds.push(Number(r.lastInsertRowid));
        }
        for (let i = 1; i <= 3; i++) {
          const r = db.prepare("INSERT INTO retrieval_results (session_id, url, title, snippet, source, entity) VALUES (?,?,?,?,?,?)")
            .run(seedSession, "https://outside.example/untouched-v" + i, "outside material v" + i, OUTSIDE_FACT, "exa", "outside-entity");
          outsideIds.push(Number(r.lastInsertRowid));
        }
      } finally { db.close(); }
    }
    check(seededIds.length === 3, "为 apply 那条路塞了三条材料", seededIds.join(","));
    check(outsideIds.length === 3, "另塞了三条范围外的材料，数量够过批量门槛", outsideIds.join(","));

    const dry = await prober.rpc("tools/call", { name: "ans_chat", arguments: { operation: "consolidate", memoryIds: seededIds, dryRun: true } });
    check(dry.result?.isError !== true, "整理 dry-run 跑完", textOf(dry).slice(0, 200));
    const dryScope = dry.result?.structuredContent?.scope;
    check(dryScope?.by === "memory", "dry-run 回显了它实际读的范围类型", JSON.stringify(dryScope));
    check((dry.result?.structuredContent?.report?.clustersScanned ?? 0) > 0,
      "dry-run 真的扫到了塞进去的材料", JSON.stringify(dry.result?.structuredContent?.report?.clustersScanned));
    check((dry.result?.structuredContent?.report?.add ?? 0) === 1,
      "dry-run 报了 apply 会新增什么", JSON.stringify(dry.result?.structuredContent?.counts));
    {
      // dry-run 答应的是"什么都没存"。查数据库，不看它自己怎么说。
      const db = new Database(baseEnv.ANS_DB_PATH, { readonly: true });
      let rows;
      try { rows = db.prepare("SELECT count(*) c FROM semantic_memories").get().c; }
      finally { db.close(); }
      check(rows === 0, "dry-run 一条知识行都没写", "semantic_memories rows=" + rows);
    }

    const applyCall = await prober.rpc("tools/call", {
      name: "ans_chat",
      arguments: { operation: "consolidate", memoryIds: seededIds },
    });
    const applyText = textOf(applyCall);
    check(applyCall.result?.isError !== true, "整理 apply 跑完", applyText.slice(0, 300));
    const counts = applyCall.result?.structuredContent?.counts;
    check(counts?.add === 1, "apply 只写出一条知识行", JSON.stringify(counts));
    check(!!applyCall.result?.structuredContent?.usage, "整理报了自己的模型用量", JSON.stringify(applyCall.result?.structuredContent?.usage));
    const usageApply = applyCall.result?.structuredContent?.usage;
    check(usageApply?.calls >= 1, "整理把它那次模型调用记上了账", JSON.stringify(usageApply));
    // 整理这边跟主运行不一样，原因是真的：整理读会话的价目表，自定义端点没报
    // 价，所以标签是 unknown，不是主运行那个价目表估出来的 estimated。两边各
    // 断言自己的值，谁被换成对方就会红。
    check(usageApply?.costBasis === "unknown",
      "整理的标签是 unknown，没把没报的价说成服务端的价", JSON.stringify(usageApply?.costBasis));
    check(usageApply?.costUsd === 0, "整理的未知费用是占位，不是零账单", JSON.stringify(usageApply?.costUsd));
    check(Array.isArray(usageApply?.missing) && usageApply.missing.some((m) => /consolidation cost/.test(m)),
      "整理点名了费用这一项未知", JSON.stringify(usageApply?.missing));
    {
      const db = new Database(baseEnv.ANS_DB_PATH, { readonly: true });
      try {
        const rows = db.prepare("SELECT content, valid_until FROM semantic_memories").all();
        check(rows.length === 1, "知识行真的在库里", JSON.stringify(rows));
        check(rows.length === 1 && rows[0].valid_until === null, "写进去的那行是有效的", JSON.stringify(rows));
        check(rows.length === 1 && String(rows[0].content).includes("Acme"), "那行带着总结出来的事实", JSON.stringify(rows).slice(0, 200));

        // 范围没被放大。看两个独立信号，因为单看一个可能因为别的原因通过：范围
        // 外的实体没建出第二行知识，那些材料也还活着、没被标成被替代。
        check(rows.length === 1, "范围外的实体没有建出知识行", JSON.stringify(rows.map((r) => r.content).slice(0, 2)));
        const outsideRows = db.prepare("SELECT id, valid_until, superseded_by FROM retrieval_results WHERE id IN (?,?,?)").all(...outsideIds);
        check(outsideRows.length === 3 && outsideRows.every((r) => r.valid_until === null && r.superseded_by === null),
          "范围外的材料没被动过", JSON.stringify(outsideRows));
        const inScope = db.prepare("SELECT count(*) c FROM retrieval_results WHERE id IN (?,?,?) AND (valid_until IS NULL AND superseded_by IS NULL)").get(...seededIds).c;
        check(inScope === 3, "选中的材料跑完还是有效的", "live=" + inScope);
        check(!String(rows[0]?.content ?? "").includes("UNRELATEDPARKING"),
          "知识行里没有范围外那条事实", String(rows[0]?.content ?? "").slice(0, 120));
      } finally { db.close(); }
    }

    // 复用 D 已有的资料和查询词，在装好的 CLI 新建对话，核对真正发给模型的内容。
    const recallChat = await chatCli(["Acme"], projectB, "recall");
    const recallBody = requestLog.filter((r) => r.role === "chat").pop()?.body ?? "";
    check(recallChat.code === 0 && !!handleOf(recallChat) && handleOf(recallChat) !== firstHandle && handleOf(recallChat) !== secondHandle,
      "新对话能使用共享资料，且没有接回其他会话", recallChat.out);
    check(recallBody.includes(FACT), "新 CLI 对话把已有研究资料带进了模型请求", recallBody.slice(-400));

    // ================= E. 内部搜索入库 → 另一个会话召回 =================
    console.log("\n== E. internal search ingest -> another session recalls ==");
    const online = Boolean(process.env.EXA_API_KEY || process.env.TAVILY_API_KEY);
    if (!online) {
      skip("内部搜索入库 + 跨会话召回", "没设 EXA_API_KEY / TAVILY_API_KEY");
    } else {
      // 一个只开一个真搜索源的域，让内部搜索有可用的臂。
      const providerName = process.env.EXA_API_KEY ? "exa" : "tavily";
      writeDomain(domainsDir, "ingest", [
        'name = "ingest"',
        'sources = { enabled = ["' + providerName + '"] }',
        'prompts = [{ name = "system", content = "INGEST-SYSTEM." }]',
        'skills = { active = ["search"] }',
        'hooks = { toolWhitelist = ["search"] }',
        'rag = { adapter = "none" }',
      ]);
      // 假端点对着「请调工具」的请求，真回一个 search 调用。
      const ingestEnv = { ...baseEnv, ANS_DOMAIN: "ingest", ANS_DB_PATH: join(work, "ingest.db") };
      const writer = mcpClient(mcpBin, ingestEnv, "ingest");
      clients.push(writer);
      await writer.ready();
      const asked = await writer.rpc("tools/call", {
        name: "ans_chat",
        arguments: { message: "TOOL-CALL-PLEASE find the anysearch-cli GitHub repository and report its URL." },
      });
      check(asked.result?.isError !== true, "入库那一轮跑完", textOf(asked).slice(0, 200));
      const toolCalls = asked.result?.structuredContent?.toolCalls ?? {};
      check((toolCalls.search ?? 0) >= 1, "模型那次搜索工具调用真的执行了", JSON.stringify(toolCalls));

      // 这次搜索到底搜到东西没有，从发给模型的请求里读那条工具结果。
      // 搜到 0 条是外部的事（额度、当天索引、网络），搜到了却没写进库才是产品
      // 的问题。两种要分开判，否则外部抖一下就把整条车道染红。
      const searched = lastToolResultResults();
      const ingestDb = new Database(ingestEnv.ANS_DB_PATH, { readonly: true });
      let rows = [];
      try {
        rows = ingestDb.prepare("SELECT session_id, url, title, snippet FROM retrieval_results ORDER BY id DESC LIMIT 20").all();
      } finally { ingestDb.close(); }

      if (!searched.parsed) {
        // 读不懂工具结果和"真没搜到"是两件事。读不懂说明这个脚本跟不上产品的
        // 输出形状了，要报红让人看见，不能默默跳过。
        check(false, "能读懂 search 工具返回的结果格式",
          "工具结果里没找到检索 envelope（results / content.results / snippet 三种形状都没匹配上）");
        skip("内部搜索入库 + 跨会话召回", "结果格式没读懂，无法判断入库与否");
      } else if (searched.count === 0) {
        skip("内部搜索入库 + 跨会话召回", "搜索源这次回了 0 条" +
          (searched.failed.length ? "（失败的源：" + searched.failed.join(",") + "）" : "") +
          "，没东西可入库");
      } else {
        check(rows.length > 0,
          "内部搜索往库里写了 " + rows.length + " 行（搜索源回了 " + searched.count + " 条）",
          JSON.stringify(rows.slice(0, 2)));
      }

      // 召回那条严格档要求查询里的词全中，所以挑一个长一点的词。
      //
      // 只在适配器真会返回的那段里挑：query_knowledge 会合并空白，每条命中只留
      // 前 600 字（RAG_HIT_MAX_CHARS）。从 600 之后挑词，库里能命中但返回的
      // 文本里没有它，于是明明召回对了也会被判失败。
      const ADAPTER_HIT_CHARS = 600;
      const token = !searched.parsed || searched.count === 0 ? undefined : rows
        .map((r) => (String(r.snippet ?? "")
          .replace(/\s+/g, " ").trim().slice(0, ADAPTER_HIT_CHARS)
          .toLowerCase().match(/[a-z0-9]{7,}/g) ?? [])[0])
        .find(Boolean);
      if (searched.parsed && searched.count > 0 && !token) {
        skip("跨会话召回", "库里没有哪行带着足够长的词，严格档匹配不上");
      } else if (token) {
        const reader = mcpClient(mcpBin, { ...ingestEnv, ANS_DOMAIN: "recall" }, "recall");
        clients.push(reader);
        await reader.ready();
        const qk = await reader.rpc("tools/call", { name: "query_knowledge", arguments: { query: token } });
        const block = textOf(qk);
        check(qk.result?.isError !== true, "另一个会话 query_knowledge 没报错", block.slice(0, 200));
        check(/provenance=memory/.test(block), "召回块标了自己的可信层级", block.slice(0, 300));
        check(block.toLowerCase().includes(token), "第二个会话召回到了第一个会话搜索写进去的那行", token);
        await reader.kill();
      }
      await writer.kill();
    }
    await prober.kill();

    // ================= F. 旧一点的库：能开、先备份、能迁移、行还在 =================
    console.log("\n== F. older database: read, backup-before-migration, migrate, migrate again ==");
    {
      const legacyPath = join(work, "older.db");
      const backupPath = legacyPath + ".pre-migration.db";
      const recordPath = legacyPath + ".pre-migration.json";
      // 先用装好的产品建一个库，再把后加的表删掉，假装是旧版本写的。删掉后来才
      // 有的表，是手边最接近的替身：不用编数据，也不改历史。
      //
      // 用它打开而不是 doctor：consolidate 会打开 ANS_DB_PATH 上那个持久库，而
      // doctor 的 store 检查跑在内存里，报绿但一个 schema 文件都没写。退出码必须
      // 是 0：假端点起着、范围里也没材料，非 0 就是真失败，不是「没有模型」。
      const warm = runAns(["consolidate", "--session", "warm-session"], {
        cwd: prefix,
        env: { ...baseEnv, ANS_DB_PATH: legacyPath, ANS_DOMAIN: "probe" },
      });
      check(warm.code === 0, "全新的库能被装出来的 CLI 打开，consolidate 退出码 0", warm.out.slice(0, 400));
      check(/scanned \d+ cluster/.test(warm.out), "新库那次报了扫描到几个簇", warm.out.slice(0, 300));
      // 全新建库没有历史可保，不该产生备份文件（#310）。
      check(!existsSync(backupPath), "全新的库不会生成迁移前备份", backupPath);

      // 后来的版本才加的表。删掉它们，这个文件就像是旧版本写的了。
      // #310 之后 store_meta 表本身就是"这个版本线碰过"的标记，task_records /
      // task_budgets / process_records 是 #302 的新表；不把它们一起删掉，库会
      // 被当成已是新布局，备份永远不会被触发（F 段就退化为纯旧断言了）。
      const laterTables = ["summary_sources", "summary_suspensions", "legacy_summary_states", "legacy_summary_attempts", "budget_reservations", "semantic_memories_fts", "chat_projects", "store_meta", "task_records", "task_budgets", "process_records"];
      let before = null;
      {
        const db = new Database(legacyPath);
        try {
          db.prepare("INSERT OR IGNORE INTO sessions (id, domain) VALUES (?, ?)").run("older-session", "probe");
          db.prepare("INSERT INTO retrieval_results (session_id, url, title, snippet, source) VALUES (?,?,?,?,?)")
            .run("older-session", "https://older.example/x", "OLDER-ROW-TITLE", "OLDER-ROW-SNIPPET orphanword", "exa");
          for (const t of laterTables) db.exec("DROP TABLE IF EXISTS " + t);
          before = {
            tables: db.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table'").get().c,
            rows: db.prepare("SELECT count(*) c FROM retrieval_results").get().c,
          };
        } finally { db.close(); }
      }
      check(before.rows >= 1, "旧库在迁移前就有一条数据", JSON.stringify(before));

      const open1 = runAns(["consolidate", "--session", "older-session"], {
        cwd: prefix,
        env: { ...baseEnv, ANS_DB_PATH: legacyPath, ANS_DOMAIN: "probe" },
      });
      check(open1.code === 0, "旧库第一次打开就迁移好了", open1.out.slice(0, 400));
      // #310：迁移之前必须已经有一致备份（不是迁完再补）。备份必须真的可用：
      // 打开它查得到旧行、查不到新标志表——它是迁移前的快照，不是事后副本。
      check(existsSync(backupPath), "打开旧库前先生成了迁移前备份", backupPath);
      {
        const bak = new Database(backupPath, { readonly: true });
        try {
          const bakRow = bak.prepare("SELECT title FROM retrieval_results WHERE url = ?").get("https://older.example/x");
          check(bakRow && bakRow.title === "OLDER-ROW-TITLE", "备份里能查到旧数据", JSON.stringify(bakRow));
          const bakMarker = bak.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table' AND name='store_meta'").get().c;
          check(bakMarker === 0, "备份是迁移前的快照，不带新布局标记表");
        } finally { bak.close(); }
      }
      {
        const record = JSON.parse(readFileSync(recordPath, "utf8"));
        check(record.method === "sqlite-vacuum-into", "备份记录写明了快照方式", JSON.stringify(record).slice(0, 200));
        check(Array.isArray(record.declaredCompatibleLayouts) && record.declaredCompatibleLayouts.length === 2,
          "兼容声明只列已知样本，模拟库和 0.2 真实布局分开标", JSON.stringify(record.declaredCompatibleLayouts));
        check(typeof record.sha256 === "string" && record.sha256.length === 64, "备份记录带可核验的 sha256");
        check(typeof record.manualRecovery === "string" && record.manualRecovery.length > 0, "备份记录写了手动恢复指引");
      }
      const backupMtimeAfterFirstOpen = statSync(backupPath).mtimeMs;

      const open2 = runAns(["consolidate", "--session", "older-session"], {
        cwd: prefix,
        env: { ...baseEnv, ANS_DB_PATH: legacyPath, ANS_DOMAIN: "probe" },
      });
      check(open2.code === 0, "再打开一次也不报错，迁移能重复跑", open2.out.slice(0, 400));

      const legacyList = runAns(["chat", "--list", "--unassigned"], {
        cwd: projectA, env: { ...baseEnv, ANS_DB_PATH: legacyPath, ANS_DOMAIN: "probe" },
      });
      check(legacyList.code === 0 && legacyList.out.includes("older-session") && legacyList.out.includes("未归属"),
        "旧会话列为未归属，没有猜成当前项目", legacyList.out);

      const callsBeforeMissingRecord = requestLog.length;
      const noRecord = await chatCli(["--session", "older-session", "FIRST-TURN-QUESTION"], projectA, "probe", { ANS_DB_PATH: legacyPath });
      // 拒绝的话已改成说清原因。库里有这行、记录没了，就是「没有对话记录」。
      check(noRecord.code !== 0 && noRecord.out.includes("没有这段会话的对话记录") && requestLog.length === callsBeforeMissingRecord,
        "没有对话记录的旧条目不会被当成续聊，也不会发模型请求", noRecord.out);

      // #310：中间这一整串打开（chat --list、续聊尝试、后面的 MCP）都不该动备份。
      // 它是迁移前状态的快照，后续每次打开要么已是新布局、要么直接复用它。
      check(statSync(backupPath).mtimeMs === backupMtimeAfterFirstOpen,
        "后续打开不会再改备份文件");

      const db = new Database(legacyPath, { readonly: true });
      let after;
      let restored;
      let keptRow;
      try {
        after = {
          tables: db.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table'").get().c,
          rows: db.prepare("SELECT count(*) c FROM retrieval_results").get().c,
        };
        restored = laterTables.map((t) => [t, db.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table' AND name=?").get(t).c > 0]);
        keptRow = db.prepare("SELECT title, snippet FROM retrieval_results WHERE url = ?").get("https://older.example/x");
      } finally { db.close(); }
      check(after.tables > before.tables, "迁移把后来加的表补回来了", JSON.stringify({ before: before.tables, after: after.tables }));
      for (const [t, present] of restored) check(present, "迁移补回了表 " + t);
      check(keptRow && keptRow.title === "OLDER-ROW-TITLE", "旧数据迁移后原样还在", JSON.stringify(keptRow));

      // The installed MCP must read the migrated file too — the CLI passing is
      // not the same claim as the server that serves tools.
      const legacyReader = mcpClient(mcpBin, { ...baseEnv, ANS_DOMAIN: "probe", ANS_DB_PATH: legacyPath }, "legacy");
      clients.push(legacyReader);
      await legacyReader.ready();
      const recall = await legacyReader.rpc("tools/call", { name: "recall_memory", arguments: { query: "OLDER-ROW-SNIPPET" } });
      const recallText = textOf(recall);
      check(recall.result?.isError !== true, "装出来的 MCP 也能打开迁移后的库", recallText.slice(0, 200));
      check(/"hitsCount":\s*[1-9]/.test(recallText), "迁移后的库还能召回到旧那条数据", recallText.slice(0, 300));
      await legacyReader.kill();

      // #310：分层诊断。doctor 只读探测，不装配、不迁移：对已迁移的库要报出
      // 当前布局和备份位置，以及「回退程序先手动恢复备份」的说明。
      // 域注意：probe 的 sources.enabled 故意是空的（别的车道靠它不走真实搜
      // 索），而 doctor 对当前域会检查 enabled 非空，拿 probe 跑 doctor 必然退
      // 出码非 0。迁移状态检查本身只看 ANS_DB_PATH，跟用哪个域无关，所以这里
      // 给 doctor 单独配一个能过域检查的域（enabled 列 anysearch——没有 key 时
      // doctor 记 SKIP 不记 FAIL，正好）。
      writeDomain(domainsDir, "migrate", [
        'name = "migrate"',
        'sources = { enabled = ["anysearch"] }',
        'prompts = [{ name = "system", content = "MIGRATION-CHECK." }]',
        'skills = { active = ["search"] }',
        'hooks = { toolWhitelist = ["search"] }',
        'rag = { adapter = "none" }',
      ]);
      const doctorLegacy = runAns(["doctor"], {
        cwd: prefix,
        env: { ...baseEnv, ANS_DB_PATH: legacyPath, ANS_DOMAIN: "migrate" },
      });
      check(doctorLegacy.code === 0 && doctorLegacy.out.includes("当前布局") && doctorLegacy.out.includes("迁移前备份") && doctorLegacy.out.includes("手动恢复备份"),
        "doctor 把库的布局和迁移前备份情况报告出来，恢复指引说清是手动动作", doctorLegacy.out.slice(0, 400));
    }
  } finally {
    await Promise.all(clients.map((c) => c.kill()));
    endpoint.close();
    // Windows 上刚被杀的子进程还会握着文件一小会儿，直接 rmSync 会跟系统抢
    // 输，报 EPERM。沙箱是临时目录，重试几次就够；这里失败也不能把一轮本来
    // 是绿的验收变成崩溃（结论是看产品的）。
    rmTempWithRetry(work);
  }

  console.log("\ninstalled-acceptance: 过了 " + passed + " 项，挂了 " + failed + " 项，跳了 " + skipped + " 项");
  if (skipped > 0) {
    console.log("注意：跳掉的那几条没跑，这轮只证明了跑过的那部分。");
  }
  process.exit(failed === 0 ? 0 : 1);
}

/**
 * 用造出来的工具结果自测解析器，不需要真实搜索。
 *
 * 为什么要这个：E 车道靠 lastToolResultResults 判断"搜到几条"。它认三种形状，
 * 其中 RetrievalContent（results 藏在 snippet 那段 JSON 里）是产品在门控没改写
 * 时真正发出来的形状。只靠真实搜索去碰这个分支不行——真实请求大多数时候走的
 * 是裸 envelope，那条分支一辈子可能都跑不到，错了也发现不了。
 *
 * 用法：node scripts/installed-acceptance.mjs --self-test-parser
 * 退出码 0 = 四种输入都判对了。
 */
function selfTestParser() {
  const bare = { results: [{ url: "a" }, { url: "b" }], metadata: { providersFailed: [] } };
  const wrapped = { content: { results: [{ url: "a" }], metadata: { providersFailed: ["exa"] } } };
  const tagged = {
    schema: "anysearch://schemas/retrieval-content/1",
    version: 1,
    url: "search://envelope/x",
    title: "q",
    // 关键形状：外层是 RetrievalContent，真正的 results 在 snippet 的 JSON 里。
    snippet: JSON.stringify(bare),
    source: "engine",
    label: { source: "retrieved", traceId: "search-x" },
    disposal: "accepted",
  };
  const unknown = { something: "else" };

  const cases = [
    ["裸 envelope（未被包装）", bare, { parsed: true, count: 2, failed: [] }],
    ["content.results 包装", wrapped, { parsed: true, count: 1, failed: ["exa"] }],
    ["RetrievalContent：results 在 snippet 里", tagged, { parsed: true, count: 2, failed: [] }],
    ["认不出的形状", unknown, { parsed: false, count: 0, failed: [] }],
  ];

  let bad = 0;
  for (const [label, value, want] of cases) {
    // 走真正的入口：把这段结果伪装成一次 requestLog 记录。
    requestLog.push({ role: "chat", body: JSON.stringify({ messages: [{ role: "tool", content: JSON.stringify(value) }] }) });
    const got = lastToolResultResults();
    requestLog.pop();

    const ok = got.parsed === want.parsed && got.count === want.count
      && JSON.stringify(got.failed) === JSON.stringify(want.failed);
    console.log((ok ? "[OK]   " : "[FAIL] ") + label + " → " + JSON.stringify(got));
    if (!ok) bad++;
  }
  console.log(bad === 0 ? "\n解析器自测：4 个用例全对。" : "\n解析器自测：挂了 " + bad + " 个。");
  return bad === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test-parser")) {
  process.exit(selfTestParser());
}

await main();
