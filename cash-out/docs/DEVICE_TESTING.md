# Device builds and the physical-device checklist

No build has been produced from this repository: EAS needs an Expo account,
an EAS project id (`eas init` writes it into `app.json` → `extra.eas.projectId`)
and, for iOS, an Apple Developer team with registered test devices. Nothing is
published to a store from these profiles.

## Producing the builds

```bash
cd apps/mobile
npx eas login                       # the Expo account that owns the app
npx eas init                        # writes extra.eas.projectId
npx eas device:create               # iOS: register each test iPhone (ad hoc)
npx eas build --profile internal --platform android   # .apk, installable directly
npx eas build --profile internal --platform ios       # ad hoc .ipa for registered devices
```

`internal` points the app at `EXPO_PUBLIC_API_BASE_URL` from `eas.json`;
change it to the staging API before building. `development` builds a dev
client that talks to a laptop's API (`10.0.2.2` on the Android emulator).

Install: Android — open the `.apk` (allow "unknown sources"); iOS — the
build page's QR code, on a registered device. Neither touches a store.

## The checklist

Run on at least one Android phone (with fingerprint) and one iPhone (with
Face ID), against a staging API in `mock` modes (no real money moves).
Record pass/fail per row per device.

| #   | Step                                      | Expected                                                                                                                                                      |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | First launch                              | Splash in emerald, then onboarding with the three languages in their own script                                                                               |
| 2   | Armenian / Russian / English              | Every screen in the chosen language; tab labels not truncated; Armenian glyphs render everywhere                                                              |
| 3   | OTP                                       | Phone entry with fixed +374; the code arrives (or, on staging mock, is read from the API log); autofill fills the boxes; wrong code shows an error and clears |
| 4   | One park                                  | After the code: the "your taxi park" screen for a moment, then home with that park's name and balance                                                         |
| 5   | Multiple parks                            | With a phone in two rosters: the chooser; picking one lands on home with its balance                                                                          |
| 6   | Park switch                               | Settings → Change taxi park → other park; balance reloads; nothing of the old park remains on screen                                                          |
| 7   | Balance refresh                           | Pull to refresh on Balance; "as of" time updates; airplane mode → stale-balance message, not a crash                                                          |
| 8   | Manual withdrawal (mock)                  | Amount → iDram destination → review with fees → PIN → processing → success; history shows it                                                                  |
| 9   | PIN                                       | Set PIN twice (mismatch handled); wrong PIN counted; five wrong → locked with a countdown                                                                     |
| 10  | Face ID                                   | Enable in Security (needs PIN); confirming a payout shows the Face ID prompt; success authorizes                                                              |
| 11  | Android biometric                         | Same with fingerprint; the Android prompt appears; success authorizes                                                                                         |
| 12  | Biometric cancel                          | Cancelling the prompt returns to the authorize screen without an error toast; nothing was sent                                                                |
| 13  | PIN fallback                              | "Use PIN" from the biometric screen works; on a phone with no biometrics the option is not offered                                                            |
| 14  | Automatic payout                          | Create a rule (PIN consent); the rule shows next check time; disable it; re-enable                                                                            |
| 15  | History                                   | Filters by period/type/status; details of a completed, a cancelled and an automatic operation                                                                 |
| 16  | Driver ID request                         | Submit a new id; the pending state shows; cancel it; history lists it                                                                                         |
| 17  | Light / dark                              | Appearance → dark: every screen, the tab bar and the status bar switch; contrast readable on OLED                                                             |
| 18  | Logout                                    | Settings → sign out → onboarding; back button does not return to home; tokens gone (re-launch asks for OTP)                                                   |
| 19  | App restart                               | Kill and reopen: language, theme and session persist; lands on home, not onboarding                                                                           |
| 20  | Background / foreground                   | Start a payout, background the app for a minute, return: the processing screen resumes polling and reaches its end state                                      |
| 21  | Network loss during payout                | Airplane mode after confirm: processing screen keeps waiting, no duplicate on retry; network back → final state                                               |
| 22  | Notifications settings                    | Toggles persist; the "test mode" note is shown while push is mock                                                                                             |
| 23  | Rooted / jailbroken device (if available) | The app runs; note that biometric secrets are only as safe as the keystore (docs/SECURITY.md)                                                                 |

Anything that fails goes to `docs/STATUS.md` before the next build.
