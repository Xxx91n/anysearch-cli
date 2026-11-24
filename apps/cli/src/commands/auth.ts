// ans auth: provider API keys — status, and one-place entry (#301).
//
// Before #301 this command only printed whether the search providers' env vars
// were set, and every key had to be exported in each shell (and was invisible
// to a GUI host, which inherits no shell env). Now the same command can store a
// key once in the user credential file; both the CLI and a GUI/MCP entry on the
// same machine and account read it, while an explicit env value still wins.
//
// The file is plaintext on purpose and says so, in its prompt, its `list`
// output and in the file's own note. Nothing here prints a key value: `list`
// shows only whether an entry exists and which provider/endpoint it is bound
// to — not the value, and not any prefix or suffix of it.

import {
  CREDENTIAL_PROVIDERS,
  credentialFileWarning,
  type CredentialFileContents,
  credentialProvider,
  displayEndpoint,
  normalizeBindingEndpoint,
  readUserCredentials,
  removeUserCredential,
  repairUserCredentials,
  resolveConfigHome,
  resolveLlmConfig,
  userCredentialsPath,
  writeUserCredential,
} from "@anysearch-cli/store";
import {
  isProbeProviderId,
  probeProviderAuth,
  type ProbeOutcome,
  type ProbeProviderId,
} from "@anysearch-cli/retriever/providers";
import { KEY_SOURCE_LABELS, type LlmLayer } from "../config-llm";
import { cleanSecret, readSecret, SecretInputCancelled, type SecretInputIO } from "../secret-input";

/**
 * Test seam: lets a test supply the stdin stream a scripted run would give
 * (`printf '%s' "$KEY" | ans auth set openai`), an output sink for the prompt,
 * and sinks for the two output channels — without patching process.stdin,
 * process.stdout or process.stderr. Patching those globals inside a node --test
 * file desyncs the reporter and silently drops later test results.
 * Production leaves it unset and gets the terminal.
 */
export const AUTH_IO: {
  input?: SecretInputIO["input"];
  output?: SecretInputIO["output"];
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
} = {};

/** One line, same shape as console.log: the newline is part of the seam. */
function stdout(text: string): void {
  if (AUTH_IO.stdout) AUTH_IO.stdout(text + "\n");
  else process.stdout.write(text + "\n");
}

/** Verbatim write, same shape as process.stderr.write: the caller owns newlines. */
function stderr(text: string): void {
  if (AUTH_IO.stderr) AUTH_IO.stderr(text);
  else process.stderr.write(text);
}

/** Show whether an entry exists, bound where — and it must never show the value. */
function describeBinding(binding: { provider: string; endpoint: string | null }): string {
  return binding.provider + "  " + displayEndpoint(binding.endpoint);
}

function usage(): number {
  stderr("ans auth - provider API keys\n");
  stderr("\n");
  stderr("  ans auth                     Show where each provider's key comes from\n");
  stderr("  ans auth list                Same, plus the stored entries and where the file is\n");
  stderr("  ans auth set <provider>      Store a key in the user credential file (typed, never echoed)\n");
  stderr("      [--endpoint <url>]       Model providers only: bind the key to one endpoint\n");
  stderr("      [--no-verify]            Do not check a search key upstream before storing it (offline machines)\n");
  stderr("  ans auth remove <provider>   Remove one stored key [--endpoint <url>]\n");
  stderr("  ans auth repair              Keep the keys a broken file can still give up, drop the rest\n");
  stderr("\n");
  stderr("Providers: " + CREDENTIAL_PROVIDERS.map((p) => p.id).join(", ") + "\n");
  stderr("The store is plain text, owner-only, and shared by the CLI and GUI entries of this account.\n");
  stderr("An explicit env value (e.g. ANS_LLM_API_KEY) always wins over it.\n");
  return 2;
}

