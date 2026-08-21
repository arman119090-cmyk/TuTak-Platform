# TuTak v2 — partner branding and customer avatars

**Status:** implementation specification for the next Claude session.
**Decision recorded:** 2026-08-21, Arman.
**Scope:** official partner brand media, optional customer avatars, and their truthful display in customer-facing operations. This document adds no financial rule and does not change referral economics.

## 1. Product decision

TuTak must not show anonymous generic symbols where a customer is dealing with a real business.

1. **Partner brand.** A partner has an official square logo. It is a business identity, not a staff member's personal photo. A partner may also have an optional cover image for its catalogue/detail card.
2. **Customer avatar.** A customer may voluntarily upload, replace or delete a personal avatar. It is optional; initials remain the fallback everywhere.
3. **Where the partner logo appears.** Show the logo wherever the customer identifies a specific partner: catalogue/map card, partner detail, QR purchase preview, pending/confirmed/rejected/expired purchase state, Home recent operations, full transaction history, wallet source rows when the source is a partner, charging-session detail/history, and customer-visible refund/reversal rows.
4. **Customer-avatar privacy.** A customer's avatar is visible to that customer in Profile. It may be shown in the Level-1 referral list only when that person has actively consented. It must not be exposed to Levels 2/3, a partner's transaction list, an unrelated customer, or an admin API response that does not need it.
5. **No fake partner media.** A real partner's logo/cover must come from the partner or another authorised source. Do not use a web image, competitor image, or generated AI image as though it were a real business.

The platform administrator may upload, replace or remove a partner logo. A partner OWNER may submit a replacement, but it must remain non-public until a platform administrator confirms it. This prevents an owner account compromise from instantly changing a public business identity.

## 2. Data model and history integrity

Do not place the image bytes in PostgreSQL and do not store an arbitrary remote URL as the source of truth. Use an immutable metadata record plus object storage.

### 2.1 Media asset

Introduce a `MediaAsset` model with, at minimum:

- `id` (UUID);
- `kind`: `USER_AVATAR`, `PARTNER_LOGO`, `PARTNER_COVER`;
- `status`: `PENDING_REVIEW`, `ACTIVE`, `REPLACED`, `REVOKED`;
- owner references appropriate to the kind (`userId` and/or `partnerId`);
- opaque `storageKey` — never a caller-provided URL;
- safe delivery variants (`thumbnailKey`, `displayKey`) and dimensions;
- validated MIME type, byte size, SHA-256, created/approved/replaced timestamps and the approving administrator where applicable.

`User.avatarAssetId` is nullable. `Partner.logoAssetId` and `Partner.coverAssetId` are nullable. Every existing account and partner must continue working after the migration with the neutral initial/logo fallback.

### 2.2 Brand snapshots for operations

Showing a partner's *current* logo on an old financial record is not enough. A partner may rebrand, replace a mistaken file or later lose access to an asset. Historical operations must remain recognisable and internally consistent.

At PurchaseIntent creation, snapshot the partner display name and the then-active logo asset ID. The final customer transaction must carry the same snapshot (or a direct immutable link to the PurchaseIntent snapshot). Do the equivalent for an EV-session operation when it becomes a customer transaction. A refund/reversal must resolve to the source operation's snapshot.

The UI may use the current brand on a directory card, but it must use the operation snapshot in history/detail views. An old active/snapshotted asset is retained for the financial-record retention period; replacing a logo must never break prior rows.

## 3. Upload, storage and access rules

### 3.1 File acceptance

- Maximum original upload: **5 MB**.
- Accept JPEG, PNG and WebP only after inspecting the actual file bytes, not its filename or declared content type.
- Partner SVG source may be supplied to the platform, but the public app must never directly render untrusted SVG. Sanitize/rasterise it on the server into a safe PNG/WebP derivative before publication.
- Strip EXIF/location and other metadata. Generate a 1024 px display derivative and a 128 px thumbnail; preserve transparency for a PNG logo where useful.
- Reject animated formats, PDFs, arbitrary URLs, oversized dimensions, malformed images and files whose content does not match the accepted format.

### 3.2 Storage boundary

