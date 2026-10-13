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

Phases 0 and 1 are done: encrypted storage, unlock and backups, plus Lists, Debts, Ideas, Habits, Calendar (timetable, attendance, important dates), notifications and the Today dashboard. Next is sync (Phase 2): Google Drive first, then LAN / Tailscale. See [PLAN.md](PLAN.md) for the design and roadmap.

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
  gen/android/        Android project
```
