// Search presentation helpers — pure, no imports, so the contract is
// unit-testable without pulling the kernel module graph (and its ESM-only
// pi-agent-core dependency) into the test.
// Abstain line + provider build-failure absence line share this module: both
// are presentation contracts of `ans search` — stdout in the result/abstain
// render; the absence line additionally rides stderr on the error path.

// 只做类型导入，运行时擦除。标签类型在 kernel/composition；本模块还管
// `Providers failed` 行的来源标注和 doctor 共用的「免费额度」/凭据措辞。
import type { CredentialSourceLabel, CredentialSources } from "@anysearch-cli/kernel";
// 同样只做类型导入；provider 联合由 store 拥有，这里不复制一份。新增
// provider 时下面的 Record 会编译失败，直到补上它没配 key 时的说法。
import type { SearchProviderId } from "@anysearch-cli/store";
// 判据只有一份，在 retriever 的 outcome 模块里。这里只借它的类型，
// 运行时不留依赖 —— 退出码表读的就是引擎写进信封的那个值。
import type { SearchOutcome } from "@anysearch-cli/retriever";

// Exit codes: 0 = ok (including abstain), 1 = generic failure, all providers
// failed, or zero results that are not an abstain (empty), 2 = usage error,
// 3 = abstain with --fail-on-abstain (dedicated nonzero so automation can
// discriminate without scraping text). A cancelled search is zero results by
// definition, so it exits 1; 0 is for an answer or an abstain.
export function searchExitCode(input: { outcome: SearchOutcome; failOnAbstain: boolean }): number {
  if (input.outcome === "abstain") return input.failOnAbstain ? 3 : 0;
  return input.outcome === "answer" ? 0 : 1;
}

// One-line structured abstain message: domain, pre/post gate
// counts, and which gate left the pool empty. Single line so it survives pipes.
export function formatAbstainLine(abstain: { domain?: string; preFiltered: number; postFiltered: number; gate: "pre" | "post" }): string {
  return "abstain: no results within allowed " + (abstain.domain ?? "domain") + " domain(s)" +
    " (pre-filtered " + abstain.preFiltered + ", post-filtered " + abstain.postFiltered + ", gate " + abstain.gate + ")";
}

// Remedy lines printed under "Providers failed": one line per entry, exactly
// what the caller passes in — the filtering (which arms have a sentence) is
// providerErrorHints' job, not this function's. Kept free of imports for the
// same reason as the rest of this module — the hint table is the caller's.
export function formatProviderHintLines(hints: Record<string, string>): string[] {
  return Object.entries(hints).map(([id, sentence]) => "  " + id + ": " + sentence);
}

// The failed-arm block both render paths print: the "Providers failed" line,
// then one remedy line per arm whose class has a sentence. Empty list means no
// arm failed, so the healthy path stays as quiet as before. One function for
// both branches, so a branch cannot forget the remedy, and a unit test can pin
// the block without a built CLI. The hints arrive from the caller because the
// table lives in the kernel and this module stays free of runtime imports.
export function formatFailedArmLines(input: {
  providersFailed: readonly string[];
  credentialSources?: CredentialSources;
  hints: Record<string, string>;
}): string[] {
  if (input.providersFailed.length === 0) return [];
  return [
    formatProvidersFailedLine(input.providersFailed, input.credentialSources),
    ...formatProviderHintLines(input.hints),
  ];
}

// Provider build-failure absence line (#180, follow-up to #41's kernel-side
// record): pairs the kernel's construction-time providerBuildErrors record
// with the runtime provider chain lines ("Providers queried" / "Providers
// failed") so the user can self-serve a key/config fix — which arm never
// entered the fanout, and under which safe category. Only the kernel's
// category wording rides verbatim (CWE-532: raw construction error text never
// reaches this surface — the record itself is category-only by kernel
// contract). One line for the whole absence list, "; "-joined per arm;
// undefined when every enabled arm built, so the healthy path is zero-noise.
export function formatProviderAbsentLine(buildErrors: Record<string, string>): string | undefined {
  const entries = Object.entries(buildErrors);
  if (entries.length === 0) return undefined;
  return "Providers absent (build failure): " + entries.map(([id, category]) => id + " — " + category).join("; ");
}

const FREE_QUOTA_LIMIT = "有次数和速度上限";

/** 只给 doctor 那一行用：说的是「没验」，不是「验过了」。 */
const FREE_QUOTA_UNVERIFIED_NOTE = "免费额度这条路没验";

