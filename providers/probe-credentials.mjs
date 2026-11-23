// 三条手工探针共用的一份：补上 plain `node` 不认的 import 解析，再调 store 的凭据解析，
// 并提供把 key 从输出里遮掉的写法。
//
// store 的源码用 `.js` 写相对 import（指到同目录的 `.ts`），retriever 的源码不写扩展名；
// tsc 和 tsx 都认，plain node 都不认。钩子是进程级的，所以这个文件要先加载。
// Node 22.15+ 才有 module.registerHooks；仓库下限是 22.19。
//
// Design: 三条探针共享这一份钩子和一次 store import —— 复制会漂，往源码里写扩展名要给三份
// tsconfig（retriever / kernel / apps/cli）打开 allowImportingTsExtensions。

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const JS_SUFFIX = /\.([cm]?)js$/;
const TS_SUFFIX = /\.[cm]?[jt]s$/;

/** 这个 specifier 该换成哪个 `.ts` 路径；不该换的返回 undefined。 */
function tsCandidate(specifier) {
  if (JS_SUFFIX.test(specifier)) return specifier.replace(JS_SUFFIX, ".$1ts");
  if (TS_SUFFIX.test(specifier)) return undefined;
  return specifier + ".ts";
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = tsCandidate(specifier);
      if (candidate && existsSync(fileURLToPath(new URL(candidate, context.parentURL)))) {
        return nextResolve(candidate, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const { resolveSearchCredentials, SEARCH_PROVIDER_ENV_KEYS, SEARCH_PROVIDER_IDS } =
  await import("../packages/store/src/credentials.ts");

function assertProvider(provider) {
  // 名字写错就静默拿到「没 key」、探针白白跑成不带 key 的一跑（#422 就是这种静默）。
  // providers/ 不在 pnpm -r check 里，类型检查兜不住这个字面量。
  if (!SEARCH_PROVIDER_IDS.includes(provider)) {
    throw new Error("unknown search provider " + JSON.stringify(provider) + "; known: " + SEARCH_PROVIDER_IDS.join(", "));
  }
}

/**
 * 探针看到的那把 key，和它是从哪来的。
 *
 * `keySource` 只有三档：`env`（这一家的环境变量）、`user`（用户凭据文件
 * `~/.ans/credentials.json`）、`none`（这一跑没发 key：两处都没有，或者传了
 * `anonymous`/`--nokey`）。它说的是这一跑用的是哪把，不是这台机器配了什么。
 */
export function resolveProbeCredentials(provider, { anonymous = false } = {}) {
  assertProvider(provider);
  if (anonymous) return { apiKey: "", keySource: "none", credentialWarning: undefined };
  const resolved = resolveSearchCredentials();
  const arm = resolved[provider];
  // anysearch 那一格在「只给了 endpoint、没 key」时也存在；没 apiKey 就必须报 none，
  // 否则输出说「带着 key」，请求其实一个 Authorization 都没发。
  const apiKey = arm?.apiKey ?? "";
  return {
    apiKey,
    keySource: apiKey ? arm.source : "none",
    // 文件读坏 / 解析坏：store 的话只说路径和错误，不引内容。
    credentialWarning: resolved.warnings.length > 0 ? resolved.warnings.join("; ") : undefined,
  };
}

/**
 * 探针要遮掉的那几个值：这一跑用的 endpoint、解析出来的 key，以及这一家的环境变量里的 key
 * （`--nokey` 时后者仍可能被上游回显）。三条探针共用这一份清单，多一个要遮的变量只改这里。
 */
export function probeSecrets(provider, apiKey, endpoint) {
  assertProvider(provider);
  return [
    [endpoint, "<endpoint>"],
    [process.env[SEARCH_PROVIDER_ENV_KEYS[provider]], "<key>"],
    [apiKey, "<key>"],
  ];
}

/** 把给定值从一段文字里遮掉。空值不参与，否则会在每个字符之间都切一刀。 */
function mask(text, entries) {
  let out = String(text);
  for (const [value, placeholder] of entries) {
    if (typeof value === "string" && value.length > 0) out = out.split(value).join(placeholder);
  }
  return out;
}

/**
 * 探针输出的唯一遮法：先遮「这一跑真用的那几个值」，再遮凭据形状。
 *
 * 形状那两条不是多余的：上游会给一把我们从没配过的 key（免费额度那一跑的回包里直接签发），
 * 也可能在错误正文里回显 `Bearer ...`、`api_key=...`。
 */
export function maskSecrets(text, entries) {
  return mask(text, entries)
    .replace(/([A-Za-z0-9_-]*(?:api[_-]?key|password)["']?\s*[:=]\s*)["']?[^\s&"',}]+["']?/gi, "$1<key>")
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer <key>");
}
