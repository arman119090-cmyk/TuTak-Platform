# TuTak v2 — Android system UI and device QA

**Status:** mandatory implementation and release gate for the v2 customer mobile redesign.
**Applies to:** every customer screen, with special attention to the fixed bottom navigation, central QR action, forms and camera/QR screens.

## The failure this prevents

In the prior demonstration build, the app's bottom controls (including Home and QR) were visually below Samsung's Android navigation controls. A person could not reliably see or tap the app control without colliding with the system controls.

The current `MainTabNavigator` already calls `useSafeAreaInsets()` and adds `insets.bottom` on Android. This is useful existing code, **not evidence that the delivered build is correct**: no physical Samsung S25 acceptance capture or regression test proves it, and the v2 navigation will replace its visual shell.

## Non-negotiable layout rules

1. Do not hide Android's gesture pill or three-button navigation as a workaround. The system controls must remain usable.
2. Keep `SafeAreaProvider` at the app root and calculate every edge-to-edge control position from live safe-area insets. Do not substitute a guessed Samsung height.
3. The entire interactive area of every bottom-tab item — icon, label, selection state and the larger central QR control — must sit above the bottom system inset. The visual bar may extend behind the system area only if no tappable or readable app content does.
4. A custom/floating v2 tab bar must have one source of truth for its rendered height. Scrollable content and bottom sheets must clear the **actual rendered tab-bar height plus the relevant bottom inset**, not only the legacy fixed `layout.tabBarHeight` value. Use the React Navigation tab-bar measurement/inset API where appropriate; do not copy `84` into individual screens.
5. Header titles, back actions, notification actions and camera exit actions must also stay clear of the status-bar/cutout inset. The full-screen QR camera may draw visually behind a system bar, but its close/torch/permission/error controls may not be obscured by it.
6. The v2 customer product is light-only for this delivery. A new install and an existing install must enter the approved light v2 system, not the legacy dark default preserved in the current theme store/app config. Do not ship a partial second dark v2 theme or leave a persisted `dark` preference able to bypass the new design. Status- and navigation-bar icon contrast must match each screen background.
7. A route transition must not flash an unrelated black/white system-bar background or make system icons unreadable.

## Keyboard is a separate Android blocker

`KeyboardAwareScroll` currently documents a known compromise: the keyboard can cover a submit CTA on a short screen. It deliberately removed earlier Android `KeyboardAvoidingView` attempts because they flickered and made typing unstable on real handsets.

Therefore:

- do **not** blindly restore an old keyboard workaround because a simulator or unit test looks correct;
- diagnose and fix the final behaviour in a native Android build, preserving stable input focus and no scrolling loop/flicker;
- when the keyboard is open, the focused field and primary action must be reachable on Login, registration/OTP/recovery, purchase amount/discount and every changed profile/upload form;
- a first tap on a visible CTA must perform that CTA, not merely dismiss the keyboard.

## Required implementation checks

- Preserve and test safe-area behaviour in the shared app shell. Add a regression test that mounts the tab shell with both zero and a non-zero Android bottom inset; verify the rendered bottom-bar dimensions/clearance derive from the inset rather than a fixed device constant.
- When replacing the navigation, audit `Screen`, Home, Map/list sheets, Wallet/history, Referral Network, Profile forms, PurchaseIntent and Scan QR. Any absolute/floating footer, sheet or CTA needs an explicit safe-area/keyboard decision.
- Decide whether native Android navigation-bar configuration is needed for the v2 light surface, then verify it in a rebuilt native binary. Styling the Android bar is not a substitute for safe-area layout and is not reliable for gesture navigation, so the layout must be correct before any styling is applied.
- Keep source and demo navigation behaviour aligned. A demo build is not accepted if it imports a different bottom-bar implementation or omits the production insets behaviour.

## Physical-device acceptance matrix

Run the exact reviewed Android build on a physical **Samsung Galaxy S25** (or document the exact current Samsung equivalent if the S25 is unavailable) in both modes:

| Configuration | Required proof |
| --- | --- |
| Gesture navigation | Home, Map, QR, Wallet, Profile and Referrals show labels/actions above the gesture area; central QR is fully tappable. |
| Three-button navigation | The same six screens show no app label/icon/CTA underneath Back/Home/Recents. |
| Keyboard open | Login and PurchaseIntent amount/discount forms keep the focused field and primary CTA usable without flicker, repeated-jump or focus loss. |
| System font scale 130% | Bottom labels, long Russian/Armenian strings and large AMD values do not collide, clip or move behind system controls. |
| Camera/QR | Scan QR permission/error/exit controls remain reachable and readable with the real status and navigation bars present. |

Use a native installed build, not a cropped simulator image or an SVG board. Each proof screenshot/video must include the real status bar and the real bottom system navigation area. Record the device model, Android version, navigation mode, build commit SHA and pass/fail result in the PR.

## Release gate

The v2 redesign is not ready for review until the complete matrix above passes. A screenshot that crops out the system navigation area, a claim that safe-area code exists, or hiding the navigation bar does not satisfy this gate.
