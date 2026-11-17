import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough } from "node:stream";
import { chooseChatCollision } from "../src/commands/chat-collision";

test("没有终端立即停止，不读取答案", async () => {
  let asked = false;
  const choice = await chooseChatCollision("held", { isTTY: false, ask: async () => { asked = true; return "fork"; } });
  assert.equal(choice, "stop");
  assert.equal(asked, false);
});

test("终端只接受明确的 fork 或等待，空输入和读取失败都不动", async () => {
  for (const answer of ["", "\n", "no", "unknown"]) {
    assert.equal(await chooseChatCollision("held", { isTTY: true, ask: async () => answer }), "stop");
  }
  assert.equal(await chooseChatCollision("held", { isTTY: true, ask: async () => { throw new Error("EOF"); } }), "stop");
  for (const answer of ["f", "fork", "1"]) {
    assert.deepEqual(await chooseChatCollision("held", { isTTY: true, ask: async () => answer, newHandle: () => "fresh" }), { fork: "fresh" });
  }
  for (const answer of ["w", "wait", "2"]) {
    assert.equal(await chooseChatCollision("held", { isTTY: true, ask: async () => answer }), "wait");
  }
});

test("真实输入流关闭时停止，脚本可注入终端答案", async () => {
  for (const answer of ["", "fork\n", "wait\n"]) {
    const input = new PassThrough();
    const output = new PassThrough();
    const chosen = chooseChatCollision("held", { isTTY: true, input, output, newHandle: () => "fresh" });
    input.end(answer);
    assert.deepEqual(await chosen, answer === "fork\n" ? { fork: "fresh" } : answer ? "wait" : "stop");
    assert.match(output.read()?.toString() ?? "", /held.*fork.*等/);
  }
});
