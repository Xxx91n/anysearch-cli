// The words a model failure may show a host.
//
// A host keeps `content` and `structuredContent` and pastes them into chats and
// bug reports, so a failure carries the kind of problem and the fix — never a
// key, a machine path, the configured provider, a credential inside a URL, or a
// resolver warning as written. The raw text still goes to stderr through
// `writeRedactedDiagnostic`: that is the operator's copy.

import { redactPaths, redactSecrets } from "@anysearch-cli/retriever";

export interface ModelFailureContext {
  /** Effective provider from the resolved config. */
  provider?: string;
  /** Effective model: a name the caller may have to change, not a secret. */
  model?: string;
  /** Effective endpoint; it may carry userinfo or a query credential. */
  baseUrl?: string;
  /** Resolver warnings collected for this call, verbatim. */
  warnings?: readonly string[];
}

type ModelFailureKind = "configuration" | "authentication" | "filesystem" | "runtime";

// Order matters. A file error usually also names the key it could not read,
// and an upstream 401 also names the key it rejected; both outrank the wording
// after them. HTTP matching is anchored so a port (`127.0.0.1:403`) is not an
// auth answer.
const FILE_ACCESS_RE =
  /\bEACCES\b|\bEPERM\b|\bEISDIR\b|\bENOSPC\b|permission denied|operation not permitted|no space left/i;
const AUTHENTICATION_RE =
  /HTTP(?:\/\d(?:\.\d)?)?[ ]?40[13]\b|status(?: code)?\s*[:=]?\s*40[13]\b|(?:^|[^0-9.:])40[13](?=$|[^0-9])|invalid[_ -]?x?-?api[_ -]?key|incorrect api key|unauthori[sz]ed|forbidden|authentication (?:failed|error)/i;
const CONFIGURATION_RE =
  /ANS_LLM_|unknown (?:llm )?provider|unsupported provider|no such provider|model not found|missing (?:api key|model|provider)|invalid (?:api|base[_ ]?url)|requires explicit api|contextwindow must be|not configured|configuration/i;

/** Which fix the caller should reach for. Classification reads the raw text, before redaction. */
function classifyModelFailure(text: string): ModelFailureKind {
  if (FILE_ACCESS_RE.test(text)) return "filesystem";
  if (AUTHENTICATION_RE.test(text)) return "authentication";
  if (CONFIGURATION_RE.test(text)) return "configuration";
  return "runtime";
}

const KIND_TEXT: Record<ModelFailureKind, string> = {
  configuration: "configuration problem",
  authentication: "authentication problem",
  filesystem: "file access problem",
  runtime: "runtime problem",
};

const KIND_HINT: Record<ModelFailureKind, string> = {
  configuration: "Check provider/model/base_url/api with `ans llm`.",
  authentication: "Check the key with `ans auth`.",
  filesystem: "Check file permissions for the config, credential and database files.",
  runtime: "Try again; if it keeps failing, run `ans doctor`.",
};

/**
 * The same text with everything machine-specific taken out. Later passes read
 * substrings the earlier ones would rewrite, so the order matters; spacing and
 * punctuation stay as written because the observation stores this string.
 */
export function redactForHost(text: string, ctx: ModelFailureContext = {}): string {
  let out = text;
  for (const warning of ctx.warnings ?? []) {
    if (warning) out = out.split(warning).join(" ");
  }
  const baseUrl = ctx.baseUrl?.trim();
  if (baseUrl) {
    // A configured endpoint with credentials or a query is a secret as a whole;
    // both spellings the SDK may print are removed.
    for (const form of new Set([baseUrl, baseUrl.replace(/\/+$/, "")])) {
      if (form) out = out.split(form).join("[endpoint]");
    }
  }
  // Any other URL keeps its host and path but loses userinfo, query and fragment:
  // a bare `token=` value is too short for the key rules below to catch.
  out = out.replace(/\bhttps?:\/\/[^\s"'`<>。，；：！？、）]+/gi, (url) => {
    const tail = url.match(/[.,;:)\]。，；：！？、）]+$/)?.[0] ?? "";
    const core = url.slice(0, url.length - tail.length).split("#")[0].split("?")[0];
    return core.replace(/^(https?:\/\/)[^/@]*@/i, "$1[redacted]@") + tail;
  });
  const model = ctx.model && ctx.model.length >= 3 ? ctx.model : undefined;
  if (model) out = out.split(model).join("ZZMODELVALUEZZ");
  out = redactSecrets(redactPaths(out), { keepEnvNames: true });
  if (model) out = out.split("ZZMODELVALUEZZ").join(model);
  const provider = ctx.provider;
  // One- and two-letter values are names; replacing every occurrence would
  // shred the sentence into noise.
  if (provider && provider.length >= 3) out = out.split(provider).join("[provider]");
  return out;
}

/** The phrase both the host result and the stderr line lead with. */
export function modelFailureLabel(phase: "setup" | "run"): string {
  return phase === "setup" ? "model setup failed" : "model request failed";
}

/**
 * The one line an `ans_chat` failure puts in `content`: the phase, the kind of
 * problem, the redacted detail (when any survived) and the fix. Newlines and
 * dangling punctuation from a removed warning are cleaned up here; the stored
 * observation keeps `redactForHost`'s exact text.
 */
export function formatModelFailure(
  phase: "setup" | "run",
  detail: string,
  ctx: ModelFailureContext = {},
): string {
  const kind = classifyModelFailure(detail);
  const head = modelFailureLabel(phase);
  const clean = redactForHost(detail, ctx)
    .replace(/\s+/g, " ")
    .replace(/^[\s:;,.-]+/, "")
    .replace(/[.\s]+$/, "");
  return (clean ? head + " (" + KIND_TEXT[kind] + "): " + clean : head + " (" + KIND_TEXT[kind] + ")") +
    ". " + KIND_HINT[kind];
}
