// r116 ambient declaration for the eval-integrity-contract helper that ship-gate consumes.
// The runtime contract is a tiny mjs; the TS side just needs to know the signature so
// the r116 audit fixes test can import it without implicit-any.
declare module "../../../scripts/eval-integrity-contract.mjs" {
  export function evalIntegrityCheck(report: unknown): { ok: boolean; detail: string };
}
