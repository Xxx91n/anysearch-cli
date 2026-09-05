# ADR-0047: Architecture Grill Round 44 — Emergency Ship Override Lifecycle

Status: Accepted.

ADR-0046 D6 named the emergency ship override policy but left it as declaration-only constants. This round closes the governance design: override is a rare, event-anchored bypass that consumes one quota per baseline generation, forces a rebaseline, and creates a hard postmortem obligation that only an explicit, quota-consuming late acknowledgement can defer.

## Decisions

- The decision core is a pure function; the ship-gate layer only assembles facts and persists events.
- `release window` is a baseline generation. `overrideEpoch` is the post-rebaseline `datasetFingerprint:holdoutFingerprint` pair, so fingerprint changes reset the one-per-epoch quota.
- Override state lives in an independent append-only ledger, not in the frequently rewritten skip/gain ledger.
- Postmortem is event-anchored with a deadline of `min(overrideAt + 7 days, windowEndContaining(overrideAt))`; the artifact is schema-validated and hash-referenced, never embedded in the ledger.
- `--acknowledge-late` is allowed once per epoch, consumes the same override quota, and never waives the outstanding postmortem.
- No release-window configuration framework is introduced until a second real window-kind consumer appears.

## Consequences

- Ship-gate must move from token-presence assertions to actual override validation and ledger writes.
- A late obligation blocks the next override until the postmortem is complete or explicitly acknowledged.
- Calendar time, git tags, and package versions are observational fields only; they never participate in quota decisions.
