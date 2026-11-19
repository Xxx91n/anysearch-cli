// #306: one answer to "is the Active Domain actually in effect?" for every
// entry that is about to do something the domain is supposed to constrain.
//
// Three states, kept apart on purpose (S9):
// - undeclared: nobody named a domain. Running the full fanout is the legal
//   default here, not a failure.
// - established: the named TOML resolved and validated; its allowlist, provider
//   set and tool whitelist are the ones in force.
// - failed: a domain was named but could not be resolved. Whether that stops
//   the caller depends on who named it: an explicit declaration that cannot be
//   honoured is a fault, while the product's own `default` convention falling
//   back to no filtering is the behaviour it had before.
//
// The point of the module is that entries do not each re-decide this from a
// bare `undefined` or a reload that returns null for two different things. They
// ask here, and the answer carries its own reason.

import { isDomainNotFoundError, loadDomainByNameIn, type DomainSchema } from "@anysearch-cli/store";

export interface DomainConstraintInput {
  /** The name to resolve: the operator's declaration, or the convention default. */
  name?: string | null;
  /**
   * True when `name` came from an explicit declaration (ANS_DOMAIN, the
   * persisted selection, or a flag). Defaults to true whenever a name is given,
   * because passing a name is itself a request for that domain.
   */
  declared?: boolean;
  /** The domains-dir resolution chain, in probe order. */
  dirs: string[];
}

export type DomainConstraint =
  | { state: "undeclared" }
  | { state: "established"; name: string; schema: DomainSchema }
  | {
      state: "failed";
      name: string;
      declared: boolean;
      /** `missing` = no TOML on the chain; `broken` = a TOML exists but is unusable. */
      fault: "missing" | "broken";
      /** The underlying message, verbatim, for the operator. */
      reason: string;
      /** True when this failure must stop new controlled work. */
      fatal: boolean;
    };

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function resolveDomainConstraint(input: DomainConstraintInput): DomainConstraint {
  const name = input.name?.trim();
  if (!name) return { state: "undeclared" };
  const declared = input.declared !== false;
  try {
    return { state: "established", name, schema: loadDomainByNameIn(name, input.dirs) };
  } catch (e: unknown) {
    const missing = isDomainNotFoundError(e);
    // A file that exists but does not validate is always a fault: swallowing it
    // would silently drop the operator's allowlist/weights. An absent file is a
    // fault only when someone asked for it by name.
    const fatal = !missing || declared;
    return {
      state: "failed",
      name,
      declared,
      fault: missing ? "missing" : "broken",
      reason: errText(e),
      fatal,
    };
  }
}

/** The error an entry throws when a declared domain cannot be established. */
export class DomainConstraintError extends Error {
  readonly constraint: Extract<DomainConstraint, { state: "failed" }>;
  /** The runtime/MCP reason code, so hosts classify instead of parsing text. */
  readonly reasonCode = "domain-not-established";

  constructor(constraint: Extract<DomainConstraint, { state: "failed" }>) {
    super(describeDomainFailure(constraint));
    this.name = "DomainConstraintError";
    this.constraint = constraint;
  }
}

export function isDomainConstraintError(e: unknown): e is DomainConstraintError {
  return e instanceof DomainConstraintError;
}

/** One plain sentence for the operator: what is wrong and what to do next. */
export function describeDomainFailure(
  constraint: Extract<DomainConstraint, { state: "failed" }>,
): string {
  const head = constraint.declared
    ? "指定的领域 \"" + constraint.name + "\" 没建起来"
    : "默认领域 \"" + constraint.name + "\" 没建起来";
  const detail = constraint.fault === "missing"
    ? "在领域目录里没找到 " + constraint.name + ".toml"
    : "它的配置读不出来（" + constraint.reason + "）";
  return head + "：" + detail + "。这一步没有执行。"
    + "换成已有的领域用 ans domain <名字>，或把 ANS_DOMAINS_DIR 指到放 toml 的目录。";
}

/**
 * The same fault, said for the case where it does NOT stop the work: nobody
 * named this domain, so running with no filtering is still a legal run. Saying
 * "这一步没有执行" here would be a lie about what the program just did.
 */
export function describeDomainFallback(
  constraint: Extract<DomainConstraint, { state: "failed" }>,
): string {
  const detail = constraint.fault === "missing"
    ? "在领域目录里没找到 " + constraint.name + ".toml"
    : "它的配置读不出来（" + constraint.reason + "）";
  return "没指定领域，" + detail + "，这次按不限定领域继续：全部信息源都开，不做网址过滤。"
    + "想固定领域就运行 ans domain <名字>。";
}
