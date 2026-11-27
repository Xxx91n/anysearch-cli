// A leaf module on purpose: the zero-dependency kernel schemas import this
// subpath, so it must not pull in better-sqlite3 through the package barrel.

/** Hard ceiling for one expand read, in code points. */
export const EXPAND_MAX_CHARS = 8000;
