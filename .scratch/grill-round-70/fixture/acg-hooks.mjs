// ESM customization hooks (R70 T0 fixture): redirect node:child_process to
// ./acg-cp-stub.mjs ONLY when the importer is scripts/assert-checks-green.mjs.
const STUB = new URL("./acg-cp-stub.mjs", import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier === "node:child_process" && /assert-checks-green\.mjs$/.test(context.parentURL || "")) {
    return { url: STUB, shortCircuit: true };
  }
  return next(specifier, context);
}
