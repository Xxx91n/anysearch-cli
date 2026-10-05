// scripts/vocab-registry.mjs
// ADR-0100 D2 (R99): the per-module vocabulary registry - a PURE DATA LEAF.
//
// Zero imports, fully frozen. Each governed module contributes a group object
// whose KEYS are the semantic vocabulary names (as declared in
// docs/agents/handoff-template.md) and whose VALUES are that module's exported
// `*_CODES` constant NAMES. Registration is BY NAME so the registry never
// imports a governed module: the dependency is single-direction (governed
// modules never import the registry; the judgment core stays zero-import).
//
// Extending the registry is the closed channel: a new `*_CODES` vocabulary must
// be registered here (and the anchor table re-derived) or the scan reddens.
// That friction is the design intent (ADR-0099 Known-Risk 1 mitigation), not a
// usability defect.

export const CODE_GROUPS = Object.freeze({
  verdict: Object.freeze({
    runUrlRed: "RUN_URL_RED_CODES",
    stackRed: "STACK_RED_CODES",
    stackStructuralRed: "STACK_STRUCTURAL_RED_CODES",
    stackEnv: "STACK_ENV_CODES",
    stackAdvisory: "STACK_ADVISORY_CODES",
    verificationUnavailable: "VERIFICATION_UNAVAILABLE_CODES",
    pendingReason: "PENDING_REASON_CODES",
    stateRed: "STATE_RED_CODES",
    statePending: "STATE_PENDING_CODES",
    clearingRed: "CLEARING_RED_CODES",
    clearingEnv: "CLEARING_ENV_CODES",
  }),
  anchors: Object.freeze({
    anchorRed: "ANCHOR_RED_CODES",
    anchorSkip: "ANCHOR_SKIP_CODES",
  }),
  evalIntegrity: Object.freeze({
    shipOverrideReason: "SHIP_OVERRIDE_REASON_CODES",
  }),
});

// The explicit module-stem -> registry-group mapping (data, not convention):
// the thin shell resolves a globbed `scripts/<stem>.mjs` to its group. A module
// absent here is STILL scanned; any `*_CODES` export it carries is unregistered
// and reddens. This is deliberately NOT a closed module list - the scan surface
// is the glob, never this map.
export const GOVERNED_MODULES = Object.freeze({
  "handoff-lint-verdict": "verdict",
  "enforcement-anchors": "anchors",
  "eval-integrity-contract": "evalIntegrity",
});
