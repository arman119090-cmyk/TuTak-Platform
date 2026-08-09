# TuTak mobile — running it on a real iPhone from Windows

Everything below is written for **Windows 11 + PowerShell + a physical iPhone**.
Commands are copy-paste; nothing here asks you to edit a source file by hand.

---

## The one rule that fixes most errors

> **Every `expo` and `eas` command runs from `apps\mobile`, never from the repository root.**

This is a pnpm workspace. The `expo` package is a dependency of the mobile app,
not of the repository, so from the root it genuinely does not exist:

```
PS C:\TuTak-Platform>            node -e "require.resolve('expo')"   # MODULE_NOT_FOUND
PS C:\TuTak-Platform\apps\mobile> node -e "require.resolve('expo')"  # resolves
```

That is the whole explanation for **"The `expo` package was not found"**.

---

## Why Expo Go says the project is incompatible — and why updating it will not help

Expo Go is a single pre-built app. It contains one fixed set of native modules,
compiled for one SDK version. TuTak needs native code that Expo Go does not
carry:

| module | what it is for |
| --- | --- |
| `expo-camera` | scanning payment QR codes |
| `expo-notifications` | push notifications |
| `expo-secure-store` | Keychain storage for the refresh token |
| `expo-font` | the icon set |

No version of Expo Go will ever run this app. That is not a misconfiguration —
it is what Expo Go is. The supported way to run an app with its own native
modules is a **development build**: the same Expo developer experience (QR code,
fast refresh, dev menu), in an app compiled with *your* native modules.

**On Windows you cannot compile for iOS locally.** Building an iOS app requires
Xcode, and Xcode only runs on macOS. So the iPhone path is **EAS Build**, which
compiles on Expo's Mac machines in the cloud. That is not a workaround; for
Windows it is the only route.

---

## Step 0 — prerequisites (once)

```powershell
node -v                     # must print v20 or newer
corepack enable
corepack prepare pnpm@10.33.0 --activate
```

