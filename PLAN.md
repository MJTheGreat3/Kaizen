# Kaizen — Personal Life Tracker

A single-user, local-first app that runs on every laptop OS (macOS, Windows, Linux) and on my phone. It tracks practice, fitness, tasks, money, habits and ideas in one place. All data stays on my own devices.

Status: planning (updated 2026-10-13)

**Decisions so far**
- Phone: **Android** (no iOS build planned).
- Bank statements: **CSV** import.
- Sync: **LAN peer-to-peer** between laptop and phone.
- Frontend framework: **React** (see section 4.2).
- LLM: rule-based parsing everywhere; LLM runs on the laptop only and the phone uses it over LAN (see section 4.6).

---

## 1. Goals and principles

- **One app, every device.** The same codebase and UI on desktop and mobile.
- **Local-first.** Data lives in a local database on each device. The app works fully offline. Network is used only to reach external APIs (Codeforces, LeetCode) and to sync between my own devices.
- **Single user.** No accounts, no multi-tenant backend, no auth server. One encryption passphrase protects the data.
- **Beautiful and fast.** Keyboard-driven on desktop, thumb-friendly on mobile, dark/light themes, smooth animations, opens in under a second.
- **Capture first, organise later.** Adding anything (task, idea, expense, set) should take under 5 seconds.
- **My data is portable.** One-click export to JSON/CSV/Markdown and automatic encrypted backups.

---

## 2. Modules

### 2.1 DSA / Competitive Programming tracker

**What it does**
- Pulls my solved problems, submissions, contest history and rating from Codeforces and LeetCode.
- Shows rating graphs, solved count by difficulty and tag, daily heatmap, streaks.
- Weak-topic analysis: tags where my acceptance rate or solve count is low.
- Manual log for problems from other sources (AtCoder, CSES, books) with notes, solution link and "time taken".
- Revisit queue: spaced repetition for problems I want to redo (resurfaces after 1, 3, 7, 21 days).
- Upcoming contest calendar with reminders through the notification system.

**Data sources**
- Codeforces official public API (no key needed for public data):
  - `user.info`, `user.rating`, `user.status` (all submissions), `contest.list` (upcoming contests).
- LeetCode: no official public API. Use the GraphQL endpoint `https://leetcode.com/graphql` that the website uses (queries such as `userProfile`, `recentAcSubmissionList`, `userContestRankingHistory`, `upcoming contests`). It is unofficial and may change, so wrap it in an adapter that fails gracefully.
- Optional later: AtCoder (via community APIs like kenkoooo AtCoder Problems), CodeChef.

**Sync strategy**: incremental fetch on app open and every few hours; store raw submissions locally so analytics work offline.

### 2.2 Gym and sports tracker

**Gym**
- Exercise library (preloaded + custom) with muscle groups.
- Workout templates / routines (e.g. Push-Pull-Legs).
- Live workout logging: sets, reps, weight, RPE, rest timer.
- Personal records, estimated 1RM, volume per muscle group per week, progressive-overload charts.
- Body metrics: weight, body-fat %, measurements, progress photos (stored locally).

**Sports**
- Log sessions (football, badminton, running, cycling, etc.): duration, intensity, distance, score/result, notes.
- Weekly activity summary and trends.

**Possible integrations (later)**: Health Connect (Android) for steps, sleep, heart rate and imported workouts.

### 2.3 Lists: To-do, To-watch, To-read (with natural language)

**Natural language input**, for example:
- "Submit OS assignment friday 5pm #college !high" becomes a task due Friday 17:00, tag `college`, priority high.
- "watch Dune part two" goes to the To-watch list.
- "read Designing Data-Intensive Applications" goes to the To-read list.
- "remind me to call mom every sunday at 8pm" becomes a recurring task with a notification.

