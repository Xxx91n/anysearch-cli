// Types for scripts/golden-shape.mjs. The seven declarations mirror its exports
// one for one: add or drop an export there and this file has to follow (the
// values are pinned by the parity test, the export list is not).
export declare const GOLDEN_FILE: string;
export declare const GOLDEN_SCHEMA: string;
export declare const GOLDEN_SCOPE_VALUES: readonly string[];
export declare const GOLDEN_STABILITY_CLASSES: readonly string[];
export declare const GOLDEN_TOLERATED_SEGMENTS: readonly string[];
export declare const GOLDEN_DIMENSION_VALUES: Record<string, readonly string[]>;
export declare function goldenShapeProblems(doc: unknown): string[];
