# TuTak — Current Claude Task

This file is the canonical current task for Claude. Before starting or continuing implementation, read this file together with `docs/TUTAK_MASTER_PROJECT_CONTEXT_2026-08-16.md`, `docs/design/TUTAK_UI_UX_MASTER_SPEC_V1.md` (when present), and GitHub Issue #28 `TuTak — Independent Audit Findings`.

## NEXT TASK — MIGRATE CUSTOMER QR PURCHASE FLOW TO PURCHASEINTENT

Continue from the current HEAD. Do not redesign the architecture and do not change unrelated functionality.

### Goal
Make the normal customer QR purchase flow use the canonical PurchaseIntent flow instead of the legacy `qrApi.redeem()` financial path.

### Requirements
1. When a customer scans a partner purchase QR, route the purchase through `PurchaseIntent`.
2. Customer enters the full purchase amount and, where applicable, the amount of previously earned bonus/discount they want to spend.
3. For ordinary non-integrated partners, the customer-created PurchaseIntent waits for partner/cashier confirmation.
4. Cashier/partner cannot modify the customer's amount. They may only Confirm or Reject.
5. Keep the strict 3-minute expiry. After expiry neither Confirm nor Reject may change the transaction; it must resolve as `EXPIRED`.
6. Do not allow self-dealing. Use the canonical affiliation check (`isAffiliated`) consistently.
7. Settlement must use the canonical PurchaseIntent financial logic. Do not duplicate the old QR bonus formula.
8. Preserve spending of previously earned bonus according to approved rules.
9. Do not break EV/FastCharge/OCPI. Trusted integrated systems may continue automatic finalization through their integration-specific flow.
10. Legacy QR code may remain only where technically required for backwards compatibility, but it must not remain an alternative financial settlement path for the normal customer purchase flow.
11. Fix the identified expiry inconsistency in `reject()`: an expired PurchaseIntent must become/remain `EXPIRED`, not `REJECTED`.
12. Fix demo/mock PurchaseIntent calculation so UI does not show the entire contribution percentage as immediately available customer GREEN bonus. It must reflect canonical 20/30/20/30 distribution.

### Verification required
- Add regression/integration tests for QR → PurchaseIntent → partner confirmation → settlement.
- Test Confirm, Reject, Expired, duplicate confirmation/idempotency, self-dealing, bonus spending and concurrent requests.
- Prove with regression tests that the old QR financial path is no longer reached by the normal customer purchase flow.
- Run the full test suite.
- Update `docs/HARDENING_AUDIT_2026-08-16.md`.
- Commit and push all changes to `claude/tutak-loyalty-mvp-e485jm`.
- Report exact files changed, tests added, full-suite result and commit SHA.

Do not start M4/M5/M6 or unrelated features in this task.

## Persistent instruction
At the start of every new TuTak task/session, re-read this file and the master project context before changing code. If this file conflicts with a later explicit decision from Arman, stop the conflicting item and ask Arman; do not silently invent a new business rule.