**How**
- Layer 1 (always local, instant): rule-based parser plus a date parser library (e.g. `chrono-node`) for dates, times and recurrence; `#tags`, `!priority`, `@list` syntax.
- Layer 2 (optional): an LLM for messier input and for classifying which list an item belongs to. Can be a local model (Ollama on the laptop) or the Claude API as an opt-in.
- To-watch / To-read enrichment (optional): fetch posters, runtime, authors and page counts from TMDB / Open Library.

**Features**: subtasks, recurring tasks, snooze, today/upcoming/someday views, progress for books (page or %), rating and notes when finished.

### 2.4 Finance tracker

**Flow**
1. Each month, upload the bank statement (CSV, XLSX or PDF).
2. Parser extracts transactions (date, description, amount, debit/credit, balance).
3. Transactions are de-duplicated and auto-categorised (food, rent, travel, subscriptions, UPI transfers, etc.).
4. I review and fix categories; the app learns from corrections (merchant-to-category rules).
5. Dashboard and insights are produced.

**Parsing (CSV)**
- First import of a bank's CSV opens a mapping screen: pick which columns are date, description, debit, credit, balance, and the date format. Saved as a per-bank profile, so later imports are one click.
- Handles common quirks: header rows above the table, separate debit/credit columns vs a single signed amount, `Dr`/`Cr` suffixes, Indian number formatting (`1,23,456.78`).
- Duplicate detection on (date, amount, description, balance) so overlapping statements can be re-imported safely.
- PDF/XLSX support can be added later if a bank only offers those.

**Insights**
- Monthly income vs expense, savings rate, category breakdown, month-over-month change.
- Recurring payments and subscriptions detection.
- Unusual transactions (much bigger than normal for that merchant/category).
- Budgets per category with alerts through the notification system.
- Net-worth snapshot (manual entries for investments, FDs, etc.).
- Plain-language monthly summary ("You spent 32% more on food delivery than last month").

**Security**: finance data is encrypted at rest; never leaves my devices unless I opt into the LLM for a specific action.

### 2.5 Habit monitor

- Define habits with a target: daily, X times per week, or a quantity ("8 glasses of water", "30 min reading").
- Check-in from a notification, home-screen widget or the app.
- Streaks, completion heatmap, success rate.
- Goals: longer targets made of habits and metrics, e.g. "Reach CF Expert by March" or "Bench 100 kg", that can auto-track progress from other modules.
- Reminders via the notification system, with smart timing (only nudge if not yet done today).

### 2.6 Scratchpad / Whiteboard

- Infinite canvas for freehand drawing, shapes, arrows, text and images.
- Pen support on tablets/phones, mouse/trackpad on desktop.
- Multiple boards; export to PNG/SVG.
- Built on an embeddable whiteboard library (Excalidraw is the leading candidate; tldraw is an alternative).

### 2.7 Idea scrapbook

- Zero-friction capture: open app, type, done. No due dates, no structure required.
- Text (Markdown), images, links, voice notes, quick sketches.
- Optional tags, pin, colour; masonry/card layout.
- "Resurface" a random old idea occasionally.
- Promote an idea into a task, a whiteboard or a goal.

### 2.8 Notification service (shared)

Used by tasks, habits, contests, budgets and goals.

- Local scheduled notifications on both phone and desktop (no push server needed).
- Desktop: app runs in the system tray / menu bar so reminders fire while the window is closed.
- Android: notifications scheduled with `AlarmManager` fire even when the app is closed. Android 12+ needs the exact-alarm permission (`SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`) for on-time reminders, and the app should ask to be exempted from battery optimisation so OEM skins (MIUI, OneUI, ColorOS) do not kill it.
- Actionable notifications where supported ("Done", "Snooze 15 min").
- Quiet hours and a daily digest ("Today: 3 tasks, 2 habits, 4 classes, CF Round at 20:05").

### 2.9 Activity heatmap and streaks

A GitHub-style calendar heatmap covering everything I do, plus streaks per activity.

**Activity types and colours** (each with its own colour ramp, light to dark by intensity):