/** Parse `--endpoint <url>` / `--endpoint=<url>` out of an argument list. */
function takeEndpoint(args: string[]): { endpoint: string | null; rest: string[] } {
  const rest: string[] = [];
  let endpoint: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const eq = a.indexOf("=");
    const name = eq >= 0 ? a.slice(0, eq) : a;
    if (name === "--endpoint") {
      const value = eq >= 0 ? a.slice(eq + 1) : args[++i];
      // One guard per failure mode: missing, empty, and "the next token is a
      // flag". `--endpoint --foo` must not swallow the flag as a URL, and an
      // empty value must not quietly fall back to the default endpoint - either
      // would store a key bound somewhere the user did not ask for.
      if (value === undefined) throw new Error("--endpoint requires a URL");
      // One guard owns "empty": a blank value and a whitespace-only value both
      // land here, and `normalizeBindingEndpoint` is the one rule for what
      // counts as empty. Storing either would bind the key somewhere the user
      // did not ask for.
      if (value.startsWith("-")) throw new Error("--endpoint requires a URL, got the flag " + value);
      const normalized = normalizeBindingEndpoint(value);
      if (normalized === null) throw new Error("--endpoint must not be empty; omit it to use the provider's default endpoint");
      endpoint = normalized;
      continue;
    }
    rest.push(a);
  }
  return { endpoint, rest };
}

/**
 * Describe where a key comes from, given the resolver's answer. `env` is spelled
 * out by the caller, which knows which variable is actually in effect.
 */
function describeSource(layer: LlmLayer | undefined): string {
  return layer ? KEY_SOURCE_LABELS[layer] : "set";
}

function statusLines(
  env: NodeJS.ProcessEnv,
  home: string,
  file: CredentialFileContents,
): string[] {
  // 模型解析器吃的是调用方给的这一份，不再自己读一遍。
  const llm = resolveLlmConfig({ env, home, credentialsFile: file });
  const lines: string[] = [];

  for (const info of CREDENTIAL_PROVIDERS) {
    const envValue = env[info.envKey]?.trim();
    const binding = file.bindings.find((b) => b.provider === info.id);
    let where: string;
    let state: "set" | "empty" | "broken";
    if (info.kind === "model" && info.id === llm.provider && llm.apiKey) {
      // Report where the EFFECTIVE model key came from. `env` covers two
      // variables, so name the one actually set: a cross-config override
      // (ANS_LLM_API_KEY) is a different fact from "this provider's own variable
      // is exported".
      if (llm.sources.apiKey === "env") {
        where = env.ANS_LLM_API_KEY?.trim() ? "env ANS_LLM_API_KEY" : "env " + info.envKey;
      } else {
        where = describeSource(llm.sources.apiKey);
      }
      state = "set";
    } else if (envValue) {
      where = "env " + info.envKey;
      state = "set";
    } else if (file.error) {
      // The file is broken, so this command cannot tell whether the provider had
      // an entry. "not set" would be a lie about a key that is still in the file
      // (#537).
      where = "unknown - the credential file could not be read";
      state = "broken";
    } else if (binding) {
      where = "stored file" + (binding.endpoint ? " (" + displayEndpoint(binding.endpoint) + ")" : "");
      state = "set";
    } else {
      where = "not set";
      state = "empty";
    }
    const mark = state === "broken" ? "[BROKEN]" : state === "empty" ? "[EMPTY]" : "[SET]";
    lines.push(mark.padEnd(8) + " " + info.id.padEnd(10) + " " + where);
  }
  return lines;
}

/**
 * One line for a probe outcome: the error class this repo already uses, plus the
 * HTTP status when there was one. No raw upstream text — an error body can echo
 * the key, and nothing here needs it.
 */
function faultLine(outcome: ProbeOutcome): string {
  const problem = outcome.problem;
  if (!problem) return outcome.auth;
  const where = (problem.status === undefined ? "" : " HTTP " + problem.status) + (problem.code ? " " + problem.code : "");
  return problem.class + (where ? ":" + where : "");
}

/**
 * Check a search key against its provider's free surface before storing it.
 * Only the free surface: no search runs and no quota is spent.
 *
 * A rejected key is not stored — the point of the check is that a typo never
 * becomes a stored key. Anything else (429, 5xx, no network, an exhausted plan)
 * only warns: the key may well be fine, and an offline machine must still be
 * able to store one. Returns false only when the upstream refused the key.
 *
 * Nothing here claims the key was stored: the write happens after this returns,
 * and a warning that said "stored anyway" would contradict the error that
 * follows when the file turns out to be unwritable.
 */
