# Tiered delegation

Work on Pollyroll is split by model tier. The tier that plans and judges is not the tier that edits
code. This page is tool-neutral; harness-specific mechanics are at the end.

## Tiers

| Tier          | Role                                                                                                           | Never                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Thinking      | Split the plan into task briefs, dispatch, adjudicate reviews, record decisions, final verdict, open the PR    | edit `src/`, tests, `e2e/`, or `demo/`             |
| Review        | Per-task gate from a diff file (spec compliance, then quality); whole-branch review with exit-criteria scoring | write code                                         |
| Coding        | One task brief at a time: failing test first, smallest change, focused test and build, commit                  | design decisions; it reports NEEDS_CONTEXT instead |
| Transcription | Briefs that already contain the complete code: apply, run the listed commands, commit                          | anything needing judgment                          |

The session model is the thinking tier. It may write docs, configs it fully specifies in a brief
for a transcriber, `DECISIONS.md`, `CHANGELOG.md`, and the PR body.

## Flow

1. **Brief.** For the next phase in [PLAN.md](../PLAN.md) § 9, write one brief per task into
   `.work/briefs/` (gitignored). A brief is self-contained: it quotes the plan sections it needs.
   Size each task so a coding agent finishes it in one session (typically one module plus tests).
2. **Execute.** Record the base commit, then dispatch one fresh coding-tier agent per brief. The
   agent gets the brief path and the handbook pages the brief names, never the conversation.
   Tasks that touch disjoint files may run in parallel only in separate git worktrees.
3. **Diff.** Write `git log --oneline BASE..HEAD`, `git diff --stat BASE..HEAD`, and
   `git diff -U10 BASE..HEAD` into `.work/diffs/task-N.diff`.
4. **Review.** Dispatch a task reviewer with the brief, the implementer's report, and the diff file.
   Critical and Important findings go back to a fresh coding-tier agent as a fix brief. At most two
   fix rounds per task; a third failure means the brief or plan is wrong, and the thinking tier
   rewrites the brief. Minor findings are appended to `.work/minor-findings.md`.
5. **Next phase** only after every task in the current phase is approved.
6. **Branch review** once all phases pass: dispatch the branch reviewer with the plan, the full
   branch diff file, and `.work/minor-findings.md`. It scores every exit criterion. Fix rounds
   follow the same cap. The thinking tier then runs `pnpm verify` and `pnpm e2e` itself, and opens
   the PR per [PLAN.md](../PLAN.md) § 10.

## Task brief template

```
# Task N: <name>
Phase: <n>   Base: <commit>   Branch: <name>
Handbook: docs/agents/architecture.md §..., docs/agents/workflow.md §...
Plan excerpt: <the exact PLAN.md text this task implements>
Goal: <one sentence, observable behavior>
Files: <exact paths to create or edit; nothing else>
Test first: <test file, test name, what it asserts, why it fails today>
Change: <what to implement; names and signatures decided here, no options left open>
Commands: <focused test> · <pnpm build> · <pnpm typecheck> · <pnpm size if relevant>
Acceptance: <bullets a reviewer can check from the diff>
Out of scope: <what not to touch>
Commit: <type(scope): subject>   (no trailers, no AI mentions)
Report to: .work/reports/task-N.md
```

## Report template (coding tier, final message)

```
Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
Commits: <sha> <subject>
Tests: <n>/<n> focused · build ✓ · typecheck ✓
Concerns: <none | one line each>
Report: <path>
```

## Token rules

- Briefs, not transcripts. A dispatch prompt describes one task; never paste prior summaries.
- Reviewers read one diff file, not the repository, unless a finding requires a caller check.
- Detail lives in report files; replies follow the templates.
- The thinking tier does not re-read whole source files after briefing; it reads verdicts, stats,
  and the specific lines a review names.

## Autonomous run

When the owner hands the whole build to an unattended session (for example a cloud session), there
is no human approval gate:

- The plan is approved. Do not brainstorm alternatives or reopen decisions in PLAN.md.
- A coding agent's NEEDS_CONTEXT goes to the thinking tier, which decides using PLAN.md, the
  invariants in AGENTS.md, and the smallest-budget option, appends the decision to
  [DECISIONS.md](../DECISIONS.md) (date, question, choice, reason), and re-dispatches.
- Stop and leave a draft PR describing the blocker only if a decision would break an AGENTS.md
  invariant or a PLAN.md budget.
- Commit and push after each approved task so progress survives an interrupted session.
- `.work/` is not committed; anything the owner must see goes into DECISIONS.md or the PR body.

## Claude Code

Agent definitions live in `.claude/agents/` with pinned models and tool sets:

| Agent                | Tier            | Model                            |
| -------------------- | --------------- | -------------------------------- |
| `pr-implementer`     | Coding          | `claude-opus-5-5`                |
| `pr-transcriber`     | Transcription   | `claude-sonnet-5-5`              |
| `pr-task-reviewer`   | Review (task)   | `claude-opus-5-5`, no edit tools |
| `pr-branch-reviewer` | Review (branch) | `claude-opus-5-5`, no edit tools |

The session model is the thinking tier (Opus 5.5, `claude-opus-5-5`). Dispatch the agents above by name
with the Agent tool. The `superpowers` plugin is enabled in `.claude/settings.json`; its
`subagent-driven-development` and `test-driven-development` skills match this flow, but this page is
authoritative and the flow works without the plugin. If a session cannot see `.claude/agents/`,
dispatch `general-purpose` with an explicit `model` and paste the definition body as the preamble.

## Codex

Codex maps the same tiers onto its own models; it reads this page and the skill under
`.agents/skills/`.
