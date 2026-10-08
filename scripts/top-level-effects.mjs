// scripts/top-level-effects.mjs
// ADR-0101 (R100 D6): the AST front gate — a pure, static classification of a
// module's TOP-LEVEL behavior. It exists to answer one question for the
// vocabulary scan's closed exclusion list: can this file be namespace-injected
// (imported for export inspection) without executing side effects?
//
// Three classifications (per ADR-0101 D6):
//   ① codes ∧ effects       -> the caller treats this as RED
//      (ast-top-level-effect): a governed vocabulary module may not do work
//      at import time — the scan's injector executes whatever it finds.
//   ② codes-named but unverifiable -> RED (ast-codes-unverifiable): an export
//      named *_CODES whose initializer is not a literal
//      (ArrayLiteral / Object.freeze([...]) / spread-free literals) — the
//      existence of the vocabulary cannot be statically proven.
//   ③ effects ∧ no codes    -> exclusion CANDIDATE (info, never a verdict):
//      the file does work at import time but declares no vocabulary — if it
//      ever gains one it must join the closed exclusion list or drop the
//      side effect. The premiere entry: scripts/tau/tau-scan.mjs.
//
// Purity contract: this module itself carries ZERO top-level effects — the
// typescript API is resolved lazily inside tsApi() so an import executes
// nothing. `classifyTopLevel` never loads or executes the target module.
// typescript is resolved via createRequire from packages/store (workspace
// dependency, ^5.6.0) — no new dependency is introduced.

import { createRequire } from "node:module";

let _ts = null;
function tsApi() {
  if (_ts === null) {
    const req = createRequire(new URL("../packages/store/package.json", import.meta.url));
    _ts = req("typescript");
  }
  return _ts;
}

// Callees that compute a deterministic value without observable effect. The
// list is deliberately closed and small — anything else at top level is
// "unverifiable" and treated conservatively as an effect (fail-closed toward
// exclusion, never toward silent admission).
const PURE_CALLEES = new Set([
  "Object.freeze",
  "Object.assign",
  "Object.keys",
  "Object.values",
  "Object.entries",
  "Object.create",
  "Symbol",
  "BigInt",
  "String",
  "Number",
  "Boolean",
  "String.fromCharCode",
  "fileURLToPath",
  "pathToFileURL",
  "path.resolve",
  "path.join",
  "path.dirname",
  "path.basename",
  "path.posix.join",
  "path.posix.resolve",
  "path.posix.dirname",
  "path.posix.basename",
  "JSON.parse",
  "JSON.stringify",
  "Array.from",
  "Array.isArray",
  "parseInt",
  "parseFloat",
  "createRequire",
  "process.cwd",
  "process.argv.slice",
  "process.argv.includes",
  "encodeURIComponent",
  "decodeURIComponent",
  "Promise.resolve",
]);

// Member-call names that are pure data transforms (Array/Object protocol
// methods). Only the method NAME is admitted — the walker still visits the
// call's subtree, so `x.map((p) => spawn(y))` stays flagged through the inner
// call. An unrecognized bare or member callee is unverifiable, never pure.
const PURE_METHODS = new Set([
  "map",
  "filter",
  "flatMap",
  "flat",
  "slice",
  "concat",
  "join",
  "sort",
  "reduce",
  "reduceRight",
  "find",
  "findIndex",
  "includes",
  "some",
  "every",
  "forEach",
  "indexOf",
  "lastIndexOf",
  "at",
  "entries",
  "keys",
  "values",
  "reverse",
  "replace",
  "replaceAll",
  "toLowerCase",
  "toUpperCase",
  "trim",
  "trimStart",
  "trimEnd",
  "split",
  "substring",
  "padStart",
  "padEnd",
  "charAt",
  "charCodeAt",
  "codePointAt",
  "normalize",
  "startsWith",
  "endsWith",
  "match",
  "matchAll",
  "repeat",
]);

// NewExpression callees that are pure constructions (new RegExp, new Map...).
const PURE_NEW_CALLEES = new Set(["RegExp", "Map", "Set", "WeakMap", "WeakSet", "URL"]);

// Callees that are known to do real work at call time (process spawn, fs,
// console, dynamic import/require). A match short-circuits "unverifiable"
// to a definite effect — these are the hazard the gate exists to catch.
const EFFECT_CALLEES = new Set([
  "spawn",
  "spawnSync",
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
  "fork",
  "readFileSync",
  "writeFileSync",
  "appendFileSync",
  "mkdirSync",
  "mkdtempSync",
  "readdirSync",
  "existsSync",
  "statSync",
  "realpathSync",
  "rmSync",
  "unlinkSync",
  "renameSync",
  "copyFileSync",
  "openSync",
  "watch",
  "watchFile",
  "require",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "fetch",
]);