async function verifySearchKey(
  provider: ProbeProviderId,
  apiKey: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  const endpoint = provider === "anysearch" ? env.ANYSEARCH_ENDPOINT?.trim() || undefined : undefined;
  stderr("Checking " + provider + " against its free surface (no search, no quota)...\n");
  let outcome: ProbeOutcome;
  try {
    outcome = await probeProviderAuth(provider, { apiKey, endpoint });
  } catch {
    // The probes promise not to throw; if one still does, that is not a reason
    // to keep a key out of the file.
    stderr("[warn] could not check the key (probe failed); run `ans doctor --live` later.\n");
    return true;
  }
  if (outcome.auth === "rejected") {
    stderr("upstream rejected this key (" + faultLine(outcome) + "); nothing was written.\n" +
      "Copy the key from " + provider + "'s own console, or add --no-verify to store it without checking.\n");
    return false;
  }
  if (outcome.auth !== "ok") {
    stderr("[warn] could not check the key (" + faultLine(outcome) + "). " +
      "Run `ans doctor --live` when the network is back.\n");
  } else if (outcome.problem) {
    // The key is good, the account is not usable right now (exhausted plan,
    // drifted entry). Worth saying; not a reason to refuse the key.
    stderr("[warn] the key is good, but " + provider + " cannot answer right now (" +
      faultLine(outcome) + ").\n");
  } else {
    stderr("Checked: " + provider + "'s free surface accepted this key.\n");
  }
  return true;
}

/** One shared rejection so `set` and `remove` cannot drift apart. */
function rejectUnknownProvider(provider: string): number {
  stderr("Unknown provider: " + provider + "\n");
  stderr("Available: " + CREDENTIAL_PROVIDERS.map((p) => p.id).join(", ") + "\n");
  return 2;
}

