// doctor 那一行的措辞：把探针的结论翻成四种状态加一句话。
//
// 只有 doctor 走这里。`ans auth set` 自己说一句英文（那个文件本来就是英文），
// 但它和这里吃的是同一个 ProbeOutcome、同一套错误类，不各造一套判断。

import type {
  ProbeFaultClass,
  ProbeOutcome,
  UndetectableClass,
} from "@anysearch-cli/retriever/providers";
import type { DiagState } from "./diagnostics";

const FAULT_TEXT: Record<ProbeFaultClass, string> = {
  "permanent-auth": "上游不认这把 key",
  "quota-exhausted": "额度用尽",
  "permanent-protocol": "入口回的东西跟预期对不上",
  "session-expired": "会话过期",
  transient: "上游抽风（429 / 5xx 一类）",
  unreachable: "连不上（超时 / 拒绝连接 / DNS）",
  unknown: "认不出来的错",
};

const UNDETECTABLE_TEXT: Record<UndetectableClass, string> = {
  auth: "auth（key 好坏）",
  quota: "额度（这家没有单独的用量接口）",
};

/**
 * 四种状态里挑一个。只有「key 确实被拒」判失败；额度用尽和入口变了也是要修的真问题，
 * 同样算失败；抽风、连不上、认不出来只能算未检查 —— 上游抽风不等于 key 坏了。
 */
export function probeState(outcome: ProbeOutcome): DiagState {
  if (outcome.auth === "rejected") return "failed";
  const fault = outcome.problem?.class;
  if (fault === "permanent-auth" || fault === "quota-exhausted" || fault === "permanent-protocol") return "failed";
  if (fault) return "unchecked";
  return outcome.auth === "ok" ? "ready" : "unchecked";
}

/** 一行说清结论：验到了什么、没验成什么、什么问题。 */
export function probeDetail(outcome: ProbeOutcome): string {
  const parts: string[] = [];
  const problem = outcome.problem;
  if (problem) {
    // 2xx 上的「问题」是回包正文说的（比如用量满了），状态码不说明任何事，
    // 别在「额度用尽」后面挂一个「HTTP 200」让人以为是坏消息写错了。
    const status = problem.status === undefined || problem.status < 400 ? "" : " HTTP " + problem.status;
    const code = problem.code ? " " + problem.code : "";
    parts.push(FAULT_TEXT[problem.class] + (status || code ? "（" + (status + code).trim() + "）" : ""));
    // key 验过了、坏的是别的（额度 / 入口），要说清，免得看的人以为 key 有问题。
    if (outcome.auth === "ok") parts.push("key 本身验过了");
  } else {
    parts.push("auth 通过");
  }
  const usage = outcome.usage;
  if (usage && (usage.plan || typeof usage.used === "number")) {
    const counts = typeof usage.used === "number"
      ? usage.used + "/" + (typeof usage.limit === "number" ? usage.limit : "?")
      : "";
    parts.push([usage.plan, counts].filter(Boolean).join(" "));
  }
  const tools = outcome.tools;
  if (tools) {
    let entry: string;
    if (!tools.searchTool) entry = "没有 search 这个工具";
    else if (tools.queryArg) entry = "search 入参还对";
    else entry = "search 入参变了";
    parts.push(`tools/list 回了 ${tools.count} 个：${entry}`);
  }
  if (outcome.undetectable.length > 0) {
    parts.push("这家免费面验不到：" + outcome.undetectable.map((kind) => UNDETECTABLE_TEXT[kind]).join("、"));
  }
  return parts.join("；");
}