| Type | Colour | Intensity measured by |
|---|---|---|
| DSA / CP | green | problems solved (weighted by difficulty, optional) |
| Gym | orange | sessions / total volume |
| Sports | blue | minutes active |
| Focus | teal | focus minutes |
| Habits | purple | % of habits completed |
| Reading | amber | pages / minutes read |
| Tasks | grey | tasks completed |
| Classes | pink | attendance % for the day |

Colours and the type list are configurable; custom habits can be shown as their own type.

**Views and filters**
- **Single type**: one heatmap in that type's colour.
- **Combined**: each day cell shows the dominant activity colour, or a split cell (up to 4 segments) for days with several activities; intensity normalised per type so one heavy type does not wash out the others.
- Filters: toggle activity types on/off, choose range (last 30 days, 3 months, year, custom), filter by tag (e.g. only `#college` tasks, only CF problems rated 1600+).
- Hover/tap a day for a breakdown ("3 CF problems, 1 h gym, 2 h focus, 5/6 habits"), click to open that day's full log.
- Weekly and monthly totals beside the grid; year-over-year comparison.

**Streaks**
- Per activity: current streak, longest streak, start date, and a completion rate.
- Each type defines what counts as an "active day" (e.g. at least 1 problem solved, at least 25 focus minutes).
- Frequency-based streaks for things that are not daily, e.g. gym streak counted in weeks with at least 4 sessions.
- Planned rest days and a limited number of "streak freezes" per month, so a sick day does not reset everything.
- Overall "active day" streak across all types.
- Milestone notifications (7, 30, 100 days) and an "about to break your streak" nudge in the evening.

**Implementation**: every module writes to a shared `activity_events` table (type, date, quantity, source_id). The heatmap and streak calculations read only from that table, so adding a new module automatically adds it to the heatmap.

### 2.10 Universal search and command palette

- `Ctrl/Cmd+K` on desktop, search bar plus a swipe-down gesture on Android.
- Searches everything: tasks, watch/read items, ideas, journal, whiteboard text, CP problems (title, tags, my notes), workouts and exercises, transactions (merchant, notes, amount), habits, important dates, timetable subjects.
- Typo-tolerant prefix and fuzzy matching; results grouped by module with highlighted matches.
- Filter syntax: `in:finance swiggy`, `tag:college`, `before:2026-09-01`, `amount:>500`.
- Same palette also runs commands: "new task", "start focus", "log workout", "go to finance".
- Recent searches and recently opened items.

**Implementation**: SQLite FTS5 full-text index (works inside SQLCipher), with a trigram tokenizer for fuzzy/substring matches. Each module updates the index through triggers when its rows change. Whiteboard text elements are extracted and indexed on save.

### 2.11 Important dates and college timetable

**Important dates**
- Birthdays, anniversaries, exam dates, fee deadlines, subscription renewals, document expiry (passport, licence, insurance).
- Yearly / monthly / one-off recurrence; birthdays can show age.
- Reminders at chosen offsets (e.g. 7 days, 1 day and same morning).
- Countdown cards on the Today dashboard ("Endsem in 12 days").

**College timetable**
- Weekly grid of slots: subject, type (lecture / lab / tutorial), time, room, professor, colour.
- Semester start and end dates, holidays and one-off changes (cancelled or extra classes) as exceptions.
- Support for alternating weeks (odd/even) and batch-specific labs.
- Entry: manual grid editor, or import from CSV.
- Notification before each class (configurable, e.g. 10 min before, with room number).
- Today dashboard shows current and next class; Android home-screen widget shows the day's classes.
- **Attendance tracking**: mark present/absent/cancelled per class (from the notification or the app). Shows attendance % per subject, the minimum-attendance target (e.g. 75%), and "you can skip N more" / "you must attend the next N".
- Exams and assignment deadlines can be linked to a subject and appear in both the timetable and the to-do list.

### 2.12 Focus timer (Forest-style)

Inspired by the Forest app: a growing plant represents the focus session, and leaving to use distracting apps kills it.

