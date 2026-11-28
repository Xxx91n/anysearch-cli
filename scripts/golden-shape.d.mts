// Types for scripts/golden-shape.mjs. The declarations here mirror its exports
// one for one. The parity test pins the names and kinds it can see from the .mjs;
// this file is only checked when tsc follows an import to it, so an export added
// or reshaped there has to be carried over by hand.
export declare const GOLDEN_FILE: string;
export declare const GOLDEN_SCHEMA: string;
export declare const GOLDEN_COVERAGE_SCHEMA: string;
export declare const GOLDEN_SCOPE_VALUES: readonly string[];
export declare const GOLDEN_STABILITY_CLASSES: readonly string[];
export declare const GOLDEN_TOLERATED_SEGMENTS: readonly string[];
export declare const GOLDEN_DIMENSION_VALUES: Record<string, readonly string[]>;
export declare function goldenShapeProblems(doc: unknown): string[];
export declare function isLiveScope(scope: unknown): boolean;
