# 05: CLI composition root (seam 5)

Implement:
- apps/cli/src/commands/*.ts: replace stubs with real implementations
- Composition root: inject provider registry + store into kernel
- ans doctor: first real command (provider smoke test + config check)
- agent-info output + semantic exit codes 0-4 (paperfoot pattern)

Reference: atomcode-kernel-split-architecture research (seam 5).
CLI/MCP only: parse -> assemble -> render.