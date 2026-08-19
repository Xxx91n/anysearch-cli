# 01: Domain Schema module (candidate 1)


Status: Completed — implemented. Covered by ADR-0001, ADR-0005 (domain-schema.ts).
Implement packages/store/src/domain-schema.ts:
- Typed DomainSchema interface (settings/prompts/skills/sources/rag/hooks)
- resolve(): base+override deep-merge (settings deep-merged, lists replaced)
- validate(): type-check at load
- TOML parser as thin adapter behind this interface

Reference: cc-persona TOML research (atomcode-cc-persona-toml).
Confidence: high (source-level evidence from persona.rs + use_cmd.rs).