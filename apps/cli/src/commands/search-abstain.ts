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

// Exit codes: 0 = ok (including abstain), 1 = generic failure / zero results
// outside any domain policy, 2 = usage error, 3 = abstain with --fail-on-abstain
// (dedicated nonzero so automation can discriminate without scraping text).
export function searchExitCode(input: { resultCount: number; abstain?: boolean; failOnAbstain: boolean }): number {
  if (input.abstain) return input.failOnAbstain ? 3 : 0;
  return input.resultCount > 0 ? 0 : 1;
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

/** 没配 key 这一句只有一份：失败行和凭据措辞都从这儿取。 */
const NO_KEY_LABEL = "没配 key";

/**
 * 没配 key 时这一臂实际怎么跑：doctor 读 `runs` + `limit`，失败行只有 tavily 读
 * `runs`（exa / anysearch 在失败行只说 key 状态，见 sourceNote）。三家服务都有免费
 * 路，但只有 tavily 和 anysearch 的适配器能不带 key 发请求；exa 的适配器只走 REST，
 * 没 key 就建不起来（它自己的 MCP 端点不用 key，那是另一条路）。
 */
const KEYLESS_BEHAVIOR: Record<SearchProviderId, { runs: string; limit?: string }> = {
  tavily: { runs: "用免费额度跑", limit: FREE_QUOTA_LIMIT },
  anysearch: { runs: "用免费额度跑", limit: FREE_QUOTA_LIMIT },
  exa: { runs: "这个源不参与（适配器只走 REST；Exa 自己的 MCP 端点不用 key，那是另一条路）" },
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
 * 额度的上限说明。这一行报 `unconfigured`，得说清「能跑」不等于「稳定可用」，
 * 报 `ready` 会骗人；exa 那句自己就说明了不参与，所以没有上限说明可加。
 */
export function describeUnconfiguredSource(provider: SearchProviderId): string {
  const limit = KEYLESS_BEHAVIOR[provider].limit;
  return describeCredentialSource("none", provider) + (limit ? "（" + limit + "）" : "");
}

/**
 * Providers failed 那一行：括号里写各臂的 key 来源；解析没跑成、或记录里
 * 没这个臂，就什么都不写（不编来源）。
 */
function sourceNote(id: string, sources: Extract<CredentialSources, { status: "resolved" }>): string | undefined {
  if (id === "tavily") return describeCredentialSource(sources.tavily, "tavily");
  if (id === "exa" || id === "anysearch") {
    // Neither can promise the default service in a failure line: anysearch's
    // endpoint is an env override, and exa's adapter refuses without a key. Name
    // the key state only, so this never contradicts doctor's own row.
    const label = sources[id];
    return label === "env" || label === "user" ? describeCredentialSource(label, id) : NO_KEY_LABEL;
  }
  // Unknown ids get no note: the kernel record only names the three search arms,
  // and inventing a key state for anything else would be a lie.
  return undefined;
}

/**
 * Providers cancelled 那一行：宽限窗口掐掉的臂（#454 / #475）。不是失败，也
 * 不是没问——引擎真问了它，只是结果够了没再等。空表返回 undefined，所以健康
 * 路径一个字都不多。
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
