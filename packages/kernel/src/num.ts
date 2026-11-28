// A positive whole number. Shared by the request deadline, the archive row id and
// the lock holder's pid, so one rule serves all three. Shape only: a value used
// as a timer budget still needs the setTimeout ceiling check (engine.ts owns
// MAX_REQUEST_TIMEOUT_MS).
export function isPositiveWholeInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}