- Start a session: choose duration (Pomodoro 25/5, 50/10, or custom), optional task or tag (DSA, study, project), optional plant species.
- A tree grows on screen as time passes (animated stages from seed to full tree).
- **Strict mode on Android**: if I switch to a non-allowlisted app during a session, I get a warning notification and a short grace period (e.g. 10 seconds) to return before the tree withers. Needs the Usage Access permission (`PACKAGE_USAGE_STATS`) and a foreground service, written as a small Kotlin plugin for Tauri.
- Desktop: tree withers if the window loses focus for more than the grace period (optional), plus optional website/app blocklist reminders.
- **My forest**: each completed session plants a tree in an isometric forest view per day/week/month; withered trees stay visible as dead trees.
- Coins or growth points earned per focus minute unlock new tree species and forest themes.
- Stats: focus time per day, per tag, per task; best time of day; longest session.
- Focus minutes feed the activity heatmap (2.9) and can automatically count toward habits (e.g. "2 h deep work daily").
- Ongoing notification with remaining time and pause/give-up actions; "Do not disturb" toggled automatically on Android (with permission).

---

## 3. Suggested extra modules

Ordered by how much value I think they add:

1. **Today / Dashboard**: one home screen combining today's classes, tasks, habits, workout plan, upcoming contests and important dates, spending this month and a random idea.
2. **Global quick capture**: system-wide hotkey on desktop, share-sheet and widget on Android; natural language decides which module receives the item.
3. **Journal and mood log**: short daily entry plus mood/energy score, correlated with habits, sleep and workouts.
4. **Weekly / monthly review**: auto-generated report of what I did (problems solved, workouts, focus hours, money spent, habits kept, attendance) with space for reflection.
5. **Sleep and health metrics**: manual or via Health Connect.
6. **Learning / course tracker**: courses, lectures, notes, flashcards (spaced repetition).
7. **Cross-module insights**: e.g. "On days you work out you solve 40% more problems".

---

## 4. Proposed architecture

### 4.1 App framework

**Recommended: Tauri 2 + TypeScript web frontend (React or Svelte)**

- One codebase builds desktop apps (macOS, Windows, Linux) and the Android app.
- Android-only native pieces (home-screen widgets, usage-stats for focus strict mode, foreground service) are written as small Kotlin plugins; Tauri 2 supports this directly.
- Small binaries and low memory compared with Electron.
- Rust backend for heavy/secure work (PDF parsing, encryption, sync, API fetching).
- Official plugins for SQLite, notifications, file system, global shortcuts, system tray, biometrics.
- The web frontend gives access to the best UI and charting libraries (Excalidraw, Recharts/ECharts, Framer Motion).

**Alternatives considered**
- *Flutter*: excellent mobile UI and performance, one codebase; weaker whiteboard/library ecosystem and Dart only.
- *Electron + Capacitor*: very mature, but two shells to maintain and heavier on desktop.
- *PWA only*: simplest, but iOS limits on notifications, background work and storage make it unreliable.

### 4.2 Frontend stack

**React vs Svelte**

| | React | Svelte 5 (SvelteKit in SPA mode) |
|---|---|---|
| Ecosystem | Largest by far; almost every library ships a React component | Smaller; many libraries need wrappers or vanilla-JS versions |
| Excalidraw | Official React component, drop-in | No official wrapper; must mount React inside Svelte (works, adds React to bundle) |
| UI kits | shadcn/ui, Radix, Mantine, many more | shadcn-svelte, Bits UI, Skeleton (good, fewer choices) |
| Charts | Recharts, Nivo, visx, ECharts | LayerChart, ECharts, Chart.js (fine, fewer native options) |
| Animation | Framer Motion (best in class) | Built-in transitions/animations, very easy, less advanced than Framer Motion |
| Code size / boilerplate | More: hooks, `useState`, `useEffect`, memoisation | Less: plain variables with runes (`$state`, `$derived`), less code per feature |
| Performance | Virtual DOM; good, needs care in big lists | Compiled, no virtual DOM; faster and smaller bundles by default |
| Learning curve | Moderate; hook rules and re-render pitfalls | Gentle; feels like HTML + JS |
| AI/tooling help, examples | Most training data and examples | Less, and Svelte 5 runes are newer so older examples are outdated |
| Job/market value | Highest | Lower, growing |

