import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "@anysearch-cli/store";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { runChatAttempt, sessionLeasePath } from "../src/chat-attempt";
import { PiAgentRuntime, piSessionKey, type PiAgentRuntimeOptions } from "../src/pi-runtime";
import { loadPiCodingAgent } from "../src/pi-sdk";
import { judgePiSessionRecord, PI_SESSION_FORMAT_VERSION } from "../src/pi-session";

const model = {
  id: "recovery-test", name: "Recovery test", api: "openai-completions", provider: "probe",
  contextWindow: 128000, maxTokens: 4096, reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const domain = {
  sources: { enabled: [], urlDenylist: ["blocked.example.invalid"] },
  prompts: [{ name: "system", content: "Answer briefly." }],
  skills: { active: ["search"] },
  hooks: { toolWhitelist: ["search"] },
  rag: { adapter: "none" },
};
const usage = {
  input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(content: unknown[], stopReason = "stop") {
  return {
    role: "assistant", content, stopReason, usage, api: model.api, provider: model.provider,
    model: model.id, timestamp: Date.now(),
  };
}

const question = {
  type: "message",
  message: { role: "user", content: [{ type: "text", text: "上次的问题" }], timestamp: Date.now() },
};

function seedRecord(dir: string, sessionId: string, entries: Array<Record<string, unknown>>) {
  const key = piSessionKey(sessionId);
  const path = join(dir, "2026-11-18_" + key + ".jsonl");
  const timestamp = new Date().toISOString();
  const lines = [
    { type: "session", version: PI_SESSION_FORMAT_VERSION, id: key, cwd: dir, timestamp },
    ...entries.map((entry, i) => ({
      ...entry, id: "entry-" + i, parentId: i === 0 ? null : "entry-" + (i - 1), timestamp,
    })),
  ];
  writeFileSync(path, lines.map((line) => JSON.stringify(line) + "\n").join(""));
  return path;
}

function chatRuntime(dir: string, sessionId: string, streamFn: unknown, signal?: AbortSignal,
  compaction?: Pick<PiAgentRuntimeOptions, "contextWindow" | "piCompaction">) {
  return new PiAgentRuntime({
    cwd: dir, piSessionDir: dir, sessionId, domain: domain as any, model, streamFn, signal,
    getApiKey: async () => "probe-key",
    retriever: { async search() { throw new Error("恢复时执行了搜索"); } } as any,
    ...compaction,
  });
}

function reply() {
  const message = assistant([{ type: "text", text: "新的回答" }]);
  return {
    async *[Symbol.asyncIterator]() { yield { type: "done", reason: "stop", message }; },
    result: async () => message,
  };
}

async function recoversOnlyToolsWithoutResults() {
  const dir = mkdtempSync(join(tmpdir(), "ans-318-recovery-"));
  try {
    const sessionId = "interrupted";
    const call = (id: string) => ({ type: "toolCall", id, name: "search", arguments: { query: id } });
    const path = seedRecord(dir, sessionId, [
      question,
      { type: "custom", customType: "anysearch:turn-started" },
      { type: "message", message: assistant([call("received"), call("missing-1"), call("missing-2"), call("never-started")], "toolUse") },
      ...["received", "missing-1", "missing-2"].map((id) => ({
        type: "custom", customType: "anysearch:tool-started", data: { id, name: "search" },
      })),
      {
        type: "message",
        message: {
          role: "toolResult", toolCallId: "received", toolName: "search",
          content: [{ type: "text", text: "有结果" }], isError: false, timestamp: Date.now(),
        },
      },
    ]);
    const before = readFileSync(path, "utf8");
    assert.equal(judgePiSessionRecord(path, piSessionKey(sessionId)).ok, true);
    assert.equal(readFileSync(path, "utf8"), before);

    let providerCalls = 0;
    const runtime = chatRuntime(dir, sessionId, () => {
      providerCalls++;
      return reply();
    });
    const options = { sessionId, piSessionDir: dir, projectRoot: null };
    await runChatAttempt(options, async (attempt) => {
      for await (const event of runtime.run("显式的新问题", attempt)) {
        assert.equal(event.type, "session_recovery");
        if (event.type !== "session_recovery") throw new Error("没有先收到上一轮的说明");
        assert.ok(existsSync(sessionLeasePath(dir, sessionId)));
        assert.equal(providerCalls, 0);
        const lines = event.notice.split("\n");
        assert.deepEqual(lines, [
          "上一轮没正常结束。没收到结果的工具状态未知，继续前请先核对现场。",
          "工具 search（missing-1）：结果未知，不要自动重跑。",
          "工具 search（missing-2）：结果未知，不要自动重跑。",
        ]);
        break;
      }
      return { completed: false };
    });
    const recovered = readFileSync(path, "utf8");
    assert.ok(recovered.startsWith(before));
    assert.equal(recovered.slice(before.length).trimEnd().split("\n").length, 1);
    assert.equal(providerCalls, 0);

    let notices = 0;
    let completed = false;
    await runChatAttempt(options, async (attempt) => {
      for await (const event of runtime.run("新的明确问题", attempt)) {
        if (event.type === "session_recovery") {
          notices++;
          assert.equal(readFileSync(path, "utf8"), recovered);
          assert.equal(providerCalls, 0);
        }
        if (event.type === "done") completed = true;
      }
      return { completed };
    });
    assert.equal(notices, 1);
    assert.equal(providerCalls, 1);
    assert.ok(completed);
    assert.equal(readFileSync(path, "utf8").split("anysearch:turn-interrupted").length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function recoversWhenTheModelNeverAnswered() {
  const dir = mkdtempSync(join(tmpdir(), "ans-318-no-answer-"));
  try {
    const sessionId = "no-answer";
    const path = seedRecord(dir, sessionId, [
      question,
      { type: "custom", customType: "anysearch:turn-started" },
    ]);
    let calls = 0;
    const runtime = chatRuntime(dir, sessionId, () => { calls++; return reply(); });
    const options = { sessionId, piSessionDir: dir, projectRoot: null };

    const notices: string[] = [];
    for (let opened = 0; opened < 2; opened++) {
      await runChatAttempt(options, async (attempt) => {
        for await (const event of runtime.run("下一轮的问题", attempt)) {
          if (event.type === "session_recovery") notices.push(event.notice);
          break;
        }
        return { completed: false };
      });
    }
    assert.deepEqual(notices, [
      "上一轮没正常结束。没收到结果的工具状态未知，继续前请先核对现场。",
      "上一轮没正常结束。没收到结果的工具状态未知，继续前请先核对现场。",
    ]);
    assert.equal(calls, 0);
    assert.equal(readFileSync(path, "utf8").split("anysearch:turn-interrupted").length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function acceptsRepeatingAQuestionNotSentToTheModel() {
  for (const entries of [
    [question],
    [question, { type: "message", message: assistant([], "aborted") }],
    [question, { type: "message", message: assistant([{ type: "text", text: "" }], "error") }],
  ]) {
    const dir = mkdtempSync(join(tmpdir(), "ans-318-retry-"));
    try {
      const sessionId = "question-only";
      const path = seedRecord(dir, sessionId, entries);
      const before = readFileSync(path, "utf8");
      const runtime = chatRuntime(dir, sessionId, () => {
        const record = readFileSync(path, "utf8");
        assert.match(record.slice(before.length), /anysearch:turn-started/);
        assert.doesNotMatch(record, /anysearch:turn-interrupted/);
        return reply();
      });
      const options = { sessionId, piSessionDir: dir, projectRoot: null };
      for (const expectedNotices of [["上一轮只留下了问题，可以直接再问一次。"], []]) {
        const notices: string[] = [];
        await runChatAttempt(options, async (attempt) => {
          let completed = false;
          for await (const event of runtime.run("上次的问题", attempt)) {
            if (event.type === "session_recovery") {
              notices.push(event.notice);
              assert.equal(readFileSync(path, "utf8"), before);
            }
            if (event.type === "done") completed = true;
          }
          assert.ok(completed);
          return { completed };
        });
        assert.deepEqual(notices, expectedNotices);
      }
      assert.doesNotMatch(readFileSync(path, "utf8"), /anysearch:turn-interrupted/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

async function keepsPolicyStoppedTurnsComplete() {
  const dir = mkdtempSync(join(tmpdir(), "ans-318-tool-stop-"));
  try {
    const sessionId = "tool-stop";
    let calls = 0;
    const runtime = chatRuntime(dir, sessionId, () => {
      if (++calls !== 1) return reply();
      const message = assistant([{
        type: "toolCall", id: "blocked", name: "search", arguments: { query: "https://blocked.example.invalid/" },
      }], "toolUse");
      return {
        async *[Symbol.asyncIterator]() { yield { type: "done", reason: "toolUse", message }; },
        result: async () => message,
      };
    });
    const options = { sessionId, piSessionDir: dir, projectRoot: null };
    for (const input of ["查资料", "新问题"]) {
      await runChatAttempt(options, async (attempt) => {
        let completed = false;
        for await (const event of runtime.run(input, attempt)) {
          assert.notEqual(event.type, "session_recovery");
          if (event.type === "done") completed = true;
        }
        assert.ok(completed);
        return { completed };
      });
    }
    assert.equal(calls, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function keepsOldCompletedToolTurnsComplete() {
  const dir = mkdtempSync(join(tmpdir(), "ans-318-legacy-tool-stop-"));
  const store = new SqliteSessionStore(join(dir, "anysearch.db"));
  try {
    const denied = { text: "URL rejected by trust boundary: https://blocked.example.invalid/", isError: true };
    const oldTurns = [
      {
        sessionId: "legacy-tool-stop", recordedComplete: true, interrupted: false,
        results: [{ text: "工具请求被拒绝", isError: true }],
      },
      {
        sessionId: "legacy-policy-stop", recordedComplete: false, interrupted: false,
        results: [denied, denied],
      },
      {
        sessionId: "legacy-mixed-batch", recordedComplete: false, interrupted: true,
        results: [denied, { text: "有结果", isError: false }],
      },
    ];
    for (const { sessionId, recordedComplete, interrupted, results } of oldTurns) {
      await store.ensureSession(sessionId, "chat");
      store.recordChatProject(sessionId, null, recordedComplete);
      const toolCallId = (index: number) => "call-" + index;
      const path = seedRecord(dir, sessionId, [
        question,
        { type: "message", message: assistant(results.map((_, index) => ({
          type: "toolCall", id: toolCallId(index), name: "search", arguments: { query: "查资料" },
        })), "toolUse") },
        ...results.map(({ text, isError }, index) => ({
          type: "message",
          message: {
            role: "toolResult", toolCallId: toolCallId(index), toolName: "search",
            content: [{ type: "text", text }], isError, timestamp: Date.now(),
          },
        })),
      ]);
      let notices = 0;
      const runtime = chatRuntime(dir, sessionId, reply);
      await runChatAttempt({ store, sessionId, piSessionDir: dir, projectRoot: null }, async (attempt) => {
        let completed = false;
        for await (const event of runtime.run("新问题", attempt)) {
          if (event.type === "session_recovery") notices++;
          if (event.type === "done") completed = true;
        }
        assert.ok(completed);
        return { completed };
      });
      assert.equal(notices, interrupted ? 1 : 0);
      assert.equal(readFileSync(path, "utf8").includes("anysearch:turn-interrupted"), interrupted);
    }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function reportsModelErrorsAsUnfinished() {
  const dir = mkdtempSync(join(tmpdir(), "ans-318-model-error-"));
  try {
    const sessionId = "model-error";
    const path = seedRecord(dir, sessionId, []);
    const message = { ...assistant([], "error"), errorMessage: "模型拒绝了请求" };
    const runtime = chatRuntime(dir, sessionId, () => ({
      async *[Symbol.asyncIterator]() { yield { type: "error", reason: "error", error: message }; },
      result: async () => message,
    }));
    const options = { sessionId, piSessionDir: dir, projectRoot: null };
    const errors: string[] = [];
    await runChatAttempt(options, async (attempt) => {
      for await (const event of runtime.run("会报错的问题", attempt)) {
        assert.notEqual(event.type, "done");
        if (event.type === "error") errors.push(event.message);
      }
      return { completed: false };
    });
    assert.deepEqual(errors, ["模型拒绝了请求"]);
    assert.doesNotMatch(readFileSync(path, "utf8"), /anysearch:turn-completed/);

    const resumed = chatRuntime(dir, sessionId, reply);
    await runChatAttempt(options, async (attempt) => {
      for await (const event of resumed.run("新问题", attempt)) {
        assert.equal(event.type, "session_recovery");
        break;
      }
      return { completed: false };
    });
    assert.match(readFileSync(path, "utf8"), /anysearch:turn-interrupted/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function leavesTheRecordReadableWhenCompletionWriteTears() {
  const dir = mkdtempSync(join(tmpdir(), "ans-318-torn-completion-"));
  const { SessionManager } = await loadPiCodingAgent();
  const appendCustomEntry = SessionManager.prototype.appendCustomEntry;
  try {
    const sessionId = "torn-completion";
    const path = seedRecord(dir, sessionId, []);
    SessionManager.prototype.appendCustomEntry = function (this: typeof SessionManager.prototype, type: string, data?: unknown) {
      if (type === "anysearch:turn-completed") {
        appendFileSync(path, '{"type":"custom","customType":"anysearch:turn-com');
        throw new Error("收尾标记写到一半失败");
      }
      return appendCustomEntry.call(this, type, data);
    };

    const errors: string[] = [];
    const runtime = chatRuntime(dir, sessionId, reply);
    await runChatAttempt({ sessionId, piSessionDir: dir, projectRoot: null }, async (attempt) => {
      for await (const event of runtime.run("会话记录写到一半失败", attempt)) {
        assert.notEqual(event.type, "done");
        if (event.type === "error") errors.push(event.message);
      }
      return { completed: false };
    });
    assert.deepEqual(errors, ["收尾标记写到一半失败"]);
    assert.deepEqual(judgePiSessionRecord(path, piSessionKey(sessionId)), { ok: true });
  } finally {
    SessionManager.prototype.appendCustomEntry = appendCustomEntry;
    rmSync(dir, { recursive: true, force: true });
  }
}

async function preservesPartialAnswersOnCancellation() {
  const dir = mkdtempSync(join(tmpdir(), "ans-318-cancel-"));
  const caller = new AbortController();
  let unblock!: () => void;
  const blocked = new Promise<void>((resolve) => { unblock = resolve; });
  try {
    const sessionId = "cancelled";
    const path = seedRecord(dir, sessionId, []);
    const message = assistant([{ type: "text", text: "答到一半" }]);
    const runtime = chatRuntime(dir, sessionId, () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: "start", partial: { ...message, content: [] } };
        yield { type: "text_delta", contentIndex: 0, delta: "答到一半", partial: { ...message, content: [] } };
        await blocked;
      },
      result: async () => ({ ...message, stopReason: "aborted" }),
    }), caller.signal);
    await runChatAttempt({ sessionId, piSessionDir: dir, projectRoot: null }, async (attempt) => {
      for await (const event of runtime.run("会被取消的问题", attempt)) {
        assert.notEqual(event.type, "done");
        if (event.type === "text") caller.abort();
      }
      return { completed: false };
    });
    const entries = readFileSync(path, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
    const answers = entries.filter((entry) => entry.type === "message" && entry.message.role === "assistant");
    assert.equal(answers.length, 1);
    assert.equal(answers[0].message.stopReason, "aborted");
    assert.deepEqual(answers[0].message.content, [{ type: "text", text: "答到一半" }]);
    assert.doesNotMatch(readFileSync(path, "utf8"), /anysearch:turn-completed/);
  } finally {
    unblock();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function replaysPartialAnswersWithTheirNotice() {
  const dir = mkdtempSync(join(tmpdir(), "ans-partial-context-"));
  const sessionId = "partial-context";
  const notice = "这条回答当时被打断，只留下半截，不要当成完整回答。";
  const complete = { type: "message", message: assistant([{ type: "text", text: "完整回答" }]) };
  const followUp = {
    type: "message",
    message: { ...question.message, content: [{ type: "text", text: "会被打断的问题" }] },
  };
  try {
    for (const compacted of [false, true]) {
      async function nextRequest(stopReason: string) {
        const saved = assistant([{ type: "text", text: "答到一半" }], stopReason);
        const path = seedRecord(dir, sessionId, [
          question, complete, followUp, { type: "message", message: saved },
          { type: "message", message: assistant([], "aborted") },
          ...(compacted ? [{ type: "compaction", firstKeptEntryId: "entry-0", summary: "更早的对话摘要", tokensBefore: 100 }] : []),
        ]);
        const original = readFileSync(path, "utf8");
        const requests: TranscriptContext[] = [];
        const runtime = chatRuntime(dir, sessionId, (_model: unknown, context: TranscriptContext) => {
          requests.push(context);
          return reply();
        });
        let completed = false;
        for await (const event of runtime.run("新的问题")) {
          if (event.type === "done") completed = true;
        }
        assert.ok(completed);
        assert.equal(requests.length, 1);
        if (stopReason === "aborted") {
          for await (const _event of runtime.run("再问一次")) { /* drain */ }
          assert.equal(requests.length, 2);
          const marked = requests[1]!.messages.filter((message) => JSON.stringify(message.content).includes(notice));
          assert.deepEqual(marked.map(({ role, content }) => ({ role, content })), [
            { role: "assistant", content: [{ type: "text", text: notice + "\n\n答到一半" }] },
          ]);
        }
        const record = readFileSync(path, "utf8");
        assert.ok(record.startsWith(original));
        assert.ok(!record.includes(notice));
        return requests[0]!.messages.map(({ role, content }) => ({ role, content }));
      }

      const completeRequest = await nextRequest("stop");
      const expected = completeRequest.map((message) => (
        message.role === "assistant" && Array.isArray(message.content) &&
        message.content.some((part) => part.type === "text" && part.text === "答到一半")
          ? { ...message, content: [{ type: "text", text: notice + "\n\n答到一半" }] }
          : message
      ));
      assert.notDeepEqual(expected, completeRequest);
      assert.deepEqual(await nextRequest("aborted"), expected);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function compactionLeavesPartialTextOutOfTheSummary() {
  const dir = mkdtempSync(join(tmpdir(), "ans-compact-partial-"));
  try {
    const sessionId = "compact-partial";
    const path = seedRecord(dir, sessionId, [
      question,
      { type: "message", message: assistant([
        { type: "text", text: "将被压缩的半截文字" },
        { type: "toolCall", id: "compacted-call", name: "search", arguments: { query: "早先的检索" } },
      ], "aborted") },
      { type: "message", message: { ...question.message, content: [{ type: "text", text: "This more recent question remains in the compacted conversation." }] } },
      { type: "message", message: { ...assistant([{ type: "text", text: "近期回答" }]), usage: { ...usage, input: 6000, totalTokens: 6001 } } },
    ]);
    const original = readFileSync(path, "utf8");
    const requests: TranscriptContext[] = [];
    const runtime = chatRuntime(dir, sessionId, (_model: unknown, context: TranscriptContext) => {
      requests.push(context);
      return reply();
    }, undefined, { contextWindow: 8192, piCompaction: { reserveTokens: 4096, keepRecentTokens: 8 } });
    let completed = false;
    for await (const event of runtime.run("新的问题")) {
      if (event.type === "done") completed = true;
    }
    assert.ok(completed);
    const summaryPrompt = requests[0]?.messages.flatMap((message) => (
      message.role === "user" && Array.isArray(message.content)
        ? message.content.flatMap((part) => part.type === "text" ? [part.text] : [])
        : []
    )).join("\n") ?? "";
    assert.ok(summaryPrompt.includes("[User]: 上次的问题"));
    assert.ok(summaryPrompt.includes('[Assistant tool calls]: search(query="早先的检索")'));
    assert.ok(!summaryPrompt.includes("将被压缩的半截文字"));
    assert.ok(!summaryPrompt.includes("不要当成完整回答"));
    assert.ok(!JSON.stringify(requests.at(-1)?.messages).includes("将被压缩的半截文字"));
    const record = readFileSync(path, "utf8");
    assert.ok(record.startsWith(original));
    assert.match(record.slice(original.length), /"type":"compaction"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  await recoversOnlyToolsWithoutResults();
  await recoversWhenTheModelNeverAnswered();
  await acceptsRepeatingAQuestionNotSentToTheModel();
  await keepsPolicyStoppedTurnsComplete();
  await keepsOldCompletedToolTurnsComplete();
  await reportsModelErrorsAsUnfinished();
  await leavesTheRecordReadableWhenCompletionWriteTears();
  await preservesPartialAnswersOnCancellation();
  await replaysPartialAnswersWithTheirNotice();
  await compactionLeavesPartialTextOutOfTheSummary();
  console.log("会话中断恢复验收通过");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
