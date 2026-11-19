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
  | DomainConstraintFailure;

export interface DomainConstraintFailure {
  state: "failed";
  name: string;
  declared: boolean;
  /** `missing` = no TOML on the chain; `broken` = a TOML exists but is unusable. */
  fault: "missing" | "broken";
  /** The underlying message, verbatim, for the operator. */
  reason: string;
  /** True when this failure must stop new controlled work. */
  fatal: boolean;
}

/**
 * Build a failure with its `fatal` rule applied in one place: a file that exists
 * but does not validate is always a fault, while an absent file is a fault only
 * when someone asked for it by name. Runtime faults (a reload that failed) are
 * `broken` by construction and therefore always fatal.
 */
export function domainConstraintFailure(input: {
  name: string;
  declared: boolean;
  fault: "missing" | "broken";
  reason: string;
}): DomainConstraintFailure {
  return { state: "failed", ...input, fatal: input.fault === "broken" || input.declared };
}

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
    return domainConstraintFailure({
      name,
      declared,
      fault: isDomainNotFoundError(e) ? "missing" : "broken",
      reason: errText(e),
    });
  }
}

/** The error an entry throws when a declared domain cannot be established. */
export class DomainConstraintError extends Error {
  readonly constraint: DomainConstraintFailure;

  constructor(constraint: DomainConstraintFailure) {
    super(describeDomainFailure(constraint));
    this.name = "DomainConstraintError";
    this.constraint = constraint;
  }
}

export function isDomainConstraintError(e: unknown): e is DomainConstraintError {
  return e instanceof DomainConstraintError;
}

/** What exactly is wrong, in one clause — shared by both messages below. */
function failureDetail(constraint: DomainConstraintFailure): string {
  return constraint.fault === "missing"
    ? "在领域目录里没找到 " + constraint.name + ".toml"
    : "它的配置读不出来（" + constraint.reason + "）";
}

/** One plain sentence for the operator: what is wrong and what to do next. */
export function describeDomainFailure(constraint: DomainConstraintFailure): string {
  const head = constraint.declared
    ? "指定的领域 \"" + constraint.name + "\" 没建起来"
    : "默认领域 \"" + constraint.name + "\" 没建起来";
  return head + "：" + failureDetail(constraint) + "。这一步没有执行。"
    + "换成已有的领域用 ans domain <名字>，或把 ANS_DOMAINS_DIR 指到放 toml 的目录。";
}

/**
 * The same fault, said for the case where it does NOT stop the work: nobody
 * named this domain, so running with no filtering is still a legal run. Saying
 * "这一步没有执行" here would be a lie about what the program just did.
 */
export function describeDomainFallback(constraint: DomainConstraintFailure): string {
  return "没指定领域，" + failureDetail(constraint) + "，这次按不限定领域继续：全部信息源都开，不做网址过滤。"
    + "想固定领域就运行 ans domain <名字>。";
}