**Decision: React.** The deciding factors are Excalidraw (official React component), Framer Motion for the polished feel, and the much larger choice of ready-made components and charts. Svelte would produce a slightly faster, leaner app with less code, which matters less here because Tauri already keeps the app light and the data volumes are small. Svelte is the better pick only if I specifically want the simpler syntax or want to learn it.

**Stack**
- TypeScript, React (or Svelte), Vite.
- Tailwind CSS + shadcn/ui (or similar) for a polished, consistent design system.
- Framer Motion for animation.
- Charts: Recharts or ECharts.
- Whiteboard: Excalidraw.
- Rich text / Markdown: TipTap or Milkdown.
- Dates: `chrono-node` for natural-language parsing, `date-fns` for everything else.

### 4.3 Storage

- **SQLite** on every device, owned by the Rust side (`rusqlite` with the `bundled-sqlcipher` feature, since the official Tauri SQL plugin does not support SQLCipher). The frontend sends queries through one Tauri command and gets typed results via Drizzle ORM's `sqlite-proxy` driver, so schema and queries are written in TypeScript.
- **Encryption at rest**: SQLCipher, key derived from a passphrase and stored in the OS keychain/keystore; biometric unlock on mobile.
- **Files** (progress photos, statement PDFs, voice notes, whiteboard images) in the app data directory, referenced from SQLite.
- **Backups**: automatic encrypted snapshot (daily/weekly) to a folder I choose; manual export to JSON/CSV/Markdown.

### 4.4 Syncing laptop and phone (the key design decision)

"Everything local" plus "laptop and phone" means each device has its own copy and they must sync. Options:

| Option | How | Pros | Cons |
|---|---|---|---|
| A. Peer-to-peer LAN sync | Devices discover each other on the same Wi-Fi (mDNS) and exchange changes | Truly no cloud | Syncs only when both are on the same network |
| B. Encrypted file in my own cloud folder | Write encrypted change logs to iCloud Drive / Google Drive / Dropbox folder | Works anywhere, no server to run | Mobile folder access is fiddly; conflict handling needed |
| C. Tiny self-hosted relay | Small sync server on a home machine/VPS sees only encrypted blobs | Works anywhere, simplest client logic | Something to host |

**Decision: A (LAN sync).** The data layer stays transport-agnostic so **C** can be added later without changes.

**LAN sync details**
- Discovery: mDNS / DNS-SD (Android `NsdManager`, desktop via the Rust `mdns-sd` crate).
- Pairing: one-time QR code shown on the laptop and scanned by the phone, exchanging device IDs and a shared key. Unpaired devices on the network are ignored.
- Transport: encrypted connection (Noise protocol or TLS with pinned keys) between paired devices only.
- When it runs: on app open, on a manual "Sync now", and periodically while both devices are awake on the same Wi-Fi. Android restricts background networking, so background sync uses `WorkManager` and may be delayed; foreground sync is instant.
- Optional: a phone hotspot or USB connection also counts as LAN, so syncing works away from home.

**Conflict handling**: each row carries an ID (UUIDv7), `updated_at`, `device_id` and a soft-delete flag; changes are recorded in a change log and merged last-writer-wins per field. Rich documents (whiteboards, long notes) use a CRDT (Yjs or Automerge) so edits from both devices merge cleanly. A library such as cr-sqlite or a sync engine like PowerSync/ElectricSQL can replace the hand-rolled version if it proves too complex.

### 4.5 External integrations

| Integration | Purpose | Notes |
|---|---|---|
| Codeforces API | Submissions, rating, contests | Official, public, rate limited (about 1 request / 2 s) |
| LeetCode GraphQL | Submissions, contests | Unofficial, may break; keep adapter isolated |
| TMDB / Open Library | Metadata for to-watch / to-read | Optional, free API keys |
| LLM (Ollama on laptop; Claude API maybe later) | NL parsing fallback, finance categorisation, summaries | Laptop-hosted, phone uses it over LAN (see 4.6) |
| Health Connect (Android) | Steps, sleep, workouts | Later phase |

