// The domain both hosts use when no domain TOML loaded. Its URL allow/deny
// lists are empty, so fetch relies on the session ticket, public-address gate
// and credential gate. `fetch` in toolWhitelist is only a cap; the registration
// conditions live in pi-runtime's fetchRegistration().
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
