# Changelog

All notable changes to this project are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow
[SemVer](https://semver.org/).

## [0.1.0-rc.0] — 2026-08-22

### Added
- ADR-0020 ship-gate pipeline: `scripts/ship-gate.mjs` (Node stdlib, single file)
  as the blocking Product Smoke Gate, plus a non-blocking
  `modelcontextprotocol/conformance` workflow as the Protocol Heartbeat.

### Removed
- ADR-0029 D6: dropped `--write-baseline` from `packages/store eval` (the one-round alias for `--calibrate`).

### Infrastructure
- 16 prior ADRs landed across rounds 1–17 (MCP Phase2, Kernel Engine
  composition, dual-era SDK v1+v2 bridge, TypeBox source-of-truth, plugin
  hooks layer, SessionStart routing, L0/L1 memory pipeline).

[0.1.0-rc.0]: https://github.com/anysearch/anysearch-cli/releases/tag/v0.1.0-rc.0
