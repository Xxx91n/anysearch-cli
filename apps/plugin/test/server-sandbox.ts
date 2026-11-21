// #351: every test that starts the real service builds its environment here.
//
// Design: one helper builds the service's whole environment for tests, and one
// helper starts it — a test that redirects only the project index and the
// published address still records its process row in the operator's own
// ~/.ans/anysearch.db, and the hard kill at the end leaves that row open
// forever. Rejected: each spawn site building its own env, which is how the leak
// survived in one site and could come back in the next one.
//
// Every ANS_* the runner carries is dropped first, so an operator's own override
// cannot point one of those paths back at the real user root.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The plugin package root: the service is started from here as `src/server/index.ts`. */
export const PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url));

export interface ServerSandbox {
  /** Environment for the spawned service: every path it writes lives under `home`. */
  env: NodeJS.ProcessEnv;
  /** The durable database this instance records itself in. */
  durableDb: string;
}

/**
 * The service's whole environment for one test.
 *
 * `home` is that test's temp dir: the durable database (`home/anysearch.db`),
 * the project index (`home/project-index.db`) and the published address
 * (`home/server.json`) all land inside it. The rest of the runner's environment
 * is kept as it is; only every `ANS_*` is dropped first, so an operator's own
 * override cannot win and point one of those paths back at the real user root.
 */
export function serverSandbox(home: string, port: number, token: string): ServerSandbox {
  const durableDb = join(home, "anysearch.db");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^ANS_/.test(key)));
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    ANS_DB_PATH: durableDb,
    ANS_PROJECT_DB: join(home, "project-index.db"),
    ANS_SERVER_REGISTRY: join(home, "server.json"),
    ANS_SERVER_PORT: String(port),
    ANS_SERVER_TOKEN: token,
  });
  return { env, durableDb };
}

/** Start the real service in an environment `serverSandbox` built. */
export function spawnServer(env: NodeJS.ProcessEnv): ReturnType<typeof spawn> {
  return spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
    cwd: PLUGIN_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    env,
  });
}