export async function runAuth(args: string[]): Promise<number> {
  const sub = args[0];
  // ONE root for the whole run: status, list, set and remove all describe and
  // touch the same file, and an env change mid-run cannot move it under them.
  const env = process.env;
  const home = resolveConfigHome(undefined, env);

  if (sub === undefined || sub === "status" || sub === "list") {
    // Design: 整条命令读一次凭据文件，来源表和模型解析器共用；读坏了 status 说一次，
    // list 只在文件块里说一次。
    const file = readUserCredentials({ home });
    stdout("ans auth - provider API keys");
    stdout("---");
    for (const line of statusLines(env, home, file)) stdout(line);
    // `list` 紧接着的「BROKEN —」那行说的就是这句，那里说一遍就够了。
    const fault = credentialFileWarning(file);
    if (sub !== "list" && fault) stdout("[WARN] " + fault);
    stdout("---");
    if (sub === "list") {
      const path = userCredentialsPath(home);
      stdout("Credential file: " + path);
      stdout("  " + (file.error ? "BROKEN — " + file.error : "plain text, not encrypted, owner-only"));
      if (file.bindings.length > 0) {
        for (const binding of file.bindings) {
          stdout("  " + describeBinding(binding));
        }
      } else if (!file.error) {
        stdout("  (no stored keys)");
      }
    }
    stdout("Store a key: ans auth set <provider>   (typed, never echoed)");
    stdout("Env still wins: ANS_LLM_API_KEY, or the provider's own *_API_KEY variable");
    if (file.error) {
      // A script reading only the exit code could not tell a broken file from a
      // healthy one. `ans doctor` already exits 1 for this same file, so this
      // command stops being the outlier (#537).
      stdout("Fix the file: ans auth repair   (keeps the keys it can read)");
      return 1;
    }
    return 0;
  }

  if (sub === "set") {
    let endpoint: string | null;
    let rest: string[];
    try {
      ({ endpoint, rest } = takeEndpoint(args.slice(1)));
    } catch (e) {
      stderr((e as Error).message + "\n");
      return 2;
    }
    // --no-verify rides on `set` only, and it must not be mistaken for the
    // provider name (`ans auth set --no-verify tavily` is legal).
    const skipVerify = rest.includes("--no-verify");
    const provider = rest.find((arg) => arg !== "--no-verify");
    if (!provider) return usage();
    const info = credentialProvider(provider);
    if (!info) return rejectUnknownProvider(provider);
    if (endpoint !== null && info.kind !== "model") {
      stderr(
        provider + " is a search provider; --endpoint only applies to model providers " +
        "(the anysearch arm takes its endpoint from ANYSEARCH_ENDPOINT).\n",
      );
      return 2;
    }

    // Refuse before the prompt. A broken file used to be discovered only after
    // the key was typed and checked online, so a rejected key was blamed for a
    // fault that belonged to the file (#537).
    const broken = readUserCredentials({ home });
    if (broken.error) {
      stderr(broken.error + "\n");
      stderr("Nothing was typed and nothing was written. `ans auth repair` keeps the keys it can read.\n");
      return 1;
    }

    const target = endpoint !== null
      ? displayEndpoint(endpoint)
      : (info.kind === "model" ? "the provider's default endpoint" : "the provider's fixed endpoint");
    stderr("Storing the " + provider + " key in " + userCredentialsPath(home) + " for " + target + ".\n" +
      "The file is PLAIN TEXT (not encrypted, not a system keychain); it is locked to your account.\n",
    );
    let raw: string;
    try {
      raw = await readSecret(info.envKey + " (typing is hidden, Enter to save): ", {
        ...(AUTH_IO.input ? { input: AUTH_IO.input } : {}),
        ...(AUTH_IO.output ? { output: AUTH_IO.output } : {}),
      });
    } catch (e) {
      if (e instanceof SecretInputCancelled) {
        stderr("cancelled; nothing was written\n");
        return 1;
      }
      stderr((e as Error).message + "\n");
      return 1;
    }
    let apiKey: string;
    try {
      apiKey = cleanSecret(raw);
    } catch (e) {
      stderr((e as Error).message + "\n");
      return 2;
    }
    if (info.kind === "search" && !skipVerify) {
      if (!isProbeProviderId(info.id)) {
        // No probe for this provider: report the missed check only; the write
        // below reports storage.
        stderr("[warn] no free-surface probe for " + info.id + " yet; this key is not checked.\n");
      } else {
        const accepted = await verifySearchKey(info.id, apiKey, env);
        if (!accepted) return 1;
      }
    }
    try {
      const path = writeUserCredential({ provider: info.id, endpoint, apiKey }, { home });
      // Not the value, not a prefix of it: only what was stored and where.
      stdout("Stored the " + info.id + " key for " + target + " in " + path + ".");
      stdout("An explicit env value (" + info.envKey + " / ANS_LLM_API_KEY) still wins over it.");
      if (info.kind === "model") {
        stdout("Next: ans llm set " + info.id + " <model>   (the key alone does not choose a model)");
      }
      return 0;
    } catch (e) {
      stderr((e as Error).message + "\n");
      return 1;
    }
  }

  if (sub === "remove") {
    let endpoint: string | null;
    let rest: string[];
    try {
      ({ endpoint, rest } = takeEndpoint(args.slice(1)));
    } catch (e) {
      stderr((e as Error).message + "\n");
      return 2;
    }
    const provider = rest[0];
    if (!provider) return usage();
    if (!credentialProvider(provider)) return rejectUnknownProvider(provider);
    const broken = readUserCredentials({ home });
    if (broken.error) {
      stderr(broken.error + "\n");
      stderr("Nothing was removed. `ans auth repair` keeps the keys it can read.\n");
      return 1;
    }
    try {
      const removed = removeUserCredential({ provider, endpoint }, { home });
      if (!removed) {
        stderr("Nothing stored for " + provider +
          (endpoint ? " at " + displayEndpoint(endpoint) : " at the provider default endpoint") + ".\n");
        return 1;
      }
      stdout("Removed the " + provider + " key" +
        (endpoint ? " for " + displayEndpoint(endpoint) : " for the provider default endpoint") +
        " from " + userCredentialsPath(home) + ".");
      return 0;
    } catch (e) {
      stderr((e as Error).message + "\n");
      return 1;
    }
  }

  if (sub === "repair") {
    const result = repairUserCredentials({ home });
    if (result.kind === "absent") {
      stdout("No credential file at " + userCredentialsPath(home) + "; nothing to repair.");
      return 0;
    }
    if (result.kind === "unrepairable") {
      stderr(result.error + "\n");
      stderr("Nothing was changed. Remove the file and store the keys again.\n");
      return 1;
    }
    if (result.kind === "healthy") {
      stdout("The credential file at " + result.path + " is readable; nothing to repair (" +
        result.kept + " key(s)).");
      return 0;
    }
    stdout("Repaired " + result.path + ": kept " + result.kept + " key(s), dropped " +
      result.dropped.length + ".");
    for (const reason of result.dropped) stdout("  dropped: " + reason);
    return 0;
  }

  stderr("Unknown subcommand: " + sub + "\n");
  return usage();
}

// Exported for the tests: they assert the display never reveals a key.
export const AUTH_INTERNALS = { statusLines };
