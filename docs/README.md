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
| What's the referral/commission model, exactly? | [REFERRAL_COMMISSION_MODEL_RU.md](REFERRAL_COMMISSION_MODEL_RU.md), `ReferralService.computePoolSplit` |
| Is there dead code or duplication lying around? | [CODEBASE_AUDIT_2026-08-30.md](CODEBASE_AUDIT_2026-08-30.md) |
| How does roaming-CPO (a partner's own charging network) work? | [ROAMING_CPO_INTEGRATION_2026-08-25.md](ROAMING_CPO_INTEGRATION_2026-08-25.md) → [...-27-SECURITY.md](ROAMING_CPO_INTEGRATION_2026-08-27-SECURITY.md) → [...FINANCIAL_ACCOUNTING_2026-08-29.md](ROAMING_CPO_FINANCIAL_ACCOUNTING_2026-08-29.md) → [...PREPAID_BALANCE_2026-08-29.md](ROAMING_CPO_PREPAID_BALANCE_2026-08-29.md), in that order |
| How do fuel-station branches/staff work? | [FUEL_STATION_BRANCHES_2026-08-29.md](FUEL_STATION_BRANCHES_2026-08-29.md) |

## Current

| Document | What it covers |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Module boundaries, data model, the shape of the system |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Environment, migrations, backups, point-in-time recovery, alerts, scaling past one instance |
| [RAILWAY_RU.md](RAILWAY_RU.md) | Deploying the demonstration to Railway from a phone, in Russian. `render.demo.yaml` is the same thing for Render |
| [RENDER_STAGING_RU.md](RENDER_STAGING_RU.md) | The root `render.yaml` staging blueprint: every Render variable, whether it is build-time, runtime or generated, and the order to apply them. In Russian |
| [FINANCIAL_CORE_DESIGN.md](FINANCIAL_CORE_DESIGN.md) | Why the ledger is shaped the way it is; what settlement, refunds and payouts each guarantee |
| [AUDIT_FINANCIAL_2026-08.md](AUDIT_FINANCIAL_2026-08.md) | The audit of the money paths. Defects found, fixes, what was attacked and held, what is still not proven |
| [WEAK_SPOTS_RU.md](WEAK_SPOTS_RU.md) | Things that work but are poorly defended or will not scale — owner's decisions, cost against risk |
| [LOAD_TEST.md](LOAD_TEST.md) | Throughput and latency of the money paths, re-measured 9 August 2026 |
| [DESIGN.md](DESIGN.md) · [DESIGN_PREVIEW.md](DESIGN_PREVIEW.md) · [DESIGN_HANDOFF_RU.md](DESIGN_HANDOFF_RU.md) | The design system, screenshots of every screen, and the handoff notes for the unified map/branch-QR redesigns |
| [TESTING_RU.md](TESTING_RU.md) · [LAUNCH_RU.md](LAUNCH_RU.md) | Running and testing the stack, in Russian |
| [REFERRAL_COMMISSION_MODEL_RU.md](REFERRAL_COMMISSION_MODEL_RU.md) | The 3-level referral chain / commission model in plain Russian |
| [CORE_ARCHITECTURE_MIGRATION_2026-08.md](CORE_ARCHITECTURE_MIGRATION_2026-08.md) · [CORE_ARCHITECTURE_COMPLETION_REPORT_2026-08.md](CORE_ARCHITECTURE_COMPLETION_REPORT_2026-08.md) | The 2026-08-22 rework that made `PurchaseIntent` and the 3-level referral chain the canonical model — read before touching either |
| [ROAMING_CPO_INTEGRATION_2026-08-25.md](ROAMING_CPO_INTEGRATION_2026-08-25.md) | The wholesale-resale roaming-CPO integration (webhook-style, `modules/roaming-cpo/`) — a partner's own network, distinct from the OCPI adapter seam in ARCHITECTURE.md |
| [ROAMING_CPO_INTEGRATION_2026-08-27-SECURITY.md](ROAMING_CPO_INTEGRATION_2026-08-27-SECURITY.md) | Fake-session and insecure-linking fixes for app-initiated roaming charging; records what did *not* ship in that pass |
| [ROAMING_CPO_FINANCIAL_ACCOUNTING_2026-08-29.md](ROAMING_CPO_FINANCIAL_ACCOUNTING_2026-08-29.md) | Completes the above: frozen dual-rate billing, margin split, the double-entry ledger for an app-initiated session |
| [ROAMING_CPO_PREPAID_BALANCE_2026-08-29.md](ROAMING_CPO_PREPAID_BALANCE_2026-08-29.md) | The customer prepaid-balance mechanism that actually collects what the financial-accounting doc above left as a growing receivable |
| [FUEL_STATION_BRANCHES_2026-08-29.md](FUEL_STATION_BRANCHES_2026-08-29.md) | Branch-scoped fuel types, staff assignment, and branch-specific QR codes |
| [CODEBASE_AUDIT_2026-08-30.md](CODEBASE_AUDIT_2026-08-30.md) · [...RU.md](CODEBASE_AUDIT_2026-08-30_RU.md) | The bloat/duplication/dead-code sweep across the whole monorepo — what was deleted, what looked dead but wasn't, what was flagged instead of touched |
| [PARTNER_PROFILE_2026-08-24.md](PARTNER_PROFILE_2026-08-24.md) · [PARTNER_SETTLEMENT_CYCLE_2026-08-24.md](PARTNER_SETTLEMENT_CYCLE_2026-08-24.md) · [PARTNER_COLLECTIONS_HARDENING_2026-08-24.md](PARTNER_COLLECTIONS_HARDENING_2026-08-24.md) | Partner-facing public profile, the biweekly settlement cycle, and dual-control hardening on cash collections |
| [MEDIA_SYSTEM_2026-08-23.md](MEDIA_SYSTEM_2026-08-23.md) | Upload/moderation/delivery for partner and profile images |
| [MAP_REDESIGN_2026-08-23.md](MAP_REDESIGN_2026-08-23.md) | The unified partners+EV-stations map screen |
| [ID_VALIDATION_2026-08-23.md](ID_VALIDATION_2026-08-23.md) | UUID/id validation sweep against IDOR |
| [SECURITY_HARDENING_2026-08-23.md](SECURITY_HARDENING_2026-08-23.md) · [PENTEST_2026-08-23.md](PENTEST_2026-08-23.md) | CORS/headers/rate-limit hardening and an adversarial pass looking for real holes |
| [INVESTOR_DEMO_RU.md](INVESTOR_DEMO_RU.md) · [ANDROID_APK_RU.md](ANDROID_APK_RU.md) · [STORE_SUBMISSION.md](STORE_SUBMISSION.md) | Investor walkthrough, building an installable APK from a phone, app-store submission notes |
| [PARTNER_TERMS.md](PARTNER_TERMS.md) · [LEGAL_AGREEMENTS_DRAFT_RU.md](LEGAL_AGREEMENTS_DRAFT_RU.md) | Draft legal terms — not reviewed by a lawyer, do not ship as-is |

## Superseded

Kept because the reasoning is worth reading and because a project's history
should not be quietly rewritten. Each one is a snapshot of a specific commit.

| Document | Written against | Why it no longer describes the platform |
| --- | --- | --- |
| [TUTAK_MASTER_PROJECT_CONTEXT_2026-08-16.md](TUTAK_MASTER_PROJECT_CONTEXT_2026-08-16.md) | 16 Aug | Describes the single-level referral model the 2026-08-22 rework replaced; carries its own superseded banner |
| [NEXT_CLAUDE_TASK.md](NEXT_CLAUDE_TASK.md) | 22 Aug | Frozen "no task queued" status; a week of shipped work since (fuel-station branches, roaming-CPO) is undocumented here; carries its own superseded banner |
| [HARDENING_AUDIT_2026-08-16.md](HARDENING_AUDIT_2026-08-16.md) · [HARDENING_AUDIT_2026-08-19-P0-P3.md](HARDENING_AUDIT_2026-08-19-P0-P3.md) | 16/19 Aug | Point-in-time hardening rounds; findings closed, folded into the code and later audits |
| [LAUNCH_READINESS_2026-08-16.md](LAUNCH_READINESS_2026-08-16.md) | 16 Aug | A launch checklist for the pre-migration architecture |
| [AUDIT_FINAL_2026-08.md](AUDIT_FINAL_2026-08.md) | `9190116`, 6 Aug | Its three structural blockers — no payment layer, no outbox, replica-unsafe scheduling — have all been built since |
| [AUDIT_2026-08.md](AUDIT_2026-08.md) | first pass | Findings closed in `HARDENING_2026-08.md` |
| [AUDIT_2026-08-B.md](AUDIT_2026-08-B.md) | independent re-audit | Findings closed in `REMEDIATION_2026-08.md` |
| [AUDIT_2026-08-C.md](AUDIT_2026-08-C.md) | running platform, round C | Findings closed; superseded by the financial audit |
| [HARDENING_2026-08.md](HARDENING_2026-08.md) · [REMEDIATION_2026-08.md](REMEDIATION_2026-08.md) | — | Records of what was fixed and why |

## A standing caution

Every audit in this directory was written by the same author as the code.
That is worth less than an independent review, and the pattern across every
round is consistent: each round finds real defects in areas the previous
round passed, because each attacks in a way the previous one did not. The
most recent example is in the financial audit — a crash test that had never
been run found a double charge that four rounds of reading had not.

Treat these as evidence of effort, not as a certificate. Commission an
outside review before real money moves.