/** 没配 key 这一句只有一份：失败行和凭据措辞都从这儿取。 */
const NO_KEY_LABEL = "没配 key";

/**
 * 文件坏掉时不能说「没配 key」：用户配过，只是文件读不出来。这句和
 * `NO_KEY_LABEL` 并列，失败行按记录里有没有 fault 二选一（#533）。
 */
const BROKEN_FILE_LABEL = "凭据文件坏了，没配上 key";

/**
 * 没配 key 时这一臂实际怎么跑：doctor 读 `runs` + `limit`，失败行里 tavily / exa 也读
 * `runs`（anysearch 只说 key 状态，见 sourceNote）。三家都能不带 key 发请求：tavily /
 * anysearch 走各自的免费额度，exa 走它自己的 MCP 端点。
 */
const KEYLESS_BEHAVIOR: Record<SearchProviderId, { runs: string; limit: string }> = {
  tavily: { runs: "用免费额度跑", limit: FREE_QUOTA_LIMIT },
  anysearch: { runs: "用免费额度跑", limit: FREE_QUOTA_LIMIT },
  exa: { runs: "用免费额度跑", limit: FREE_QUOTA_LIMIT },
};

/**
 * 一处 key 来源措辞，`ans search` 和 `ans doctor` 共用，避免两边说两套。
 */
export function describeCredentialSource(label: CredentialSourceLabel, provider: SearchProviderId): string {
  if (label === "env") return "key 来自环境变量";
  if (label === "user") return "key 来自用户凭据文件";
  return NO_KEY_LABEL + "，" + KEYLESS_BEHAVIOR[provider].runs;
}

/**
 * doctor 的「信息源」行专用：就是 `describeCredentialSource("none", …)` 再加免费
 * 额度的上限说明和一句「没验」。这一行报 `unconfigured`，得说清「能跑」不等于
 * 「稳定可用」，报 `ready` 会骗人。
 *
 * Design: 「用免费额度跑」说的是运行时会怎么跑，不是 doctor 验过。
 */
export function describeUnconfiguredSource(provider: SearchProviderId): string {
  return describeCredentialSource("none", provider) + "（" + KEYLESS_BEHAVIOR[provider].limit + "）；" + FREE_QUOTA_UNVERIFIED_NOTE;
}

/**
 * Providers failed 那一行：括号里写各臂的 key 来源；解析没跑成、或记录里
 * 没这个臂，就什么都不写（不编来源）。
 */
function sourceNote(id: string, sources: Extract<CredentialSources, { status: "resolved" }>): string | undefined {
  // #533: a fault in the credential file means no arm can have a stored key, so
  // "not configured" would name the wrong cause for every keyless arm.
  const keyless = sources.credentialFileFault ? BROKEN_FILE_LABEL : NO_KEY_LABEL;
  // tavily / exa 的端点是固定的，没配 key 就走默认服务上的免费额度，失败行可以说全。
  if (id === "tavily" || id === "exa") {
    const label = sources[id];
    return label === "none"
      ? keyless + "，" + KEYLESS_BEHAVIOR[id].runs
      : describeCredentialSource(label, id);
  }
  if (id === "anysearch") {
    // anysearch 的端点能被环境变量改掉，失败行没法承诺「默认服务上的免费额度」，
    // 只说 key 状态，免得和 doctor 那行打架。
    const label = sources.anysearch;
    return label === "env" || label === "user" ? describeCredentialSource(label, "anysearch") : keyless;
  }
  // Unknown ids get no note: the kernel record only names the three search arms,
  // and inventing a key state for anything else would be a lie.
  return undefined;
}

/**
 * Providers cancelled 那一行：引擎真问了、只是没等回来的臂。不是失败，也不是
 * 没问。空表返回 undefined，所以健康路径一个字都不多。
 */
export function formatProvidersCancelledLine(providersCancelled: readonly string[]): string | undefined {
  if (providersCancelled.length === 0) return undefined;
  return "Providers cancelled: " + providersCancelled.join(", ") + "（结果够了，没等它回来）";
}

export function formatProvidersFailedLine(
  providersFailed: readonly string[],
  sources?: CredentialSources,
): string {
  return "Providers failed: " + providersFailed
    .map((id) => {
      const note = sources?.status === "resolved" ? sourceNote(id, sources) : undefined;
      return note === undefined ? id : id + "（" + note + "）";
    })
    .join(", ");
}
