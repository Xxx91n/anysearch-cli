// r116 ambient declaration for the eval-integrity-contract helper that ship-gate consumes.
// The runtime contract is a tiny mjs; the TS side just needs to know the signature so
// any TS import of it is typed rather than implicit-any.
declare module "../../../scripts/eval-integrity-contract.mjs" {
  export function evalIntegrityCheck(report: unknown): { ok: boolean; detail: string };
}
