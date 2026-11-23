// 三条手工探针共用的凭据解析：一份 loader 钩子，一个 store 调用，谁也不许再抄一遍解析逻辑。
//
// 为什么要钩子：store 的源码用 `.js` 写相对 import（Node16 风格，指到同目录的 `.ts`），
// retriever 的源码干脆不写扩展名（Bundler 风格）。tsc 和 tsx 都放行，plain node 不放行。
// 三条探针的硬指标是 `node <文件>` 直接跑（decision #413），所以在这里补一次：`.js` 换成
// 同名 `.ts`、没扩展名的补 `.ts`，只在目标文件真的存在时替换，坏路径照样报错。
// 钩子是进程级的：先加载这个文件，后面 import 谁都能用，探针只 import 它一次。
//
// Node 22.15+ 才有 module.registerHooks；仓库下限是 22.19，够。

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const JS_SUFFIX = /\.([cm]?)js$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = JS_SUFFIX.test(specifier)
        ? specifier.replace(JS_SUFFIX, ".$1ts")
        : /\.[cm]?[jt]s$/.test(specifier) ? undefined : specifier + ".ts";
      if (candidate && existsSync(fileURLToPath(new URL(candidate, context.parentURL)))) {
        return nextResolve(candidate, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const { resolveSearchCredentials } = await import("../packages/store/src/credentials.ts");

/**
 * 探针看到的那把 key，和它是从哪来的。
 *
 * `keySource` 只有三档，和 probe schema、README 说的一致：
 *   env   这一家的环境变量（ANYSEARCH_API_KEY / TAVILY_API_KEY）
 *   user  用户凭据文件 `~/.ans/credentials.json`
 *   none  两处都没有，探针照旧跑（anysearch 匿名能查，tavily 会退 2 说没结论）
 */
export function resolveProbeCredentials(provider, env = process.env) {
  const resolved = resolveSearchCredentials(env);
  const arm = resolved[provider];
  // anysearch 那一格在「只给了 endpoint、没 key」时也存在（source 记 env，apiKey 是空的）。
  // 没 key 就必须报 none：报 env/user 会让输出说「带着 key」，可请求其实一个 Authorization 都没发。
  const apiKey = arm?.apiKey ?? "";
  return {
    apiKey,
    keySource: apiKey ? arm.source : "none",
    // 文件读坏 / 解析坏：store 的话只说路径和错误，不引内容。不转出来就会被读成「没配 key」。
    credentialWarning: resolved.warnings.length > 0 ? resolved.warnings.join("; ") : undefined,
  };
}

/** 把给定值从一段文字里遮掉。空值不参与，否则会在每个字符之间都切一刀。 */
export function mask(text, entries) {
  let out = String(text);
  for (const [value, placeholder] of entries) {
    if (typeof value === "string" && value.length > 0) out = out.split(value).join(placeholder);
  }
  return out;
}