### 4.6 LLM strategy

On-device models on the phone are large: roughly 0.7–1 GB for a 1–1.5B parameter model (4-bit quantised) and about 2 GB for a 3B model, plus noticeable RAM use, battery drain and slower responses. Small models are also weaker at the messy cases where an LLM is actually needed.

Plan:
1. **Rule-based parser everywhere** (chrono-node + `#tag` / `!priority` / `@list` syntax). Instant, offline, zero download. Handles most input.
2. **LLM on the laptop only**, via Ollama, with a 3B–8B model (about 2–5 GB, on the laptop's disk, not the phone's).
3. **Phone uses the laptop's LLM over LAN**, reusing the paired, encrypted sync connection. When the laptop is not reachable, the phone uses the rule-based result and queues the item for re-parsing at the next sync if it was ambiguous.
4. Never bundled in the APK. If on-phone LLM is ever wanted, it is an optional in-app download (or Gemini Nano through Android AICore on supported devices, which needs no download).
5. Claude API remains a possible opt-in later, per action.

LLM-backed features: ambiguous NL task parsing, finance category suggestions for unknown merchants, monthly finance and weekly review summaries.

### 4.7 High-level structure

```
kaizen/
  src/                 # Frontend (React + TS)
    modules/
      dashboard/
      cp/              # DSA / CP tracker
      fitness/         # Gym + sports
      lists/           # Todo, watch, read
      finance/
      habits/
      whiteboard/
      ideas/
      activity/        # Heatmap + streaks
      focus/           # Forest-style focus timer
      calendar/        # Important dates + college timetable + attendance
    core/
      db/              # Schema, migrations, queries
      search/          # FTS5 index + command palette
      nlp/             # Natural-language parsing
      notifications/
      sync/
      ui/              # Design system components
  src-tauri/           # Rust: plugins, CSV parsing, crypto, sync, API fetchers
    gen/android/       # Kotlin plugins: widgets, focus strict mode, foreground service
```

---

## 5. Data model (first draft)

- `tasks` (id, list: todo|watch|read, title, notes, due_at, recurrence, priority, tags, status, metadata JSON, created_at, updated_at, deleted)
- `cp_accounts`, `cp_problems`, `cp_submissions`, `cp_contests`, `cp_revisit_queue`
- `exercises`, `workout_templates`, `workouts`, `workout_sets`, `sport_sessions`, `body_metrics`
- `accounts`, `statements`, `transactions`, `categories`, `category_rules`, `budgets`
- `habits`, `habit_logs`, `goals`, `goal_links`
- `boards` (whiteboard documents, stored as CRDT/Excalidraw JSON)
- `ideas`, `attachments`
- `reminders` (target_type, target_id, fire_at, recurrence, status)
- `activity_events` (id, type, date, quantity, unit, source_table, source_id), `activity_types` (key, name, colour, active_day_rule), `streak_freezes`
- `focus_sessions` (id, start, end, planned_minutes, status: completed|withered|given_up, tag, task_id, species), `forest_unlocks`
- `important_dates` (id, title, kind, date, recurrence, reminder_offsets, notes)
- `semesters`, `subjects` (name, code, professor, colour, attendance_target), `timetable_slots` (subject_id, weekday, start, end, room, kind, week_parity), `timetable_exceptions`, `attendance` (slot_id, date, status)
- `search_index` (FTS5 virtual table: module, ref_id, title, body, tags)
- `sync_changes`, `devices`, `settings`

---

## 6. Roadmap

