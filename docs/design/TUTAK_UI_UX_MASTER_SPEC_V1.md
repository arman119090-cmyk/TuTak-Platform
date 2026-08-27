# TuTak UI/UX Master Specification v1

Status: DESIGN HANDOFF — implementation guidance for Claude. This document does not change financial/business rules.

## Product design direction
Mobile-first, clean and highly legible. White/light surfaces, restrained green success/primary accent, blue informational accent, dark navy text, subtle neutral borders and shadows. African Grey parrot is the TuTak brand mascot; use it selectively for brand/empty/success moments, never as visual clutter.

## Design tokens
- Primary green: #00B676
- Primary blue: #009DFF
- Dark text: #172033
- Neutral 700: #6B7280
- Neutral 300: #D1D5DB
- Neutral 100: #F4F7F8
- Success: #00C853
- Warning: #F5A623
- Danger: #EF4444
- Info: #2196F3
- Font: Inter or closest platform-safe equivalent
- Grid: 8px base
- Radius: 8 / 12 / 16 / 20 / 24 px
- Icons: simple outline, rounded caps/joins, consistent stroke

## Customer navigation
Primary bottom navigation: Home, Wallet, Scan, History, Profile. EV Charge may be surfaced as a Home quick action and dedicated flow.

## Customer screens
### 01 Home
Header/greeting, available discount balance, nearby partners, quick actions (Scan QR, Wallet, Referrals, EV Charge), referral promo, bottom navigation.

### 02 Scan Partner QR
Full-screen camera/scanner with clear scan frame, flashlight/gallery secondary actions, back navigation. No financial action occurs before partner identity is resolved.

### 03 New Purchase
Show immutable selected partner identity. Customer enters total bill amount and discount amount to use. Explicit derived value: amount customer pays. Primary CTA: Create Purchase. State clearly that partner confirms the purchase for non-integrated/manual flows.

### 04 Waiting for Confirmation
Show Purchase ID, strict 3-minute countdown, bill, requested discount, amount to pay, waiting message and cancel action. Expire automatically when timer reaches zero.

### 05 Confirmed
Large success state, total bill, discount applied, amount paid, updated discount balance, receipt CTA and Home action.

### 06 Rejected
Large rejection state, bill and requested discount, explanation that partner rejected, CTA to create a new purchase and Home action.

### 07 Expired
Warning/clock state, bill and requested discount, explanation that confirmation window expired, CTA to create new purchase and Home action.

### 08 Wallet
Prominent available discount balance, reserved/pending amount separately, total earned, transaction list with signed amounts and partner/source labels. Do not visually merge available and reserved funds.

### 09 Referrals
Referral invitation card, referral link/code with copy/share, friends invited, earned amount, invite CTA. Referral Challenge rewards follow backend business rules; UI must never invent eligibility.

### 10 Purchase History
Filter chips: All / Confirmed / Pending / Rejected / Expired. Each row shows partner, purchase ID/date, amount and unambiguous status.

### 11 Profile
Personal information, payment-related settings if supported, notifications, help/support and settings. Do not expose unsupported backend functionality as working UI.

## EV / roaming-CPO flow
Integrated EV charging is auto-finalized from trusted integration/session data; it does not require cashier confirmation.

### EV 01 Map
Map/list discovery, station availability summary, station card, Start Charging CTA.

### EV 02 Station Details
Station identity/photo, connector/power/pricing/availability data and Start Charging CTA.

### EV 03 Charging
Live charging status with SoC where available, energy, elapsed time, power and running cost. Stop Charging is visually destructive/secondary.

### EV 04 Finished
Success state with final energy and total cost, receipt CTA and Back to Map.

### EV 05 History
Charging sessions with station, date/time, energy/cost and completion state.

Self-dealing rule: affiliated owner/employee may use the station but must receive zero new reward/bonus from their own partner session; previously earned spendable balance is not blocked merely because the user is affiliated.

## Partner application
Primary areas: Dashboard, Sales/Purchases, Payouts/Settlement where supported, Integrations, Settings.

### Dashboard
Partner identity, sales/discount KPIs, pending confirmations, quick actions and recent activity.

### Pending Purchase
Show Purchase ID, customer identity as permitted, total bill, requested discount, amount partner receives, remaining timer, Confirm and Reject actions. Partner/cashier cannot silently edit customer-entered amount. Any future editable-amount flow requires explicit second customer confirmation.

### Confirm
Explicit confirmation screen/dialog summarizing financial values before final action.

### Reject
Explicit rejection screen/dialog; optional structured reason and note if backend supports them.

### Purchases
Filters and clear statuses. Pending items surface countdown/urgency without misleading animation.

## Partner Integrations
Every partner account has an Integrations section. Registry may include WEBSITE, API, POS, QR_PURCHASE, EV_CHARGING, OCPI according to backend capabilities/status.

Each integration card should show: type, status, short purpose, configuration/details entry point. Do not pretend an integration is functional merely because a PartnerIntegration registry record exists.

Manual/non-integrated purchases use partner confirmation. Trusted synchronized integrations such as a roaming-CPO partner or OCPI may auto-finalize from authenticated integration events/session data. Future POS/API auto-finalization requires a separately specified authenticated, idempotent event ingestion contract.

Partner website verification remains manual unless/until a technical verification mechanism is deliberately implemented.

## Web admin dashboard
Desktop shell with left navigation. Core views: overview KPIs, partners, customers, purchases, payouts/settlement, EV stations/integrations, referrals, reports, settings/audit where supported. Tables need search/filter/status, stable IDs, timestamps and drill-down. Financial/admin actions require confirmation and auditability.

## Component contract
Reusable components: PrimaryButton, SecondaryButton, DestructiveButton, TextInput/AmountInput, PartnerCard, TransactionRow, StatusBadge, KPI card, FilterChip, EmptyState, ConfirmationDialog, Countdown, BottomNavigation, IntegrationCard.

States must include default, pressed/focused where applicable, disabled, loading, success/error. Accessibility: adequate contrast, readable type, minimum comfortable touch targets, labels not encoded by color alone.

## Financial UI invariants
- All monetary values displayed in AMD unless backend explicitly provides another currency.
- Never present reserved/pending balance as spendable.
- Never infer settlement success solely from a UI status.
- Confirm/reject/expire states must map to backend state, not local optimistic fiction.
- 3-minute PurchaseIntent confirmation window is strict.
- Partner must not be able to silently change customer-entered purchase values.
- Negative/debt-related partner conditions and non-guaranteed/black-balance behavior must be represented explicitly when those backend states are surfaced; do not hide risk from the customer.

## Implementation rule for Claude
Treat this document as visual/interaction specification, not permission to redesign domain logic. Reuse existing backend contracts and state machines. Before implementing a screen, verify the required API/state exists. If it does not, document the gap instead of inventing a backend endpoint or financial rule. Keep business logic server-side; clients render server truth.

## Design QA checklist
For every implemented screen verify: loading, empty, error, offline/retry where relevant, long Armenian/Russian/English text, large AMD amounts, accessibility, small-device layout, destructive action confirmation, duplicate-tap protection, and server-state reconciliation.