Create a provider-independent `MediaStorage` interface. Production must use durable object storage (S3-compatible storage is sufficient); tests use an in-memory fake. A local server directory is permitted only for local development and must never be enabled in production: it fails across replicas, backups and redeploys.

The API, not a client-supplied URL, owns the object key and delivery URL. Public partner-logo derivatives may be cached as immutable versioned assets. Customer avatars require an authorised delivery path; a referral response includes an avatar only if the Level-1 consent rule passes.

### 3.3 Authorisation and endpoints

Implement narrowly scoped endpoints rather than a generic, unbounded file bucket:

- `PUT /users/me/avatar` and `DELETE /users/me/avatar` — only the authenticated user;
- `PATCH /users/me/avatar-consent` — only the authenticated user; default is **false**, and it controls only the optional Level-1 referral-list rendering;
- `PUT /partners/:partnerId/logo` and `PUT /partners/:partnerId/cover` — partner OWNER submits, platform administrator may submit or replace;
- `POST /partners/:partnerId/media/:assetId/approve` — platform administrator only;
- `DELETE /partners/:partnerId/logo` / `cover` — platform administrator, retaining record-needed derivatives rather than hard-deleting history.

Every mutation must write an audit record with actor, partner/user target, asset ID and action. Do not accept an asset ID from another owner, and do not return private original-object keys to any client.

## 4. API contracts and UI use

Add media fields only to the responses that need them:

- the authenticated user's own profile returns `avatar`;
- `PartnerPublicDto`, `NearbyPartnerDto` and partner-detail responses return the active public `logo` and, where relevant, `cover`;
- `PurchaseIntentDto`, `TransactionDto`, EV-history/customer-operation DTOs and customer-visible refund rows return a safe `partnerBrand` snapshot (display name plus delivery-safe logo reference), never a raw storage key;
- the Level-1 referral DTO returns an optional avatar only when the referred person has consented; Levels 2 and 3 remain aggregate count-only.

On the mobile side, create one reusable `PartnerMark` component that renders a logo, loading/error state, and deterministic initial fallback. Create one `UserAvatar` component that uses the same safe fallback. Do not paste separate image-loading logic into each screen.

The Profile screen needs an explicit avatar control: choose image, preview, save, replace, remove, loading/error state and a short privacy explanation. It must not falsely show success until the server has stored the derived asset.

## 5. Required implementation order

1. Complete and verify the already queued 3-level referral engine in `docs/NEXT_CLAUDE_TASK.md` first. Do not mix its financial changes with media work.
2. Add the migration, media-storage abstraction, secure validation/derivatives and automated tests.
3. Add authorised upload/approval/delete endpoints and audit logging.
4. Extend DTOs and add immutable operation snapshots, including the appropriate backfill-safe nullable migration.
5. Build the partner/admin media management controls, then the customer Profile avatar control.
6. Add `PartnerMark`/`UserAvatar` and wire all customer-facing operation surfaces listed in §1.
7. Capture real screenshots and run the full test suite. Existing partners without assets must show a neutral fallback — never a broken image.

## 6. Verification gate

Before this is marked complete, demonstrate all of the following:

- a customer can upload, replace and remove only their own avatar;
- a partner OWNER cannot publish a submitted logo without administrator approval, and cannot edit another partner's media;
- invalid, disguised, over-limit and metadata-bearing images are rejected or safely processed;
- a missing/failed image has a visible fallback at 360dp Android and 390pt iPhone widths;
- a partner logo appears on every customer-facing operation surface named in §1;
- after a partner replaces its logo, an already-created PurchaseIntent and completed transaction still display their historical brand snapshot;
- an L1 avatar appears only with consent, and no L2/L3 API or UI path exposes an indirect person's avatar or identity;
- full API/mobile/partner/admin tests pass, including migrations and authorisation tests.

## Explicit non-goals

- No social feed, public user profiles, user-to-user photo browsing or avatar search.
- No partner image generated by AI or scraped from the web.
- No image upload in financial payloads or ledger metadata.
- No direct browser/mobile write access to a storage bucket without server-side authorisation and validation.
