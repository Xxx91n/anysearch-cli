// The domain both hosts use when no domain TOML loaded. It has no URL
// allow/deny list, so fetch relies on the session ticket, public-address gate,
// domain deny/allow gate (deny still applies with an empty allowlist) and
// credential gate. The tool appears only when the host wired page-read
// providers, a page-writing store, and no host tool is named "fetch".
import type { DomainConfigPort } from "./ports";

export function fallbackAgentDomain(): DomainConfigPort {
  return {
    sources: { enabled: [] },
    prompts: [],
    // skills.active is inert without toolRequires; the whitelist is what gates
    // tools here.
    skills: { active: ["search"] },
    hooks: { toolWhitelist: ["search", "fetch"] },
    rag: { adapter: "none" },
  };
}
