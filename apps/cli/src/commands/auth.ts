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
// to, plus the last four characters so a user can tell two keys apart.

import {
  CREDENTIAL_PROVIDERS,
  credentialProvider,
  normalizeBindingEndpoint,
  readUserCredentials,
  removeUserCredential,
  resolveConfigHome,
  resolveLlmConfig,
  resolveSearchCredentials,
  userCredentialsPath,
  writeUserCredential,
} from "@anysearch-cli/store";
import { cleanSecret, readSecret, SecretInputCancelled, type SecretInputIO } from "../secret-input";

/**
 * Test seam: lets a test supply the stdin stream a scripted run would give
 * (`printf '%s' "$KEY" | ans auth set openai`) without swapping the real
 * process.stdin. Production leaves it unset and gets the terminal.
 */
export const AUTH_IO: { input?: SecretInputIO["input"] } = {};

/** Show whether an entry exists, bound where — and it must never show the value. */
function describeBinding(binding: { provider: string; endpoint: string | null }): string {
  return binding.provider + "  " + (binding.endpoint ?? "(provider default endpoint)");
}

function usage(): number {
  process.stderr.write("ans auth - provider API keys\n");
  process.stderr.write("\n");
  process.stderr.write("  ans auth                     Show where each provider's key comes from\n");
  process.stderr.write("  ans auth list                Same, plus the stored entries and where the file is\n");
  process.stderr.write("  ans auth set <provider>      Store a key in the user credential file (typed, never echoed)\n");
  process.stderr.write("      [--endpoint <url>]       Model providers only: bind the key to one endpoint\n");
  process.stderr.write("  ans auth remove <provider>   Remove one stored key [--endpoint <url>]\n");
  process.stderr.write("\n");
  process.stderr.write("Providers: " + CREDENTIAL_PROVIDERS.map((p) => p.id).join(", ") + "\n");
  process.stderr.write("The store is plain text, owner-only, and shared by the CLI and GUI entries of this account.\n");
  process.stderr.write("An explicit env value (e.g. ANS_LLM_API_KEY) always wins over it.\n");
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
      if (value === undefined) throw new Error("--endpoint requires a URL");
      endpoint = normalizeBindingEndpoint(value);
      continue;
    }
    rest.push(a);
  }
  return { endpoint, rest };
}

function statusLines(env: NodeJS.ProcessEnv = process.env): string[] {
  const search = resolveSearchCredentials(env);
  const llm = resolveLlmConfig({ env });
  // Same config root the resolver uses, so the report describes the file that is
  // actually in force (and a test's temp home is honoured).
  const stored = readUserCredentials({ home: resolveConfigHome(undefined, env) });
  const lines: string[] = [];

  for (const info of CREDENTIAL_PROVIDERS) {
    const envValue = env[info.envKey]?.trim();
    const binding = stored.bindings.find((b) => b.provider === info.id);
    let where: string;
    if (info.kind === "model" && info.id === llm.provider && llm.apiKey) {
      // Report where the EFFECTIVE model key came from. `env` covers two
      // different variables, so name the one that is actually set: a
      // cross-config override (ANS_LLM_API_KEY) is a different fact from "this
      // provider's own variable is exported".
      where = llm.sources.apiKey === "env"
        ? (env.ANS_LLM_API_KEY?.trim() ? "env ANS_LLM_API_KEY" : "env " + info.envKey)
        : llm.sources.apiKey === "credentials" ? "stored file"
          : llm.sources.apiKey === "user" ? "env via [llm].env_key"
            : "set";
    } else if (envValue) {
      where = "env " + info.envKey;
    } else if (binding) {
      where = "stored file" + (binding.endpoint ? " (" + binding.endpoint + ")" : "");
    } else {
      where = "not set";
    }
    const mark = where === "not set" ? "[EMPTY]" : "[SET]  ";
    lines.push(mark + " " + info.id.padEnd(10) + " " + where);
  }
  if (search.warnings.length > 0) lines.push(...search.warnings.map((w) => "[WARN] " + w));
  return lines;
}

/** One shared rejection so `set` and `remove` cannot drift apart. */
function rejectUnknownProvider(provider: string): number {
  process.stderr.write("Unknown provider: " + provider + "\n");
  process.stderr.write("Available: " + CREDENTIAL_PROVIDERS.map((p) => p.id).join(", ") + "\n");
  return 2;
}

