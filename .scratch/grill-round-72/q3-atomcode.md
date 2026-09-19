# atomcode 调研存档：R72 票序结构 A/B/C/D（R72 Q3）

> exec 后台运行 stdout 原文

I'll do a quick external grounding pass on dsh/Cordis facts (since the decision is mostly internal architecture, this is a `quick`-grade research leg), then deliver the sequencing analysis.Let me verify key dsh facts from primary sources before writing the verdict.**Sufficiency gate:** searches: 4 (angles: Official, Comparative, Currency, Criticism) | full reads: 2 (official dsh CLI reference README — GitHub; Habr architecture deep-dive) | domains: 2 primary + 10 search-result domains | gaps: dsh 0.1.5-rc.2 exact API of `agent.inject()` / waterfall serialization not independently documented anywhere — which is precisely why T0 exists.

Verdict up front: **A is the mature choice. B, C, D each fail a different named principle.** External grounding (dsh's own CLI reference confirms layered patch composition, `--dump-config` without boot, a headless profile with startup-only patches, and in-box `@deepseek-ai/dsh-mcp-client` bundling; the Habr architecture writeup confirms the durable-session-event vs live-agent-event split and the `tools/pre-execute → policy → execute` pipeline) supports every load-bearing assumption in A's ticket shapes.

---

## 1. Option comparison

| Option | What it gets right | Where it fails | Verdict |
|---|---|---|---|
| **A** — 4 serial tickets (spike → dual artifacts → host verify → closeout) | Spike-gated delivery; contract-discovery before implementation; dual-artifact T1 keeps product and its documented Phase-1 fallback in one diff so no red-spike orphan | T1's "first-red-then-green" is slightly off-shape for spike-gated work (see correction 2); web smoke leg under-specified | **Recommended** |
| **B** — merge spike + package skeleton | Saves one ticket | Mixes evidence and product in one diff — you can't revert the skeleton without losing the spike evidence, and a red spike leaves a dead skeleton commit. Violates your own ADR-0029 scope discipline (one themed topic; found/fixed/deferred triplet gets polluted) | Reject |
| **C** — split baseline-doc from bundle | Conceptually cleaner | A single config row + a few doc paragraphs does not merit a ticket; ticket overhead > artifact. Splitting also risks doc-then-code drift when the spike reshapes the row | Reject |
| **D** — headless-only verification | Cheapest matrix | Web is the integration's value thesis (live patch reload via HMR, multi-turn amortization of injected memory). Dropping it means the headline claim ships unverified. Also **D contradicts your own established vocabulary**: every one of the 5 prior host surfaces got a verified row; surface 6 with a weaker matrix than surfaces 1–5 is a regression in verification honesty, not a saving | Reject — A's "headless full matrix + one labeled web smoke leg" is the correct compromise |

---

## 2. The mental models, applied

**Spike-gated delivery** — correct, and unusually well-motivated here. dsh is a *developer preview that explicitly warns of compatibility-breaking changes* (confirmed in the repo's own positioning, echoed in the Habr writeup). For a preview dependency, the risk isn't "will the API change" but "does the API exist yet as documented." T0's 8 risk items are the right list; item 8 (bundle patch configuring **another plugin's row**) is the single highest-leverage probe because the whole D-002 one-step-install packaging claim hangs on it — worth flagging as the spike's *blocking* item vs. informational items.

**Contract-discovery before contract-implementation** — A orders this correctly. One refinement the external evidence sharpens: dsh's layered patch semantics are "later layer wins per row; a patch **replaces the complete config value rather than deep-merging**." That means T1's patch file must be written as a whole-row replacement of the mcp-client row, and T0 must probe whether replacing that row wholesale preserves dsh's own defaults or clobbers them. Add that as spike item 9 or fold into item 8 — it's a real failure mode that only surfaces at `--dump-config` time.

**Probe-matrix porting across host-model boundaries** — classify P1–P9 into three buckets; A should make this classification explicit in the T2 ticket so the reshaping is auditable:
- **Host-invariant (transport through our MCP server, unchanged):** 5 tools visible+callable; fail-open with server down; with-vs-without contrast.
- **Host-variable (same claim, new mechanism):** inject delivery (subprocess stdout envelope → `agent.inject()` into the session stream), preheat marker (PreToolUse hook → `tools/pre-execute` listener), URL deny (hook deny exit-code → event-waterfall rejection), distill/index (PostToolUse → `tools/post-execute`/`tools/result`), startup-latency tax (now also measures Cordis mount cost).
- **Host-new (no prior probe covers it):** plugin install/uninstall idempotency, patch-layer composition correctness, HMR reload behavior. These have no analog in the subprocess model — this is the bucket A's current T2 text under-specifies (see missing items below).

**Reduced-matrix labeling honesty** — A's "one web smoke leg explicitly labeled, rest untested" is right, but tighten the label: the web leg must state *which* probes it covers (at minimum: inject delivery transcript-verified + preheat marker, since those are the two whose value thesis is web-specific), not just "one smoke leg." An unlabeled-smoke leg that only checks "tools visible" verifies nothing web-specific.

**Verification-surface minimum for a developer-preview dependency** — this argues *for more*, not less: preview deps break silently. That's the strongest argument against D, and also the argument for pinning + a recorded upgrade-diff drill (below).

**Is the web smoke in-round or deferred?** In-round, deferring is wrong for two reasons: (a) the verified-hosts table would carry row 6 with the integration's *primary value claim* untested — a known-honest-but-hollow row; (b) the web profile exercises HMR/live patch reload, which is a *mechanism* T0/T1 assumptions depend on, so deferring it defers discovering a packaging flaw to a later round. One labeled leg is the right size; a full web matrix would be over-verification for a preview round.

---

## 3. What's missing from the ticket shapes (corrections/additions)

1. **T0 addition — patch whole-row-replacement semantics probe** (item 9 above): does our bundle patch replacing the mcp-client row clobber dsh's defaults for that row? Verified via `--dump-config` before/after. This is cheap and protects D-002's core claim.
2. **T1 correction — "first-red-then-green" reframe.** For the *Cordis bundle code*, red→green unit tests are fine. For the *integration as a whole*, T1 cannot be green against the real host — that's T2's job. State T1's exit criterion as "units green against mocked ctx event mounts + Phase-1 config row written + (if spike red) fallback artifacts + limitation recorded," not "green." Otherwise T1's green claim overreaches.
3. **T2 additions — the host-new bucket:**
   - **Install/uninstall/reinstall idempotency probe:** `dsh plugin add` tarball → verify row present → remove → verify row absent → re-add. Patch-layer composition is order-sensitive (later wins, replace-not-merge), so a half-removed plugin is a real corruption mode absent from the subprocess-hook world.
   - **Upgrade-diff drill (recorded, not necessarily executed):** a documented procedure + a version-pin record (exact `0.1.5-rc.2` in verified-hosts row 6, ADR, and the package's peer/devDep range) so the next rc bump has a checklist. Given dsh's explicit breakage warning, "pinned version" in row 6 is necessary but insufficient without a pinned *re-verify procedure*.
   - **Doctor/install-smoke leg:** a one-command check (analogous to your existing per-host doctor) that reports "dsh found, version X, anysearch row mounted, MCP server reachable" — fail-open per your AGENTS.md contract.
4. **T2 — churn-containment check:** D-002 makes cordis/dsh types devDep-only as a churn alarm; T2 should *exercise* the alarm — e.g., a CI grep/lint step that fails if any `@deepseek-ai/*` import leaks into runtime (non-devDep) code paths of the new package. Without this the "alarm" is a comment, not a control.
5. **T2 — patch-HMR probe (web leg):** since dsh's reference explicitly documents HMR-vs-startup-only per profile, the web smoke leg should verify a live patch reload (or explicitly record that our row is startup-only), because "which reload model applies to our row" is an open fact, not a decision.
6. **T0 output shape:** require per-item PASS/FAIL/**RESHAPE with the reshaped mechanism named** — RESHAPE items must feed forward into T1's ticket text before T1 starts, not just into the report. A PASS/FAIL report that T1 doesn't consume is ceremony.
7. **T3 — limitation-record location:** if the spike reds, the Phase-1-only fallback must produce not just a limitation note but a *named re-entry ticket* (what would change our mind to attempt Phase-2), so the deferral is actionable at the next dsh release.

---

## 4. Final recommended structure

**A, with corrections 1–7 folded in.** Ticket sequence stays serial (T0 gates T1; T1's artifacts gate T2; T2's evidence feeds T3). The one place I'd alter A's text: T2's probe list gains the host-new bucket (idempotency, upgrade-diff record, doctor leg, churn alarm) and its web leg gains a named probe subset + HMR reload check. C's instinct (don't multiply tickets for one config row) is absorbed into A's T1 dual-artifact shape; B and D are rejected on diff-hygiene and verification-honesty grounds respectively.

**External grounding for the load-bearing claims:** dsh CLI behavior reference (patch layering, replace-not-merge row semantics, `--dump-config` without boot, headless profile, in-box dsh-mcp-client) — github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md; architecture deep-dive (durable session events vs live agent events, tools/pre-execute pipeline, plugin lifecycle) — habr.com/en/articles/1070958/. Cross-engine support from anysearch batch + GitHub/official-site result snippets; single-source items (exact rc.2 `agent.inject()` semantics) are exactly T0's territory, which is the correct disposition.