An **Expo account** (free — sign up at https://expo.dev) and, for installing on
a physical iPhone, an **Apple Developer Program membership** (paid, $99/year).
The Apple membership is Apple's requirement, not TuTak's: an app can only be
installed on a real iPhone if that specific device is listed in a provisioning
profile issued by a paid account.

## Step 1 — install the workspace (once, from the repository root)

```powershell
cd C:\path\to\TuTak-Platform
pnpm install
```

## Step 2 — move into the app and stay there

```powershell
cd apps\mobile
```

## Step 3 — link the project to your Expo account

```powershell
npx eas-cli@latest login
npx eas-cli@latest init
```

`eas init` prints a **Project ID** and then warns that it cannot write it into
the config, because `app.config.js` is a dynamic config and EAS only edits
`app.json`. Store it with this command — paste your own ID in place of the
placeholder:

```powershell
node -e "require('fs').writeFileSync('eas-project.json', JSON.stringify({ projectId: process.argv[1] }, null, 2) + '\n')" 00000000-0000-0000-0000-000000000000
```

Check that the config picked it up:

```powershell
npx expo config --type public | findstr projectId
```

(If you would rather not keep a file, setting an `EAS_PROJECT_ID` environment
variable works identically — `app.config.js` reads either.)

## Step 4 — register your iPhone with Apple

```powershell
npx eas-cli@latest device:create
```

Choose the website/QR option, open the link **on the iPhone**, and install the
profile it offers (Settings will prompt you to finish installing it). This is
what puts your device UDID into the provisioning profile.

## Step 5 — build the development client in the cloud

```powershell
npx eas-cli@latest build --profile development --platform ios
```

Answer the credential prompts by letting EAS generate and manage everything —
say yes when it offers to handle your Distribution Certificate and Provisioning
Profile. The build takes roughly 10–25 minutes. When it finishes, EAS prints a
QR code and a link: open that **on the iPhone** and install the app.

You only repeat step 5 when native dependencies change. Ordinary JavaScript and
UI changes do not need a rebuild.

## Step 6 — start the API, then the bundler

The app needs the backend. From the repository root, in a **separate** terminal:

```powershell
cd C:\path\to\TuTak-Platform
pnpm docker:up
pnpm --filter @tutak/api dev
```

Then back in `apps\mobile`:

```powershell
npx expo start --dev-client
```

Open the freshly installed **TuTak** app on the iPhone (not Expo Go) and scan
the QR code, or pick the running server from the app's launcher screen.

### About `localhost`

The development build is configured to talk to `http://localhost:4000/v1`. On a
real phone `localhost` is the phone itself, so the app resolves the address at
runtime instead: it takes the host your iPhone just downloaded the bundle from —
your laptop's LAN address — and uses that. **You do not need to find or type an
IP address.** Staging and production URLs are never rewritten.

Two things this requires:

- **The phone and the laptop must be on the same Wi-Fi**, and it must not be a
  guest network that isolates clients.
- **Windows Firewall must let node through** on the private network. Windows
  asks the first time you run `expo start`; click *Allow access*. Ports 8081
  (Metro) and 4000 (API) need to be reachable.
- iOS will ask for **Local Network** permission the first time. Allow it.

If the Wi-Fi will not cooperate, this routes through Expo's relay instead:

```powershell
npx expo start --dev-client --tunnel
```

---

## Running the web version

```powershell
cd apps\mobile
npx expo start --web
```

or, for a static build you can serve anywhere:

```powershell
npx expo export --platform web
```

The **`ExpoSecureStore.default.getValueWithKeyAsync is not a function`** error is
fixed. It happened because `expo-secure-store` is an iOS/Android native module
with no browser implementation, and the app called it during startup — before
the first screen, which is why you saw the logo and nothing else. Token storage
now has two separate implementations and Metro picks the right one per platform;
the native module is no longer part of the web bundle at all.

**The web build is a development convenience, not a product.** In a browser the
session lives in `localStorage`, which any script on the page can read — nothing
like the iOS Keychain. Use it to look at screens on a laptop. Ship to phones.

---

## Do not run `npx install-expo-modules`

That command retrofits Expo modules into a **bare** React Native project. This
is a managed Expo project; it already has them. Run from the repository root it
fails to find `react-native` for the same reason `eas` failed to find `expo` —
wrong directory — and run from `apps\mobile` it would try to modify a project
that does not need it.

## Health check

```powershell
cd apps\mobile
npx expo-doctor
```

---

## Error → cause → fix

| what you saw | why | fix |
| --- | --- | --- |
| "Проект несовместим с этой версией Expo Go" | The app has native modules Expo Go does not contain. No Expo Go version will work. | Development build — steps 3–6. |
| "The `expo` package was not found" | Command run from the repository root. | `cd apps\mobile` first. |
| `npx install-expo-modules` cannot find react-native | Wrong directory, and the wrong command for a managed project. | Do not run it. |
| Only the TuTak logo on web, `getValueWithKeyAsync is not a function` | A native-only module was called in a browser during startup. | Fixed in the code; re-run `pnpm install` and `npx expo start --web`. |
| App installs, every request fails | Phone cannot reach the API. | Same Wi-Fi, allow node through Windows Firewall, allow the iOS Local Network prompt, or use `--tunnel`. |

---

## Commands, in order, with nothing else

```powershell
# once
cd C:\path\to\TuTak-Platform
pnpm install
cd apps\mobile
npx eas-cli@latest login
npx eas-cli@latest init
node -e "require('fs').writeFileSync('eas-project.json', JSON.stringify({ projectId: process.argv[1] }, null, 2) + '\n')" YOUR_PROJECT_ID
npx eas-cli@latest device:create
npx eas-cli@latest build --profile development --platform ios

# every session
pnpm docker:up                                   # from the repository root
pnpm --filter @tutak/api dev               # from the repository root, separate terminal
cd apps\mobile; npx expo start --dev-client      # then scan the QR with the TuTak dev app
```
