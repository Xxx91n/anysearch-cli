// #351: every test that starts the real service builds its environment here.
//
// The service records its own lifetime in the DURABLE database at startup. A
// test that redirects only the project index and the published address still
// writes that process row into the operator's ~/.ans/anysearch.db, and the hard
// kill at the end of the test leaves the row open forever. One place builds the
// whole environment, so a new spawn site cannot miss a path variable.
import { spawn } from "node:child_process";
import { join } from "node:path";

/** The plugin package root: the service is started from here as `src/server/index.ts`. */
const PLUGIN_ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

export interface ServerSandbox {
  /** Environment for the spawned service: every path it writes lives under `home`. */
  env: NodeJS.ProcessEnv;
  /** The durable database this instance records itself in. */
  durableDb: string;
}

/**
 * The service's whole environment for one test, with nothing inherited.
 *
 * `home` is that test's temp dir: the durable database (`home/anysearch.db`),
 * the project index (`home/project-index.db`) and the published address
 * (`home/server.json`) all land inside it. Every `ANS_*` the runner happens to
 * carry is dropped first, so an operator's own override cannot win and point
 * one of them back at the real user root.
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
