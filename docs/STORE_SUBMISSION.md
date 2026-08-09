# Getting TuTak into the App Store and Google Play

What the stores need, what this repository already provides, and what only
the owner can supply. Ordered by what blocks a submission soonest.

Nothing here has been submitted. Everything below is derived from Apple's and
Google's published requirements and from what the code actually does — no
review has been run, so treat it as a checklist rather than a guarantee of
approval.

---

## 1. Accounts, and what they cost

| | Apple | Google |
| --- | --- | --- |
| Programme | Apple Developer Program | Google Play Developer |
| Cost | **$99 / year** | **$25 once** |
| Needed before you can | install on a physical iPhone, TestFlight, submit | submit |

The Apple fee is not optional and not avoidable: a build can only be
installed on a real iPhone if that device is in a provisioning profile issued
by a paid account. There is no free path to testing on your own phone with a
development build.

A **company** account on either store needs a registered legal entity — for
Apple, a D-U-N-S number, which takes days to weeks to obtain. Start this
before you need it. An individual account is faster and puts your own name on
the listing.

---

## 2. Pages that must be reachable without installing the app

Both stores check these, and Google checks the deletion page specifically.

| Page | In this repository | Status |
| --- | --- | --- |
| Privacy policy | `public/privacy.html` | **Written, needs the operator's details and a legal review** |
| Account deletion | `public/account-deletion.html` | Written |
| Support contact | — | An email address is enough; it must be monitored |

`public/privacy.html` describes what the software genuinely does, and every
retention period in it is read from `apps/api/src/config/configuration.ts`
rather than invented. What it cannot do is be legally sufficient on its own:
replace `[OPERATOR]`, `[ADDRESS]` and `[CONTACT EMAIL]`, and have a lawyer
check it against Armenian data-protection law — and the GDPR too, if any user
is in the EU.

Host both pages at stable URLs. They are self-contained single files with no
external requests, so any static host will do. If either URL breaks later,
the app can be removed from the store.

---

## 3. Data safety declarations

Both stores make you declare what you collect, and both compare the
declaration against what the binary does. Getting this wrong is a common
rejection and, worse, an easy accusation of dishonesty.

What TuTak actually collects, from the schema and the code:

| Category | Collected | Linked to the user | Used for tracking |
| --- | --- | --- | --- |
| Phone number | yes | yes | no |
| Name | yes | yes | no |
| Email | optional | yes | no |
| Payment info | **token only, never a card number** | yes | no |
| Purchase history | yes | yes | no |
| Precise location | **no** | — | — |
| Contacts, photos, messages | **no** | — | — |
| Device identifier | yes (app-generated, not the IDFA) | yes | no |
| Diagnostics / crash data | yes, if error reporting is enabled | no | no |
| Advertising identifier | **no** | — | — |

Declare **"Data is not used to track you"** on both stores. There are no
advertising or analytics SDKs in the app; if one is ever added, this table
and both declarations must change with it.

Apple additionally wants a reason for each permission, and the app already
supplies one for the camera in `app.config.js` — "TuTak needs camera access
to scan QR codes for payments." Notifications are requested only after
sign-in, which is both better for acceptance rates and the honest ordering.

---

## 4. Assets

| Asset | Requirement | Status |
| --- | --- | --- |
| App icon | 1024×1024, no transparency, no rounded corners | `apps/mobile/assets/icon.png` |
| Android adaptive icon | foreground + background | `apps/mobile/assets/adaptive-icon.png` |
| Splash | — | `apps/mobile/assets/splash-icon.png` |
| iPhone screenshots | 6.7" and 6.5", 3–10 each | **Not produced** |
| Android screenshots | phone, 2–8 | **Not produced** |
| Feature graphic (Play) | 1024×500 | **Not produced** |
| Short description (Play) | ≤ 80 characters | **Not written** |
| Full description | ≤ 4000 characters | **Not written** |

Screenshots must come from a real build on a real device — `docs/screenshots`
holds development captures, which are useful for review but are not store
assets.

---

## 5. Review notes, and the account reviewers will need

Both stores reject an app whose main function they cannot reach. TuTak
requires a phone number, an SMS code and a merchant to pay, none of which a
reviewer has.

Provide, in the review notes:

- a **demo account** — phone and password — that is already verified, so the
  reviewer never waits for an SMS;
- that account **pre-loaded with points and history**, so the wallet and
  transaction screens are not empty;
- a **test QR code** as an image in the notes, or a merchant in a sandbox the
  reviewer can pay;
- one sentence saying the app is for Armenia and prices are in AMD.

`pnpm --filter @tutak/api exec node dist/scripts/seed-demo.js` builds exactly
this kind of account against a chosen database.

---

## 6. Things that will get it rejected

- **A privacy policy URL that 404s at review time.** Check it the morning of
  submission.
- **Declaring less than the app collects.** Payment history is collected and
  linked; say so.
- **A build pointing at `localhost`.** The `production` profile in
  `apps/mobile/eas.json` still contains `REPLACE_WITH_PRODUCTION_API_URL`.
  Replace it before building for the store, or the app installs and cannot
  reach anything.
- **A sandbox acquirer.** The app must transact against a real payment
  provider. `SandboxPspAdapter` refuses to load in production for exactly
  this reason, so this is a launch blocker, not a warning.
- **Apple's account-deletion rule.** An app with account creation must offer
  in-app deletion. It does — Settings → Delete account — and the reviewer
  should be pointed at it.
- **Login gating everything.** Apple dislikes an app that shows nothing until
  you sign up. Consider letting the map of partners and charging stations be
  browsed signed-out.

---

## 7. Order to do it in

1. Buy the Apple and Google accounts. The company verification is the long
   pole; nothing else can finish without it.
2. Fill in the privacy policy, get it reviewed, host both pages.
3. Sign the acquirer and the SMS provider, and point `production` at real
   URLs. Until this is done the app cannot take money and cannot ship.
4. Build with `eas build --profile production`, install it on a real device,
   and take the screenshots from that build.
5. Write the descriptions and fill in the data-safety forms.
6. Submit to TestFlight and an internal Play track first. Review the app as a
   stranger would before a reviewer does.
