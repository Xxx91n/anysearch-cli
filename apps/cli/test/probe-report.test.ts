// #480 — doctor 的文案表和状态表必须按「每个错误类」全填：
// 新类合进来时，用户不该看到原始类名，也不该把真问题静默报成未检查。
//
// Run: pnpm --filter @anysearch-cli/cli test

import { test } from "node:test";
import assert from "node:assert/strict";

import { ERROR_CLASSES } from "@anysearch-cli/retriever";
import type { ProbeFaultClass, ProbeOutcome } from "@anysearch-cli/retriever/providers";

import { probeDetail, probeState } from "../src/probe-report.js";

const FAULT_CLASSES: readonly ProbeFaultClass[] = [...ERROR_CLASSES, "unreachable"];

// key 被拒、额度用尽（含免 key 的额度墙）、入口变了，都是要修的真问题。
const FAILED: readonly ProbeFaultClass[] = [
  "permanent-auth",
  "quota-exhausted",
  "free-quota-exhausted",
  "permanent-protocol",
];

// 上游抽风、连不上、会话过期、认不出来，只能算没检查 —— 不等于 key 坏了。
const UNCHECKED: readonly ProbeFaultClass[] = [
  "session-expired",
  "transient",
  "unreachable",
  "unknown",
];

function outcome(cls: ProbeFaultClass): ProbeOutcome {
  return { auth: "ok", undetectable: [], problem: { class: cls } };
}

test("每个错误类都有一句中文，不把类名或 undefined 丢给用户", () => {
  for (const cls of FAULT_CLASSES) {
    const detail = probeDetail(outcome(cls));
    assert.ok(!detail.includes(cls), `${cls} 还是原始类名：${detail}`);
    assert.ok(!detail.includes("undefined"), `${cls} 缺文案：${detail}`);
  }
});

test("状态判断覆盖每个类：真问题算 failed，传输类故障算 unchecked", () => {
  // 两个清单合起来必须正好是全部错误类，新类漏了哪边都会在这里红。
  const covered = [...FAILED, ...UNCHECKED].sort();
  assert.deepEqual(covered, [...FAULT_CLASSES].sort());

  for (const cls of FAILED) assert.equal(probeState(outcome(cls)), "failed", cls);
  for (const cls of UNCHECKED) assert.equal(probeState(outcome(cls)), "unchecked", cls);
});
