// The domain both hosts use when no domain TOML loaded. Each call gets a fresh
// object, so one caller cannot mutate another's fallback. It also carries no
// url allow/deny list: a retrieved URL is not allowlisted, so the trust
// boundary blocks it (interactive can approve; MCP cannot). fetch must still
// consult urlPolicy when it lands.
import type { DomainConfigPort } from "./ports";

export function fallbackAgentDomain(): DomainConfigPort {
  return {
    sources: { enabled: [] },
    prompts: [],
    // skills.active is inert without toolRequires; the whitelist is what gates
    // tools here.
    skills: { active: ["search"] },
    // fetch is not registered yet; this whitelist entry is a placeholder.
    hooks: { toolWhitelist: ["search", "fetch"] },
    rag: { adapter: "none" },
  };
}
