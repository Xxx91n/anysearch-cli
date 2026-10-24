# AGENTS.md — anysearch-cli

AnySearch：垂直领域信息专精 agent CLI（`ans`）——严格领域白名单、证据锚定检索、域外弃答。术语唯一权威见 `GLOSSARY.md`。

## How to run
- `pnpm install --ignore-scripts`（better-sqlite3 走预编译，禁 node-gyp）
- `pnpm -r check` / `pnpm -r test` / `pnpm -r build`（turbo，各包任务同构）
- `node scripts/ship-gate.mjs`——产品冒烟总闸（发布判定）
- `pnpm -C packages/store eval --offline`——golden memory-eval 离线切片

## Directory conventions
- `packages/{kernel,store,retriever,embedding}` 核心库；`apps/{cli,mcp,plugin,dsh-plugin}` 交付面；`GLOSSARY.md` 术语唯一权威；`docs/agents/` agent 约定文档；`.scratch/` 本地工作面，永不入库

## 代码里看不出来的坑
- better-sqlite3@13 走预编译 .node；pnpm-workspace.yaml `allowBuilds: false` 是故意的——翻转它需要 MSBuild + ClangCL，别动
- pnpm 版本钉死 11.24.0 + `pmOnFail: error`：版本不匹配立即报错，不静默改写 lockfile；升 pnpm 时两个钉版字段同一 commit 改
- 版本控制全走 GitButler（`but`）；未经明令不 push
- 宿主 hooks 契约坑（Codex 只认 hookSpecificOutput envelope / Antigravity stdin camelCase + PreToolUse `{}`=DENY 等实证细节）见 `docs/*-integration.md` 与 `apps/plugin/src/hooks/adapters/` 注释

## Agent skills

### Issue tracker

Issues live in GitHub Issues; all operations use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles, label strings equal to role names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one `GLOSSARY.md` at the repo root. See `docs/agents/domain.md`.
