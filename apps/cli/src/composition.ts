// ADR-0008 D7: createEngine() lifted to packages/kernel.
// This file is now a thin re-export for backward compatibility.
// Both apps/cli and apps/mcp should import from @anysearch/kernel directly.

export { createEngine, type CompositionResult } from "@anysearch/kernel";
