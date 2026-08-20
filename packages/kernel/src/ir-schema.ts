// IR Summary Schema: shared constants for L0 rolling summary 5-section format.
// ADR-0012 D5: versioned IR 5-segment contract.
// ADR-0015 D4: extracted from pi-runtime.ts inline constants.

export const IR_SUMMARY_SECTIONS = [
  "Verified Evidence",
  "Open Hypotheses",
  "Rejected Sources",
  "Key Numbers & Sources",
  "Tool Calls & Read Status",
] as const;

export const IR_CUSTOM_INSTRUCTIONS = [
  "Format the summary as exactly these 5 sections:",
  "1. Verified Evidence: facts confirmed by search results (append-only across compressions)",
  "2. Open Hypotheses: claims not yet verified (append-only)",
  "3. Rejected Sources: sources checked and dismissed (append-only)",
  "4. Key Numbers & Sources: important figures with source URLs",
  "5. Tool Calls & Read Status: which tools were called and what was read",
  "Sections 1-3 are append-only: preserve all existing entries, only add new ones.",
].join("\n");

export const IR_ADJUDICATION_SECTIONS = [
  "Verified Evidence",
  "Open Hypotheses",
  "Rejected Sources",
  "Key Numbers & Sources",
  "Tool Calls & Read Status",
] as const;