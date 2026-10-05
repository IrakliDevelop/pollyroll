# Decision log

Choices made where [PLAN.md](PLAN.md) was silent or ambiguous. Append only. One entry per decision.

| Date       | Question                                 | Choice                               | Reason                                                                     |
| ---------- | ---------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| 2026-10-06 | Package name: `polyroll` or `pollyroll`? | `pollyroll`, matching the repository | One name across repo and npm; both were free on npm                        |
| 2026-10-06 | Property-based testing library?          | `fast-check` as a dev dependency     | Large input spaces (notation, seeds); dev-only, so zero runtime deps holds |
