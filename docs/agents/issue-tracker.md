# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` — never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

- **List open work**: `ls .scratch/*/issues/*.md 2>/dev/null` and grep for `Status:` lines not equal to `done`.
- **Find a feature's spec**: read `.scratch/<feature-slug>/spec.md`.
- **Find issues for a feature**: `ls .scratch/<feature-slug>/issues/*.md`.

## Migration note

This repo starts with local-markdown issue tracking (internal development phase, repo not yet public). When the repo goes public, migrate to GitHub Issues by replacing this file with `issue-tracker-github.md` and porting open `.scratch/` issues via `gh issue create`.
