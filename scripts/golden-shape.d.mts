// Types for the plain-node corpus checks so TypeScript callers (the parity test
// in packages/store) can import the module and compare values instead of
// reading the source text.
export declare const GOLDEN_FILE: string;
export declare const GOLDEN_SCHEMA: string;
export declare const GOLDEN_SCOPE_VALUES: readonly string[];
export declare const GOLDEN_STABILITY_CLASSES: readonly string[];
export declare const GOLDEN_TOLERATED_SEGMENTS: readonly string[];
export declare const GOLDEN_DIMENSION_VALUES: Record<string, readonly string[]>;
export declare function goldenShapeProblems(doc: unknown): string[];
