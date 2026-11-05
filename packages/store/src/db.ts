// Tracked better-sqlite3 opener — the store's single door for native handles.
//
// Every handle the store opens (session store, observation store, eval
// runner/switch readers, the in-memory domain-recommend FTS index) goes through
// openDatabase() so an exit path can close it explicitly instead of letting
// libuv/native static destruction reap a live handle at process exit — the
// macOS F-16 `libc++abi ... mutex lock failed` abort family (#183).
//
// The registry entry is self-disposing: close() (ours, or the registry's at
// exit) removes it, so a long-lived process that opens and closes engines per
// connection (MCP) keeps no references to dead handles.
import Database from "better-sqlite3";
import { registerTeardown } from "./teardown";

export function openDatabase(dbPath: string, options?: Database.Options): Database.Database {
  return trackDatabase(new Database(dbPath, options));
}

// Registers an already-constructed handle. close() becomes idempotent for the
// handle's whole lifetime: a second close is a no-op instead of a native
// double-close (better-sqlite3 throws "The database connection is not open"),
// and closing early unregisters the exit hook.
export function trackDatabase(db: Database.Database): Database.Database {
  const close = db.close.bind(db);
  let live = true;
  // Defensive: a handle that some path closed through the prototype method
  // (bypassing the wrapper) reports open === false — never double-close it.
  const stillOpen = (): boolean => (db as { open?: boolean }).open !== false;
  const unregister = registerTeardown(() => {
    if (!live) return;
    live = false;
    if (stillOpen()) close();
  });
  try {
    // defineProperty (not assignment): the @types signature is `close(): this`,
    // so a wrapper typed `() => void` would not type-check, and the handle stays
    // chainable (`db.close()` still returns the instance).
    Object.defineProperty(db, "close", {
      configurable: true,
      writable: true,
      value: (): Database.Database => {
        if (!live) return db;
        live = false;
        unregister();
        if (stillOpen()) close();
        return db;
      },
    });
  } catch {
    // Non-extensible handle (not expected for better-sqlite3): the registered
    // entry still closes it at exit; an owner that closes it first leaves the
    // entry behind, whose close then throws inside runTeardown and is swallowed.
  }
  return db;
}