export async function runAuth(args: string[]): Promise<number> {
  const sub = args[0];

  if (sub === undefined || sub === "status" || sub === "list") {
    console.log("ans auth - provider API keys");
    console.log("---");
    for (const line of statusLines()) console.log(line);
    console.log("---");
    if (sub === "list") {
      const path = userCredentialsPath();
      const file = readUserCredentials();
      console.log("Credential file: " + path);
      console.log("  " + (file.error ? "BROKEN — " + file.error : "plain text, not encrypted, owner-only"));
      if (file.bindings.length > 0) {
        for (const binding of file.bindings) {
          console.log("  " + describeBinding(binding));
        }
      } else if (!file.error) {
        console.log("  (no stored keys)");
      }
    }
    console.log("Store a key: ans auth set <provider>   (typed, never echoed)");
    console.log("Env still wins: ANS_LLM_API_KEY, or the provider's own *_API_KEY variable");
    return 0;
  }

  if (sub === "set") {
    let endpoint: string | null;
    let rest: string[];
    try {
      ({ endpoint, rest } = takeEndpoint(args.slice(1)));
    } catch (e) {
      process.stderr.write((e as Error).message + "\n");
      return 2;
    }
    const provider = rest[0];
    if (!provider) return usage();
    const info = credentialProvider(provider);
    if (!info) return rejectUnknownProvider(provider);
    if (endpoint !== null && info.kind !== "model") {
      process.stderr.write(
        provider + " is a search provider; --endpoint only applies to model providers " +
        "(the anysearch arm takes its endpoint from ANYSEARCH_ENDPOINT).\n",
      );
      return 2;
    }

    const target = endpoint ?? (info.kind === "model" ? "the provider's default endpoint" : "the provider's fixed endpoint");
    process.stderr.write(
      "Storing the " + provider + " key in " + userCredentialsPath() + " for " + target + ".\n" +
      "The file is PLAIN TEXT (not encrypted, not a system keychain); it is locked to your account.\n",
    );
    let raw: string;
    try {
      raw = await readSecret(info.envKey + " (typing is hidden, Enter to save): ", AUTH_IO.input ? { input: AUTH_IO.input } : {});
    } catch (e) {
      if (e instanceof SecretInputCancelled) {
        process.stderr.write("cancelled; nothing was written\n");
        return 1;
      }
      process.stderr.write((e as Error).message + "\n");
      return 1;
    }
    let apiKey: string;
    try {
      apiKey = cleanSecret(raw);
    } catch (e) {
      process.stderr.write((e as Error).message + "\n");
      return 2;
    }
    try {
      const path = writeUserCredential({ provider: info.id, endpoint, apiKey });
      // Not the value, not a prefix of it: only what was stored and where.
      console.log("Stored the " + info.id + " key for " + target + " in " + path + ".");
      console.log("An explicit env value (" + info.envKey + " / ANS_LLM_API_KEY) still wins over it.");
      if (info.kind === "model") {
        console.log("Next: ans llm set " + info.id + " <model>   (the key alone does not choose a model)");
      }
      return 0;
    } catch (e) {
      process.stderr.write((e as Error).message + "\n");
      return 1;
    }
  }

  if (sub === "remove") {
    let endpoint: string | null;
    let rest: string[];
    try {
      ({ endpoint, rest } = takeEndpoint(args.slice(1)));
    } catch (e) {
      process.stderr.write((e as Error).message + "\n");
      return 2;
    }
    const provider = rest[0];
    if (!provider) return usage();
    if (!credentialProvider(provider)) return rejectUnknownProvider(provider);
    try {
      const removed = removeUserCredential({ provider, endpoint });
      if (!removed) {
        process.stderr.write("Nothing stored for " + provider +
          (endpoint ? " at " + endpoint : "") + ".\n");
        return 1;
      }
      console.log("Removed the " + provider + " key" + (endpoint ? " for " + endpoint : "") +
        " from " + userCredentialsPath() + ".");
      return 0;
    } catch (e) {
      process.stderr.write((e as Error).message + "\n");
      return 1;
    }
  }

  process.stderr.write("Unknown subcommand: " + sub + "\n");
  return usage();
}

// Exported for the tests: they assert the display never reveals a key.
export const AUTH_INTERNALS = { statusLines };