| Phase | Scope |
|---|---|
| 0. Foundation (done) | Tauri 2 project (desktop + Android), design system, navigation shell, SQLite + migrations, encryption, settings, backup/export, `activity_events` table, search index skeleton |
| 1. Daily core | To-do / watch / read with NL parsing, notification service, habits, idea scrapbook, important dates, college timetable + attendance, Today dashboard |
| 2. Sync | LAN sync with QR pairing, so the phone is usable daily from here on |
| 3. Focus and activity | Forest-style focus timer (Android strict mode), activity heatmap with filters, streaks, universal search + command palette |
| 4. Practice | Codeforces + LeetCode connectors, CP analytics, contest reminders, revisit queue |
| 5. Fitness | Gym logging, templates, PRs, charts, sports sessions, body metrics |
| 6. Finance | CSV statement import with bank profiles, categorisation, insights, budgets |
| 7. Canvas | Whiteboard (Excalidraw), linking ideas to boards |
| 8. Polish and extras | Android widgets, quick capture, share sheet, journal, weekly review, Health Connect, LLM features |

### 6.1 Phase 0 in detail (Foundation)

Goal: an empty but real app that installs on the laptop and the Android phone, unlocks with a passphrase or fingerprint, navigates between placeholder module screens, stores data in an encrypted database and can back it up and restore it. No user-facing features yet; everything later phases need underneath is in place.

