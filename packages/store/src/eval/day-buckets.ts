// ADR-0039 D4: Pre-Registered Day Buckets — locked once, definition hash joins the
// baseline fingerprint (change = fingerprint flip + forced recalibration). Buckets are
// aligned with the 7/30/90 tau tiers and are model-independent by construction.
import { createHash } from "node:crypto";

export interface DayBucket {
  id: string;
  // Half-open interval on the NEXT bucket's min (matches the C1 boundary table):
  // 1->0-1, 2->2-7, 7->2-7, 8->8-30, 30->8-30, 31->31-90, 90->31-90, 91->91+.
  min: number;
}

// Pinned order is semantics (0-1 / 2-7 / 8-30 / 31-90 / 91+). Never reorder or reselect
// without a fingerprint flip (ADR-0039 D4 / _Avoid_ 3).
export const AGE_BUCKETS: readonly DayBucket[] = [
  { id: "0-1", min: 0 },
  { id: "2-7", min: 2 },
  { id: "8-30", min: 8 },
  { id: "31-90", min: 31 },
  { id: "91+", min: 91 },
];

// bucketForAge: age -> bucket id. Ages are float days; age < 0 (clock skew) clamps into 0-1;
// non-finite ages also clamp (an event with an unreadable timestamp is still an event).
export function bucketForAge(ageDays: number): string {
  if (!Number.isFinite(ageDays)) return AGE_BUCKETS[0]!.id;
  let id = AGE_BUCKETS[0]!.id;
  for (const b of AGE_BUCKETS) if (ageDays >= b.min) id = b.id;
  return id;
}

export function bucketHistogram(ages: Iterable<number>): Record<string, number> {
  const hist: Record<string, number> = {};
  for (const b of AGE_BUCKETS) hist[b.id] = 0;
  for (const a of ages) hist[bucketForAge(a)]++;
  return hist;
}

// Definition hash of the bucket table (16-hex, same convention as the dataset fingerprint).
// Pinned in test/day-buckets.test.ts — any change flips the eval baseline fingerprint.
export function dayBucketFingerprint(): string {
  return createHash("sha256").update(JSON.stringify(AGE_BUCKETS)).digest("hex").slice(0, 16);
}
