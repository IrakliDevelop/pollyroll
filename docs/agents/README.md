# Agent handbook

Durable, tool-neutral knowledge base for AI-assisted work on Pollyroll. [AGENTS.md](../../AGENTS.md)
is the mandatory short entry point; these pages provide detail on demand.

| Need                                 | Read                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------- |
| What to build and why                | [Build plan](../PLAN.md)                                               |
| Decisions taken during the build     | [Decision log](../DECISIONS.md)                                        |
| Find the owning module or contract   | [Architecture map](architecture.md)                                    |
| Implement, test, or release          | [Workflow and verification](workflow.md)                               |
| Review a change or prepare a handoff | [Review playbook](review.md)                                           |
| Split work across model tiers        | [Tiered delegation](delegation.md)                                     |
| Invoke a reusable procedure          | [Pollyroll skill](../../.agents/skills/pollyroll-development/SKILL.md) |

## Source-of-truth hierarchy

1. Executable code, the package manifest, and tests describe current behavior.
2. [PLAN.md](../PLAN.md) describes the approved target behavior and budgets.
3. `AGENTS.md` and this handbook describe durable engineering policy.
4. [DECISIONS.md](../DECISIONS.md) records choices made where the plan was silent.
5. `README.md` describes the supported public API.

When documentation disagrees with code, verify with tests, fix durable documentation when in scope,
and call out the discrepancy. Run `node scripts/check-agent-docs.mjs` to catch broken links and
missing handbook files.