**1. Tooling setup (one-time)**
- Node (installed), pnpm (via `corepack enable`), Rust (installed) plus Android targets (`rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`).
- Android Studio with Android SDK, NDK and platform tools; `ANDROID_HOME` and `NDK_HOME` set.
- JDK 17 or 21 for Gradle (Android Studio's bundled JDK works; the installed JDK 23 may not be supported by the Android Gradle plugin).
- USB debugging enabled on the phone, or an emulator.

**2. Project scaffold**
- `create-tauri-app` with React + TypeScript + Vite, pnpm.
- `tauri android init`; confirm the app runs on desktop (`tauri dev`) and the phone (`tauri android dev`).
- Git repository, ESLint, Prettier, `rustfmt`, `clippy`.
- Tests: Vitest (frontend), `cargo test` (Rust).
- Path aliases and the folder structure from section 4.7.

**3. Design system and app shell**
- Tailwind CSS, shadcn/ui components, lucide icons, Framer Motion.
- Design tokens: colour palette (including the per-activity colours from 2.9), typography, spacing, radii; dark and light themes with system default.
- Responsive shell: sidebar on desktop, bottom navigation and gestures on Android; safe-area handling for notches and gesture bars.
- Routing (TanStack Router) with a placeholder page for every module.
- State: TanStack Query for database data, Zustand for UI state.
- Command palette shell (`Ctrl/Cmd+K`) with navigation commands only; search comes in Phase 3.
- Toasts, dialogs, empty states, loading skeletons.

**4. Data layer**
- Rust database service: `rusqlite` + bundled SQLCipher, one connection, WAL mode.
- Query bridge: a Tauri command that executes SQL; Drizzle `sqlite-proxy` on the frontend for typed schema and queries.
- Migration system (versioned SQL migrations run on startup, with a backup taken before each migration).
- Shared column conventions for every table: `id` (UUIDv7), `created_at`, `updated_at`, `deleted_at` (soft delete), `device_id`.
- Sync groundwork: `devices` table and a `sync_changes` change log filled by triggers, so Phase 2 sync works on all data written from day one.
- Shared tables created now: `settings`, `activity_events`, `activity_types`, `reminders`, `attachments`, and the empty `search_index` FTS5 table.
- File storage helper for attachments in the app data directory.

**5. Security**
- First-run setup: create passphrase; derive the database key (Argon2id).
- Key stored in the OS keychain (macOS Keychain / Windows Credential Manager / Linux Secret Service via the `keyring` crate) and the Android Keystore.
- Unlock screen: biometric on Android (Tauri biometric plugin), passphrase fallback; auto-lock after inactivity (configurable).
- Recovery: a printable recovery key, since a forgotten passphrase otherwise means losing the data.

**6. Settings, backup and restore**
- Settings screen: theme, lock timeout, backup folder, device name, about/version.
- Encrypted backup: copy of the database plus attachments to a chosen folder; manual button plus scheduled (daily/weekly) with retention (e.g. keep last 10).
- Restore from backup.
- Plain JSON export of all tables.

**7. Diagnostics**
- Structured logging (Rust `tracing`, frontend logger) to a rotating log file, viewable from settings.
- Global error boundary with a "copy error details" button.

**8. Builds**
- Desktop: macOS build first (`.dmg` / `.app`); Windows and Linux builds later via GitHub Actions or on those machines (each OS must build its own installer).
- Android: signed release APK installed by sideloading (debug builds during development).
- Optional: GitHub Actions workflow building all targets on every push.

**Done when**
- App launches on macOS and on the Android phone.
- First-run passphrase setup, then unlock by fingerprint on the phone works.
- All module placeholders reachable; theme switch works; layout correct on both screen sizes.
- A test record can be written, read, soft-deleted, and appears in `sync_changes`.
- Backup, wipe and restore round-trip recovers the data.

**Explicitly not in Phase 0**: notifications, NL parsing, any module feature, sync itself, search results.

### 6.2 Phase 0 outcome (2026-10-13)

Done and verified on the Nothing phone (Android 16) and macOS:
- Setup, recovery key, fingerprint unlock, passphrase unlock (wrong passphrase rejected), recovery-key reset.
- Encrypted database with migrations, shared columns, sync change-log triggers, FTS5 trigram index, seeded activity types.
- Database check in Settings (write, read, soft delete, sync log, cleanup) passes through Drizzle on the phone.
- Scheduled backups (first one runs right after unlock), manual backup, retention, restore, erase, JSON export, log viewer.
- Rust tests cover the vault, migrations, wrong-key rejection and a backup, erase, restore round trip.

Decisions made while building:
- Rust owns the database (`rusqlite` + bundled SQLCipher with vendored OpenSSL); Drizzle `sqlite-proxy` on the frontend.
- The database key is random; `vault.json` stores it wrapped (XChaCha20-Poly1305) under Argon2id keys from the passphrase and from the recovery key.
- Device-specific preferences (backup folder, schedule, auto-lock) live in the unsynced `local_meta` table; the theme lives in `localStorage` so the lock screen matches.
- Icons: Phosphor. Font: Geist. Routing: TanStack Router with hash history.
- Android cloud backup and device-to-device transfer are disabled in the manifest, so app data never leaves the phone that way.

Follow-ups:
- Android quick-unlock key is kept in app-private storage behind the biometric prompt; wrap it with an Android Keystore key (small Kotlin plugin).
- Android backups currently live in app-private storage and are removed if the app is uninstalled; add export to a user-visible folder, and LAN sync (Phase 2) adds a second copy.
- Split the frontend bundle per module (currently about 800 KB of JS).
- Windows and Linux builds are untested; macOS dev builds are unsigned, so the keychain may ask for access again after a rebuild.

---

## 7. Open questions

Answered: Android 16, CSV statements, LAN sync, React, LLM on laptop only, package `com.matt.kaizen`.

Still open:
1. Which banks (to build the first CSV mapping profiles)? Needed by Phase 6.
2. Which extra modules from section 3 are worth including?
3. Timetable: does the college publish it in a format that can be imported (CSV/Excel), or manual entry only? Needed by Phase 1.

**Project identity**
- App name: Kaizen (continuous small improvement). Identifier / Android package: `com.matt.kaizen`.
- Phone: Nothing (model A059), Android 16 (API 36), arm64-v8a. Dev builds can target `aarch64` only for faster compiles. Nothing OS is close to stock Android, so battery-saver restrictions should be mild. Target SDK 36; minimum SDK left at 24 (Tauri default), since only one phone needs support.
- Android 16 implications: edge-to-edge layout is mandatory (handle system bar insets / safe areas from Phase 0), predictive back gesture should be supported, and exact alarms need the `USE_EXACT_ALARM` or `SCHEDULE_EXACT_ALARM` permission (fine for a sideloaded app).
