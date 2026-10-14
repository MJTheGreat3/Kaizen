# Kaizen

A local-first personal life tracker for desktop (macOS, Windows, Linux) and Android. Small, consistent improvements every day.

Kaizen brings everything I want to track into one app, with all data stored on my own devices:

- **DSA / CP practice**: Codeforces and LeetCode sync, rating graphs, weak-topic analysis, revisit queue, contest reminders
- **Gym and sports**: workout logging, PRs, progressive-overload charts, sports sessions, body metrics
- **To-do, to-watch, to-read**: natural-language input with reminders
- **Finance**: monthly bank statement (CSV) import, auto-categorisation, insights and budgets
- **Habits and goals**: streaks, reminders, goals that track progress from other modules
- **Activity heatmap**: colour-coded per activity, with filters and streaks
- **Focus timer**: Forest-style, a tree grows while you stay focused
- **College timetable with attendance**: class reminders, one-tap attendance, bunk calculator; plus important dates and countdowns
- **Music**: Spotify playlists and playback control, top artists and tracks, local listening history
- **Sports following**: favourite NBA and football teams and players, fixtures, live scores, stats
- **Debt recorder**: who owes me and whom I owe, with when and why, partial repayments and bill splitting
- **Whiteboard and idea scrapbook**: free-form canvas and zero-friction capture
- **Universal search**: across everything, with a command palette

## Principles

- **Local-first**: encrypted SQLite on each device, works fully offline
- **Private sync**: laptop and phone sync end-to-end encrypted through a hidden Google Drive folder, or directly over LAN / Tailscale
- **Single user**: no accounts, no servers

## Stack

Tauri 2 (Rust) · React · TypeScript · Tailwind CSS · SQLite + SQLCipher

## Status

Phases 0 and 1 are done: encrypted storage, unlock and backups, plus Lists, Debts, Ideas, Habits, Calendar (timetable, attendance, important dates), notifications and the Today dashboard. Phase 2 is done too: end-to-end encrypted sync between laptop and phone through Google Drive or directly (LAN / Tailscale), with background sync on Android. Phase 3 is done as well: a Forest-style focus timer (strict mode and Do Not Disturb on Android), the activity heatmap with streaks, universal search with a command palette, and goals. Phase 4 adds Practice: solves, ratings, topics and contests from Codeforces, LeetCode, AtCoder and CodeChef, plus GitHub contributions (on the heatmap), recent repositories and issues. Phase 5 adds Sports (logged sessions, NBA, football and cricket teams to follow, and up to five favourite players with season and career stats) and Gym (live workout logging with a rest timer, routines, personal records and progress per exercise, weekly volume per muscle, and body metrics with encrypted progress photos). See [PLAN.md](PLAN.md) for the design and roadmap.

## Development

### Requirements

- Node 20+ and pnpm
- Rust (stable) with `clippy` and `rustfmt`
- For Android: Android Studio with SDK platform 36, NDK, command-line tools, and JDK 17 or 21

Android environment (in `~/.zshrc`):

```sh
export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/<version>"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
# The vendored OpenSSL (for SQLCipher) needs LLVM's ar/ranlib from the NDK
export AR_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-ar"
export RANLIB_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-ranlib"
rustup target add aarch64-linux-android
```

### Google Drive sync (one-time setup)

Sync goes through the hidden app folder of a Google account you choose, so the build needs your own Google OAuth client. It is free and needs no billing account. Using the Google account that will hold the sync data:

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project (e.g. "Kaizen").
2. **APIs & Services → Library**: enable the **Google Drive API**.
3. **Google Auth Platform → Branding** (or "Get started"): app name `Kaizen`, your email as support and contact email, audience **External**.
4. **Data access → Add or remove scopes**: add `.../auth/drive.appdata`, `openid` and `.../auth/userinfo.email`.
5. **Audience**: under Publishing status, click **Publish app** so it is **In production**. In "Testing", Google signs you out every 7 days.
6. **Clients → Create client**: application type **Desktop app**, name `Kaizen`. Copy the client ID and secret.
7. Add them to `~/.zshrc`, open a new terminal and rebuild (desktop and Android):

```sh
export KAIZEN_GOOGLE_CLIENT_ID="…apps.googleusercontent.com"
export KAIZEN_GOOGLE_CLIENT_SECRET="…"
```

Then in Kaizen: on the laptop, **Settings → Sync → Show code**; on the phone, **Settings → Sync → Join** and scan it. Connect the same Google account on both. When signing in, Google warns that it "hasn't verified this app": that is expected for your own app; choose **Advanced → Go to Kaizen**. On the phone, come back to Kaizen after signing in.

### Commands

| Task | Command |
|---|---|
| Install dependencies | `pnpm install` |
| Run the desktop app | `pnpm tauri dev` |
| Build an Android debug APK (arm64) | `pnpm android:build` |
| Install it on a USB-connected phone | `adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk` |
| Frontend tests / Rust tests | `pnpm test` / `pnpm test:rust` |
| Lint / format | `pnpm lint` / `pnpm format` |

### Layout

```
src/                  React frontend
  core/               db (Drizzle schema + client), security, shell, backups, theme
  modules/            one folder per module; registry.ts lists them
  components/ui/      shared UI components
src-tauri/            Rust backend
  src/db/             SQLCipher connection and migrations (schema source of truth)
  src/vault.rs        key derivation, wrapping and device unlock
  src/backup.rs       backup, restore and erase
  src/sync/           sync: per-cell clocks and merging, encrypted bundles, Drive and folder transports
  gen/android/        Android project
```
