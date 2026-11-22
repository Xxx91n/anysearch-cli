// Which changed files count as documentation, for the CI lanes that skip on a
// docs-only change.
//
// Design: the boundary is a fixed list, not a glob — a glob like `**/*.md` would
// swallow product assets (`apps/plugin/*.md`, `domains/docs.toml`) whose
// contents tests read (#408).
//
// Design: an empty list is not a docs-only change — a change set we could not
// read has to keep every lane running, never skip it by accident.
//
// The setup action pipes `git diff --name-only --no-renames -z` here and reads
// "true"/"false" back; the test can call the functions directly.

import fs from "node:fs";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DOCS = new Set(["README.md", "README.zh-CN.md", "GLOSSARY.md", "CHANGELOG.md"]);

export function isDocumentation(file) {
  const normalized = normalize(file);
  return normalized.startsWith("docs/") || ROOT_DOCS.has(normalized);
}

export function docsOnly(files) {
  const list = (files ?? []).map(normalize).filter(Boolean);
  return list.length > 0 && list.every(isDocumentation);
}

function normalize(file) {
  return String(file)
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = fs.readFileSync(0, "utf8");
  const files = input.split(input.includes("\0") ? "\0" : /\r?\n/).filter(Boolean);
  process.stdout.write(docsOnly(files) ? "true" : "false");
}
