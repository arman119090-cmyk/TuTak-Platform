TuTak — MASTER PROJECT CONTEXT
Дата: 16 августа 2026

**SUPERSEDED, 2026-08-29 (codebase audit).** Этот документ описывает
референс-модель ДО перестройки 2026-08-22 (см.
`docs/CORE_ARCHITECTURE_MIGRATION_2026-08.md` и
`docs/CORE_ARCHITECTURE_COMPLETION_REPORT_2026-08.md`). В частности:
"один direct referral level" и разбивку пула "20% GREEN / 30% DEFERRED /
20% DIRECT REFERRER / 30% TUTAK" ниже заменила 3-уровневая реферальная
цепочка (`ReferralService.computePoolSplit`, `apps/api/src/modules/referral/
referral.service.ts`) — актуальные проценты и логику см. там же и в
`docs/ARCHITECTURE.md`. Оставлено как исторический снимок решений Армана
на момент 16 августа, а не как текущий source of truth.

ВАЖНО: полный canonical context TuTak из текущего согласованного документа. Source of truth для бизнес-правил и независимого аудита.

Актуальное дополнение после составления исходного документа:
- Referral Challenge 1,000 AMD inviter + 1,000 AMD qualified friend финансируется TuTak из средств компании.
- Награда становится GREEN / AVAILABLE и доступна к трате сразу после фактической квалификации.

Полный контекст находится в переданном Арманом документе TuTak_COMPLETE_PROJECT_CONTEXT_2026-08-16. При конфликте более поздние явно утверждённые Арманом решения имеют приоритет.

Ключевые canonical правила:
- unified PartnerCompany/PartnerLocation/PartnerStaff/PartnerIntegration architecture;
- FastCharge = обычный PartnerCompany + EV_CHARGING/OCPI capabilities, существующий OCPI flow не ломать;
- partner-specific negotiated_partner_rate;
- partner-specific max_bonus_payment_percent, включая 100%;
- registration phone → SMS OTP;
- referral attribution только при регистрации и immutable;
- один direct referral level;
- PurchaseIntent timeout 3 minutes;
- GREEN reservation AVAILABLE→RESERVED→SPENT, reject/timeout → AVAILABLE;
- full confirmed gross amount является базой contribution/deferred activity;
- contribution pool split 20% GREEN / 30% DEFERRED / 20% DIRECT REFERRER / 30% TUTAK;
- no referrer: referral 20% также TuTak;
- DeferredBonusLot: отдельный lot, 3 months, cumulative 54,000 AMD subsequent eligible confirmed gross turnover;
- current purchase progresses all older eligible lots, never its own new lot;
- Referral Challenge: first 3 actually-qualified referrals, qualification 10,000 AMD cumulative confirmed gross, no deadline, 1,000+1,000 AMD, funded by TuTak;
- Partner Settlement Ledger: positive = TuTak owes partner, negative = partner owes TuTak; separate auditable entries;
- OWNER/MANAGER/CASHIER with individual identity; cashier cannot change negotiated rate;
- exact monetary arithmetic, transactional/idempotent/auditable financial operations;
- PurchaseIntent must never represent successful financial completion unless all required financial effects committed successfully;
- audit all legacy production purchase/finalization paths and prevent contradictory economics;
- preserve auth/users/partners/balances/transactions/FastCharge-OCPI via safe migrations/adapters.

Independent audit workflow:
- Claude writes/fixes code and pushes.
- ChatGPT independently audits read-only unless Arman explicitly authorizes code changes.
- Issue #28: TuTak — Independent Audit Findings.
- Do not blindly accept audit findings: verify against code and these business rules.
- If a finding requires a business decision, ask Arman before changing behavior.

Unresolved unless later explicitly decided by Arman:
- WEBSITE/domain verification method;
- industry min/max rate ranges;
- staff amount editing if legacy conflict exists;
- legacy data migration where safe transformation is impossible;
- accounting/tax treatment for expired deferred entitlement, revenue recognition, settlement/payout and promotional funding;
- payment-license implications if architecture crosses regulated stored-value/payment handling.

NOTE: This repository file is intentionally a compact pointer/canonical summary. The complete 571-line master context remains the authoritative detailed specification supplied by Arman on 2026-08-16. Claude should not infer missing business rules from this summary; when detail is absent, ask Arman or consult the full project context available in the working conversation.