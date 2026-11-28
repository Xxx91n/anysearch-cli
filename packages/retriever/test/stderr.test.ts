// writeStderrDiagnostic 单元测试：正常写入、已关/已毁流早退不崩、异步 error 事件被接住且不泄露监听。

import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { writeStderrDiagnostic, type DiagnosticWritable } from "../src/stderr";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

async function main() {
  // 1. 正常流：文字写进去，写完后 error 监听清干净。
  {
    const out = new PassThrough();
    const chunks: string[] = [];
    out.setEncoding("utf8");
    out.on("data", (chunk: string) => chunks.push(chunk));
    writeStderrDiagnostic("hello diagnostic\n", out);
    await new Promise((resolve) => setImmediate(resolve));
    assert(chunks.join("") === "hello diagnostic\n", "normal stream receives the diagnostic line");
    assert(out.listenerCount("error") === 0, "error listener is removed after a clean write");
  }

  // 2. 已关/已毁的流：直接跳过，不抛错、不挂监听。
  {
    const closed = new PassThrough();
    closed.end();
    for (let i = 0; i < 20; i++) writeStderrDiagnostic("after end\n", closed);
    assert(closed.listenerCount("error") === 0, "ended stream never accumulates error listeners");

    const destroyed = new PassThrough();
    destroyed.destroy();
    for (let i = 0; i < 20; i++) writeStderrDiagnostic("after destroy\n", destroyed);
    assert(destroyed.listenerCount("error") === 0, "destroyed stream never accumulates error listeners");
  }

  // 3. 异步写失败（模拟断开的管道 EPIPE）：不崩进程，连续写多次也不泄露监听。
  {
    const broken = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error("EPIPE: broken pipe"));
      },
    });
    for (let i = 0; i < 20; i++) {
      writeStderrDiagnostic("burst " + i + "\n", broken);
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert(broken.listenerCount("error") <= 1,
      "broken stream never leaks error listeners (got " + broken.listenerCount("error") + ")");
    // 已经进入 errored 状态后继续写，不再新增监听。
    for (let i = 0; i < 20; i++) {
      writeStderrDiagnostic("after error " + i + "\n", broken);
    }
    assert(broken.listenerCount("error") === 0,
      "subsequent writes to an errored stream skip without adding listeners (got " + broken.listenerCount("error") + ")");
  }

  // 4. 同步 throw 的流：被挡住且立刻清理监听。
  {
    const emitter = new EventEmitter();
    const throwing: DiagnosticWritable = {
      once: (event, listener) => emitter.once(event, listener),
      off: (event, listener) => emitter.off(event, listener),
      write() {
        throw new Error("sync write failure");
      },
    };
    writeStderrDiagnostic("sync boom\n", throwing);
    assert(emitter.listenerCount("error") === 0, "sync throw removes its error listener immediately");
  }

  console.log("stderr.test.ts: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

await main();