function calleeName(expr, ts) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return calleeName(expr.expression, ts) + "." + expr.name.text;
  return null;
}

// Does this initializer contain a call the gate cannot prove pure? Nested
// expressions are walked: a pure whitelist call wrapping another call still
// evaluates the inner one.
function initializerIsPure(node, ts) {
  let pure = true;
  const visit = (n) => {
    if (!pure) return;
    if (ts.isCallExpression(n)) {
      const name = calleeName(n.expression, ts);
      const member = name !== null && ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : null;
      const isPure = name !== null && !EFFECT_CALLEES.has(name) && (PURE_CALLEES.has(name) || (member !== null && PURE_METHODS.has(member)));
      if (!isPure) {
        pure = false;
        return;
      }
    }
    if (ts.isNewExpression(n)) {
      const name = calleeName(n.expression, ts);
      if (name === null || !PURE_NEW_CALLEES.has(name)) {
        pure = false;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return pure;
}

// Is the initializer a literal vocabulary (statically verifiable)?
//   [ ... ]                        literal array
//   Object.freeze([ ... ])         the house convention
// Anything else (function call, identifier, computed) is unverifiable.
function initializerIsLiteralVocab(init, ts) {
  if (ts.isArrayLiteralExpression(init)) return true;
  if (ts.isCallExpression(init) && calleeName(init.expression, ts) === "Object.freeze") {
    const arg = init.arguments[0];
    return !!arg && ts.isArrayLiteralExpression(arg);
  }
  return false;
}

// Classify one source text. Returns:
//   { codes: [{name, verifiable}], effects: [{kind, detail}] }
// `codes` lists every statically named `export const *_CODES` (verifiable
// means the initializer is a literal vocabulary); `effects` lists the
// top-level behavior vectors found. The caller combines them into the three
// classifications — this module reports facts only.
export function classifyTopLevel(text) {
  const ts = tsApi();
  const sf = ts.createSourceFile("module.mjs", String(text ?? ""), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const codes = [];
  const effects = [];
  const push = (kind, detail) => effects.push({ kind, detail });
  sf.statements.forEach((st, i) => {
    if (ts.isExpressionStatement(st)) {
      // Directive prologue ("use strict" etc.) is declaration, not effect.
      if (!(ts.isStringLiteral(st.expression) && i === 0)) {
        // A bare top-level `await expr;` is an expression statement whose
        // awaited value runs at import time: tag it top-level-await so the
        // dedicated signal survives (the generic kind would swallow it).
        const kind = ts.isAwaitExpression(st.expression) ? "top-level-await" : "expression-statement";
        push(kind, st.expression.getText(sf).slice(0, 72));
      }
      return;
    }
    if (ts.isImportDeclaration(st)) {
      if (!st.importClause || (!st.importClause.name && !st.importClause.namedBindings)) {
        push("side-effect-import", st.moduleSpecifier.getText(sf));
      }
      return;
    }
    if (ts.isVariableStatement(st)) {
      const exported = st.modifiers && st.modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && exported && /_CODES$/.test(d.name.text)) {
          codes.push({ name: d.name.text, verifiable: d.initializer ? initializerIsLiteralVocab(d.initializer, ts) : false });
        }
        if (d.initializer && !initializerIsPure(d.initializer, ts)) {
          push("impure-initializer", d.name.getText(sf).slice(0, 48) + " = " + d.initializer.getText(sf).slice(0, 60));
        }
      }
      return;
    }
    if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isExportDeclaration(st) || ts.isTypeAliasDeclaration?.(st) || ts.isInterfaceDeclaration?.(st)) {
      return;
    }
    if (ts.isExportAssignment(st)) {
      if (st.expression && ts.isCallExpression(st.expression)) {
        push("export-call", "export default " + st.expression.getText(sf).slice(0, 60));
      }
      return;
    }
    if (ts.isIfStatement(st) || ts.isForStatement(st) || ts.isForInStatement(st) || ts.isForOfStatement(st) || ts.isWhileStatement(st) || ts.isDoStatement(st) || ts.isSwitchStatement(st) || ts.isTryStatement(st) || ts.isThrowStatement(st)) {
      push("control-flow", st.getText(sf).slice(0, 72));
      return;
    }
    // Anything else at top level (labeled/empty/debugger statements are inert).
    // A bare `await expr;` is an ExpressionStatement, already tagged above.
  });
  // top-level await bound to a variable initializer (`const x = await ...`) is
  // a dedicated kind too — the expression-statement branch never sees it.
  const hasTopAwait = sf.statements.some((st) => ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => d.initializer && d.initializer.kind === ts.SyntaxKind.AwaitExpression));
  if (hasTopAwait) push("top-level-await", "await in top-level initializer");
  return { codes, effects };
}
