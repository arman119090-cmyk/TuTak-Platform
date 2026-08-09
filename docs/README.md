# Which document to read

This directory accumulated a document per round of work, and several of them
now describe a platform that no longer exists. A reader with a question
deserves to know which answer is current before they act on it — an audit
that says "there is no payment layer" is worse than no audit at all once
there is one.

**Current** means it describes the code on the branch today. **Superseded**
means it was true when written and is kept as a record of how the platform
got here.

## Start here

| Question | Document |
| --- | --- |
| How is it built? | [ARCHITECTURE.md](ARCHITECTURE.md) |
| How do I run it? | [../README.md](../README.md), [TESTING_RU.md](TESTING_RU.md) |
| How do I deploy and operate it? | [DEPLOYMENT.md](DEPLOYMENT.md) |
| Is the money safe? | [AUDIT_FINANCIAL_2026-08.md](AUDIT_FINANCIAL_2026-08.md) |
| What is still weak? | [WEAK_SPOTS_RU.md](WEAK_SPOTS_RU.md) |
| How fast is it? | [LOAD_TEST.md](LOAD_TEST.md) |

## Current

| Document | What it covers |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Module boundaries, data model, the shape of the system |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Environment, migrations, backups, point-in-time recovery, alerts, scaling past one instance |
| [RAILWAY_RU.md](RAILWAY_RU.md) | Deploying the demonstration to Railway from a phone, in Russian. `render.yaml` is the same thing for Render |
| [FINANCIAL_CORE_DESIGN.md](FINANCIAL_CORE_DESIGN.md) | Why the ledger is shaped the way it is; what settlement, refunds and payouts each guarantee |
| [AUDIT_FINANCIAL_2026-08.md](AUDIT_FINANCIAL_2026-08.md) | The current audit of the money paths. Defects found, fixes, what was attacked and held, what is still not proven |
| [WEAK_SPOTS_RU.md](WEAK_SPOTS_RU.md) | Things that work but are poorly defended or will not scale — owner's decisions, cost against risk |
| [LOAD_TEST.md](LOAD_TEST.md) | Throughput and latency of the money paths, re-measured 9 August 2026 |
| [DESIGN.md](DESIGN.md) · [DESIGN_PREVIEW.md](DESIGN_PREVIEW.md) | The design system and screenshots of every screen |
| [TESTING_RU.md](TESTING_RU.md) · [LAUNCH_RU.md](LAUNCH_RU.md) | Running and testing the stack, in Russian |

## Superseded

Kept because the reasoning is worth reading and because a project's history
should not be quietly rewritten. Each one is a snapshot of a specific commit.

| Document | Written against | Why it no longer describes the platform |
| --- | --- | --- |
| [AUDIT_FINAL_2026-08.md](AUDIT_FINAL_2026-08.md) | `9190116`, 6 Aug | Its three structural blockers — no payment layer, no outbox, replica-unsafe scheduling — have all been built since |
| [AUDIT_2026-08.md](AUDIT_2026-08.md) | first pass | Findings closed in `HARDENING_2026-08.md` |
| [AUDIT_2026-08-B.md](AUDIT_2026-08-B.md) | independent re-audit | Findings closed in `REMEDIATION_2026-08.md` |
| [AUDIT_2026-08-C.md](AUDIT_2026-08-C.md) | running platform, round C | Findings closed; superseded by the financial audit |
| [HARDENING_2026-08.md](HARDENING_2026-08.md) · [REMEDIATION_2026-08.md](REMEDIATION_2026-08.md) | — | Records of what was fixed and why |

## A standing caution

Every audit in this directory was written by the same author as the code.
That is worth less than an independent review, and the pattern across four
rounds is consistent: each round finds real defects in areas the previous
round passed, because each attacks in a way the previous one did not. The
most recent example is in the financial audit — a crash test that had never
been run found a double charge that four rounds of reading had not.

Treat these as evidence of effort, not as a certificate. Commission an
outside review before real money moves.
