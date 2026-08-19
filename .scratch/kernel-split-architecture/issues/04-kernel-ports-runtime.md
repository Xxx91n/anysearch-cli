# 04: Kernel ports + Agent Runtime adapter (candidate 4, seam 3)


Status: Completed — implemented. Covered by ADR-0004, ADR-0007 (ports.ts + pi-runtime.ts).
Implement:
- packages/kernel/src/ports.ts: RetrieverPort + SessionStorePort interfaces
- packages/kernel/src/runtime.ts: AgentRuntime adapter over pi-agent-core
- Domain-aware tool filtering from Active Domain config

Reference: atomcode-kernel-split-architecture research (seam 3).
Kernel only imports ports; CLI composition root injects implementations.