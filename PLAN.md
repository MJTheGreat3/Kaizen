# Kaizen — Personal Life Tracker

A single-user, local-first app that runs on every laptop OS (macOS, Windows, Linux) and on my phone. It tracks practice, fitness, tasks, money, habits and ideas in one place. All data stays on my own devices.

Status: planning (updated 2026-10-13)

**Decisions so far**
- Phone: **Android** (no iOS build planned).
- Bank statements: **CSV** import.
- Sync: **end-to-end encrypted**, through a hidden Google Drive folder (works on college Wi-Fi) plus direct LAN / Tailscale (see section 4.4).
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
- Pulls my solved problems, submissions, contest history and rating from Codeforces, LeetCode, AtCoder and CodeChef.
- Shows rating graphs, solved count by difficulty and tag, daily heatmap, streaks.
- Weak-topic analysis: tags where my acceptance rate or solve count is low.
- Manual log for problems from other sources (AtCoder, CSES, books) with notes, solution link and "time taken".
- Revisit queue: spaced repetition for problems I want to redo (resurfaces after 1, 3, 7, 21 days).
- Upcoming contest calendar with reminders through the notification system.

**Data sources**
- Codeforces official public API (no key needed for public data):
  - `user.info`, `user.rating`, `user.status` (all submissions), `contest.list` (upcoming contests).
- LeetCode: no official public API. Use the GraphQL endpoint `https://leetcode.com/graphql` that the website uses (queries such as `userProfile`, `recentAcSubmissionList`, `userContestRankingHistory`, `upcoming contests`). It is unofficial and may change, so wrap it in an adapter that fails gracefully.
- AtCoder: rating history from `atcoder.jp/users/<name>/history/json`, submissions, problem names and difficulty from the community AtCoder Problems API (kenkoooo.com), upcoming contests from the atcoder.jp contests page.
- CodeChef (no public API any more): rating, stars, totals and rating history from the profile page, submissions from the profile's recent-activity feed, contests from the JSON the contests page loads.

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
- First bank profile: **Punjab National Bank (PNB)**. If PNB's statement download only offers XLS/XLSX or PDF rather than CSV, add an XLS/XLSX reader (e.g. the `calamine` crate) for it; PDF only as a last resort.

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
- Searches everything: tasks, watch/read items, ideas, debts, whiteboard text, CP problems (title, tags, my notes), workouts and exercises, transactions (merchant, notes, amount), habits, important dates, timetable subjects.
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

**College timetable with attendance**

The timetable and attendance are one feature: every scheduled class is also an attendance record, so the timetable is what makes attendance tracking effortless.

*Timetable*
- Weekly grid of slots: subject, type (lecture / lab / tutorial), time, room, professor, colour.
- Semester start and end dates. The timetable is a **weekly** repeating schedule.
- **Changes to the schedule**, all shown on the timetable and respected by reminders and attendance:
  - *Extra class*: schedule a one-off class for any subject, date and time (e.g. a Saturday make-up lecture).
  - *Cancel a class*: cancel one occurrence (it is marked cancelled and does not count towards attendance); optionally reschedule it to another slot.
  - *Holidays*: single days off (festivals, college holidays); no classes are generated for them.
  - *Vacation periods*: date ranges (mid-sem break, winter vacation) with no classes.
- Support for alternating weeks (odd/even) and batch-specific labs.
- Entry: manual weekly grid editor (tap an empty slot to add a class, drag to move or resize, copy a day to another day). CSV import can come later if needed.
- Notification before each class (configurable, e.g. 10 min before, with room number).
- Today dashboard shows current and next class; Android home-screen widget shows the day's classes.

*Attendance*
- Each class occurrence generated from the timetable gets a status: present, absent, cancelled, or excused (medical / duty leave). Excused classes count as present.
- **Mark in one tap**: a notification when each class ends asks "Attended Data Structures?" with Present / Absent actions. Unanswered classes can default to present (setting) or stay unmarked for review.
- Bulk marking: "mark the whole day present/absent", or mark from the timetable grid.
- Per-subject and overall attendance %.
- **Counting option** (per semester, overridable per subject): count lectures, labs and tutorials together as one figure, or count labs and/or tutorials as separate components, each with its own % and its own 80% target and bunk calculation.
- Minimum-attendance target of **80%** (college policy), adjustable per subject, with a **bunk calculator**: "You can skip 3 more" / "Attend the next 5 to reach 80%", projected to the semester end using remaining scheduled classes.
- Warnings when a subject drops close to its target, through the notification system.
- Attendance history per subject (calendar view) and a semester report.
- Class attendance feeds the `classes` activity type on the heatmap (2.9).
- Exams and assignment deadlines can be linked to a subject and appear in the timetable, the to-do list and the important dates countdowns.

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

### 2.13 Music (Spotify connector)

Connect my Spotify account to play music from Kaizen and see listening stats.

**Playback**
- Browse my playlists, liked songs and recently played; search songs, albums and artists.
- Play, pause, skip, seek, shuffle, repeat, volume, add to queue, choose the device.
- Mini player in the app shell (sidebar footer on desktop, above the bottom bar on Android) and on the Focus screen, so music and focus sessions go together.
- How playback works: Kaizen acts as a **remote control** through Spotify Connect (Web API player endpoints). Audio plays in the Spotify app on the phone or laptop (or any Connect device). Kaizen does not stream audio itself: the Web Playback SDK needs Widevine DRM, which embedded webviews like Tauri's do not provide, and Spotify does not support it outside real browsers.
- Optional later: Spotify's Android App Remote SDK (Kotlin plugin) for tighter control of the Spotify app on the phone.

**Stats**
- Top artists and top tracks for the last 4 weeks, 6 months and about a year (from Spotify's top-items endpoints).
- Favourite song, most played artist and album, listening time per day/week, listening by hour of day, new artists discovered.
- Spotify only returns the last 50 recently played tracks, so Kaizen polls recently played regularly (every 30-60 min while running, plus on open) and keeps its **own local listening history**. Albums listened to, play counts and listening time are computed from that history, which grows richer over time.
- Monthly / yearly "wrapped"-style summary page.
- Listening minutes can appear on the heatmap as a `music` activity type (off by default).

**Connection and limits (Spotify developer rules as of 2026)**
- I register my own app in the Spotify developer dashboard and paste its Client ID into Kaizen. Development Mode is enough for personal use (up to 5 users), but **the app owner needs Spotify Premium**, and playback control also needs Premium.
- OAuth Authorization Code with PKCE (no client secret in the app). Redirect: a loopback URL (`http://127.0.0.1:<port>/callback`) on desktop and a custom scheme (`kaizen://spotify/callback`, Tauri deep-link plugin) on Android.
- Refresh token stored in the encrypted database; the account is connected once per device (tokens are device-local and not synced).
- Some catalogue endpoints were removed or limited for Development Mode apps in 2026 (e.g. batch track/album lookups, browse, artist top tracks; search returns at most 10 results per call), so features rely only on top items, recently played, playlists, library, search and player endpoints.

### 2.14 Sports following (NBA and football)

Follow favourite NBA and football (soccer) teams and players.

- **Follow from inside the app**: search any NBA or football team or player, tap Follow, and it is added to my list. Unfollow, reorder, and pin favourites at any time. Nothing is preset; the app starts empty with a "Find teams and players" search.
- Following a player also shows their team's next game; following a team offers its key players to follow.
- Separate tabs for NBA and Football, plus a combined "My teams" feed of upcoming games and recent results.

- **Teams**: upcoming fixtures with kickoff/tip-off in local time, live scores, results, league table / standings, form (last 5).
- **Players**: season stats (NBA: points, rebounds, assists, minutes, shooting splits; football: goals, assists, appearances, minutes, cards), recent game logs, injury status where available.
- **Notifications**: match starting soon, final score, optionally goals / end of quarters for favourites; quiet hours respected.
- Fixtures can appear on the calendar alongside classes and important dates, and in the Today dashboard ("Lakers vs Celtics, 6:00 am").
- Multiple competitions: Premier League, La Liga, Champions League, etc. for football; NBA regular season and playoffs.
- Results cached locally so recent scores and stats work offline.

**Data sources** (free tiers, each behind its own adapter so one can be swapped if it breaks or changes terms):
- Football: football-data.org (official free API key; fixtures, results, standings and scorers for the top competitions), with API-Football as an option for richer player stats.
- NBA: balldontlie (API key; teams, players, games; some stats endpoints need a paid tier) and ESPN's public site JSON (unofficial, no key) for scores, schedules and box scores.
- Free tiers have rate limits, so fetches are batched and cached; live scores poll only while a favourite's game is in progress.

### 2.15 Debt recorder (IOUs)

Instantly record who owes me money and whom I owe.

- **Quick entry** in seconds, with natural language through the shared parser: "Rahul owes 250 for pizza yesterday", "I owe Priya 1200 cab to airport", "paid Rahul back 100".
- Each entry: person, direction (they owe me / I owe them), amount in ₹ (rupees only), date, reason, optional due date, notes and receipt photo.
- **People view**: net balance per person ("Rahul owes you ₹650 across 3 entries"), full history with each person, and overall totals (owed to me / I owe / net).
- Partial repayments and settle-up: record payments against a balance; settled entries move to history.
- Bill splitting helper: enter a total and people, split equally or by amounts, and create the IOUs in one go.
- Reminders: due-date notifications, plus a "nudge" that prepares a polite message to share via WhatsApp/SMS through the share sheet (nothing is sent automatically).
- Link with Finance (2.4): when an imported bank transaction matches a repayment (e.g. a UPI credit from that person for that amount), suggest marking the debt settled.
- Contacts are stored in Kaizen only (no phone contact sync required); optionally pick names from the phone's contacts on Android.

---

## 3. Extra modules

Chosen:

1. **Today / Dashboard**: one home screen combining today's classes (with attendance to mark), tasks, habits, workout plan, upcoming contests and matches, important dates, debts due, and a random idea. No spending on it.
2. **Global quick capture**: system-wide hotkey on desktop, share sheet and home-screen widget on Android; natural language decides which module receives the item (task, idea, debt, extra class, etc.).
3. **Weekly / monthly review**: auto-generated report of what I did (problems solved, workouts, focus hours, habits kept, attendance, music listened, money spent once Finance exists) with space for reflection.

Maybe later:

4. **Sleep and health metrics**: manual or via Health Connect.

Dropped: journal and mood log, learning / course tracker, cross-module insights.

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

**Decision: B and A on one shared core.** College Wi-Fi isolates clients (no mDNS, no device-to-device connections), so LAN sync alone would rarely work day to day. Sync is split into a transport-agnostic core and two transports:

| Transport | Role | Needs both devices online? |
|---|---|---|
| Google Drive (hidden app folder) | Primary: works on any network, including college Wi-Fi and mobile data | No: acts as a mailbox |
| Direct connection (LAN or Tailscale) | Bonus: instant sync at home, on a phone hotspot or over a tailnet | Yes |

**Sync core**
- Each device packs its unsent `sync_changes` rows into a bundle, compresses it and encrypts it (XChaCha20-Poly1305) with a sync key shared at pairing. Transports only ever move opaque encrypted bundles.
- Each bundle carries the sender's device ID and a sequence number; receivers track the last sequence applied per device, so bundles are idempotent and can arrive in any order or more than once.
- Merge is last-writer-wins per field (see conflict handling below); deletes are soft deletes and travel like any other change.
- Pairing: a one-time QR code shown on the laptop and scanned by the phone, carrying the device IDs and the sync key (plus the laptop's addresses for direct sync). Unpaired devices are ignored.
- Sync screen: paired devices, last sync per transport, "Sync now", history and errors, unpair.

**Google Drive transport**
- A separate Google account dedicated to Kaizen. Scope `drive.appdata` only: Kaizen sees its own hidden folder and nothing else in that Drive, and Google only sees encrypted bundles.
- Layout: one folder per device; a device writes only its own bundles and reads the others'. Old bundles are compacted into a snapshot once every paired device has applied them.
- Sign-in: own Google Cloud project and OAuth client, PKCE. Desktop uses a loopback redirect; Android needs an in-app browser flow with a redirect back into the app (the main implementation risk). Refresh tokens are kept in the encrypted database.
- The OAuth consent screen must be set to "In production": in "Testing", refresh tokens expire after 7 days. Restricted to the app-data scope, no Google review is needed.
- Runs on app open, after local changes (debounced), on "Sync now" and periodically while open; Android background sync via `WorkManager` later.

**Direct transport (LAN / Tailscale)**
- Discovery via mDNS / DNS-SD (desktop `mdns-sd` crate, Android `NsdManager`) when the network allows it, plus manually entered addresses (a Tailscale IP or hostname, or a hotspot IP).
- Encrypted connection between paired devices only (Noise, or TLS with pinned keys), exchanging the same bundles as Drive.
- Tailscale notes: on Android it occupies the VPN slot and costs some battery; when the network blocks direct UDP it falls back to Tailscale's relays (slower but works).

**Conflict handling**: each row carries an ID (UUIDv7), `updated_at`, `device_id` and a soft-delete flag; changes are recorded in a change log and merged last-writer-wins per field. Rich documents (whiteboards, long notes) use a CRDT (Yjs or Automerge) so edits from both devices merge cleanly. A library such as cr-sqlite or a sync engine like PowerSync/ElectricSQL can replace the hand-rolled version if it proves too complex.

### 4.5 External integrations

| Integration | Purpose | Notes |
|---|---|---|
| Codeforces API | Submissions, rating, contests | Official, public, rate limited (about 1 request / 2 s) |
| LeetCode GraphQL | Submissions, contests | Unofficial, may break; keep adapter isolated |
| TMDB / Open Library | Metadata for to-watch / to-read | Optional, free API keys |
| LLM (Ollama on laptop; Claude API maybe later) | NL parsing fallback, finance categorisation, summaries | Laptop-hosted, phone uses it over LAN (see 4.6) |
| Health Connect (Android) | Steps, sleep, workouts | Later phase |
| Spotify Web API | Playback control (Spotify Connect), playlists, top items, recently played | Own Client ID in Development Mode; owner needs Premium; PKCE OAuth |
| football-data.org / API-Football | Fixtures, results, standings, player stats | Free API keys, rate limited |
| balldontlie / ESPN public JSON | NBA games, scores, players, box scores | balldontlie needs a key; ESPN JSON is unofficial |

### 4.6 LLM strategy

On-device models on the phone are large: roughly 0.7–1 GB for a 1–1.5B parameter model (4-bit quantised) and about 2 GB for a 3B model, plus noticeable RAM use, battery drain and slower responses. Small models are also weaker at the messy cases where an LLM is actually needed.

Plan:
1. **Rule-based parser everywhere** (chrono-node + `#tag` / `!priority` / `@list` syntax). Instant, offline, zero download. Handles most input.
2. **LLM on the laptop only**, via Ollama, with a 3B–8B model (about 2–5 GB, on the laptop's disk, not the phone's).
3. **Phone uses the laptop's LLM over LAN**, reusing the paired, encrypted direct sync connection (LAN or Tailscale). When the laptop is not reachable, the phone uses the rule-based result and queues the item for re-parsing at the next sync if it was ambiguous.
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
      calendar/        # Important dates + college timetable with attendance
      music/           # Spotify player and listening stats
      sports/          # NBA and football following
      debts/           # IOU recorder
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
- `semesters`, `subjects` (name, code, professor, colour, attendance_target), `timetable_slots` (subject_id, weekday, start, end, room, kind, week_parity), `timetable_exceptions`
- `search_index` (FTS5 virtual table: module, ref_id, title, body, tags)
- `class_occurrences` (slot_id, date, start, end, status: scheduled|present|absent|cancelled|excused, marked_at) generated from `timetable_slots` + `timetable_exceptions`
- `music_accounts` (device-local tokens), `music_plays` (track_id, played_at, duration_ms, context), `music_tracks`, `music_artists`, `music_albums` (cached metadata), `music_top_snapshots` (time_range, kind, ranked ids, taken_at)
- `sports_follows` (sport: nba|football, kind: team|player, external_ids per provider, name), `sports_matches` (cached fixtures/results), `sports_player_stats` (cached season and game stats)
- `people` (name, phone, notes), `debts` (person_id, direction: owed_to_me|i_owe, amount_paise, occurred_on, reason, due_on, status), `debt_payments` (debt_id or person_id, amount_paise, paid_on, note, linked_transaction_id)
- `sync_changes`, `devices`, `settings`

---

## 6. Roadmap

| Phase | Scope |
|---|---|
| 0. Foundation (done) | Tauri 2 project (desktop + Android), design system, navigation shell, SQLite + migrations, encryption, settings, backup/export, `activity_events` table, search index skeleton |
| 1. Daily core (done) | To-do / watch / read with NL parsing, notification service, habits, idea scrapbook, important dates, college timetable with attendance, debt recorder, Today dashboard |
| 2. Sync (done) | Encrypted sync core with QR pairing; Google Drive transport first, then direct LAN / Tailscale; the phone is usable daily from here on |
| 3. Focus and activity (done) | Forest-style focus timer (Android strict mode), activity heatmap with filters, streaks, universal search + command palette |
| 4. Practice (done) | Codeforces, LeetCode, AtCoder and CodeChef connectors, CP analytics, contest reminders, revisit queue |
| 5. Fitness and sports | Done: sports (sessions, NBA, football and cricket following, favourite players, game reminders) and gym (logging, routines, records, charts, body metrics) |
| 6. Canvas | Whiteboard (Excalidraw), linking ideas to boards |
| 7. Music | Spotify connection, remote-control player and mini player, local listening history, stats and summaries |
| 8. Polish and extras | Android widgets, global quick capture, share sheet, weekly / monthly review, LLM features; maybe Health Connect sleep and health metrics |
| 9. Finance (last) | PNB statement import, categorisation, insights, budgets; debt settle-up matching; spending added to the weekly review |

Finance comes last on purpose: testing it means using the PNB banking app on the phone, which needs Developer options (USB debugging) switched off, so it is done once the rest no longer needs on-device debugging.

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
- Android backups currently live in app-private storage and are removed if the app is uninstalled; add export to a user-visible folder, and sync (Phase 2) adds a second copy on the laptop.
- Split the frontend bundle per module (currently about 800 KB of JS).
- Windows and Linux builds are untested; macOS dev builds are unsigned, so the keychain may ask for access again after a rebuild.

---

### 6.3 Phase 1 outcome (2026-10-13)

Built and verified (browser preview on real SQL, plus the phone for setup, notifications and Today):
- **Lists**: to-do, watch and read with natural-language quick add (dates, times, `#tags`, `!priority`, "every week"), live preview, overdue/today/upcoming/someday groups, recurring tasks, editor with reading progress and ratings.
- **Debts**: natural-language entries ("Rahul owes 250 for pizza yesterday", "paid Priya back 600"), people with net balances, history, settle-up, nudge via share sheet or clipboard, bill splitting, due-soon strip.
- **Ideas**: scrapbook with `#tags`, links, pin, colours, search and resurface.
- **Habits**: done/not-done or amounts, daily / chosen days / N per week, streaks (days or weeks), week strip to fix missed days, 30-day rate, reminder time.
- **Calendar**: semester with 80% target and optional separate lab/tutorial counting, subjects, weekly timetable (grid on desktop, day list on the phone) with odd/even weeks, extra classes, cancellations, holidays, vacations and copy-day; one-tap present/absent/excused; per-subject stats with bunk calculator; needs-marking list; important dates with countdowns and ages.
- **Notifications**: classes (before), attendance check (after), tasks, habits, dates, debts and a morning summary; exact alarms on Android (verified firing on time with the app in the background), timers on desktop; per-category settings.
- **Today**: live dashboard of the above.
- Activity events are recorded for tasks, reading, habits and attended classes, ready for the Phase 3 heatmap.

Deferred:
- Goals that link habits to other modules, to Phase 3 with the activity heatmap.
- Drag to move/resize timetable slots (edit dialog for now).
- Present/Absent buttons inside the notification itself (tapping opens the app).
- Receipt photos for debts, picking people from phone contacts, TMDB/Open Library metadata.

### 6.4 Phase 2 outcome (2026-10-13)

Built and tested (Rust unit and integration tests, browser preview of the UI):
- **Sync core**: migration v3 replaces the row-level `sync_changes` log with per-cell clocks (`sync_clock`), stamped by generated triggers; a local edit always gets a timestamp above the value it replaces, so a device with a slow clock still wins with newer edits. Existing rows are stamped from `updated_at`, so data entered before pairing merges.
- Merge is last-writer-wins per cell; rows with a natural key (habit logs, attendance) created on both devices merge into one. Attendance, habit logs and activity events now use soft deletes and ids derived from their natural key, since hard deletes are not synced.
- Bundles: each device's own changes for a `seq` range, deflated and sealed with XChaCha20-Poly1305 under the group key; receivers apply ranges in order and wait if one is missing.
- Pairing: QR code / `KZ1-…` code carrying the group key; scanned with the barcode-scanner plugin on Android.
- Transports: Google Drive (`drive.appdata`, OAuth PKCE with a loopback redirect on desktop and Android, client from build-time env vars), direct LAN / Tailscale (laptop serves its mailbox on port 47913 with a key-derived token; the phone uses a typed address), and a shared folder (desktop).
- Auto-sync while unlocked: shortly after unlock, 15 s after changes, on returning to the app and every 5 minutes; incoming changes reload all screens and reschedule notifications. Settings → Sync shows devices, Drive account, direct-sync addresses, history and unpair.
- Restoring a backup gives the device a new id so its re-used sequence numbers are not skipped by others.

Verified on the devices (laptop + phone, 2026-10-13): QR pairing, Google sign-in on both, and a task added on one device appearing on the other through Drive. Fixed along the way:
- v4 migration: the clock triggers used `INSERT OR REPLACE`, which SQLite ignores inside an upsert (`INSERT ... ON CONFLICT DO UPDATE`), so the second unlock failed on a `sync_clock` unique constraint; triggers now upsert.
- Android blocks network access for background apps, and the browser hands the sign-in code back while it is still in front; the token exchange now retries until Kaizen is back in the foreground.

Finished afterwards:
- **Compaction**: past 20 bundles, a device replaces its own with one snapshot of every cell it wrote (`seq` from 1), so Drive stays small and late joiners still catch up.
- **Finding the laptop**: laptops publish their addresses in the synced `devices` table (migration v5) and in the pairing code; the phone tries them every round. Chosen over mDNS, which needs a multicast lock on Android and fails on client-isolated networks anyway.
- **Android background sync**: a WorkManager job (`SyncWorker.kt`, every ~15 min, network required) calls into Rust over JNI and syncs through Drive and the laptop. Opt-in, and only with fingerprint unlock on, since it opens the database with the on-device key. Verified on the phone with the app closed.
- **Touch ID** on the Mac gates quick unlock (LocalAuthentication, with the login password as fallback). Biometric prompts appear only when the unlock button is pressed.

Known limits:
- Notifications are rescheduled only when the app is opened, not after a background sync.
- The QR scanner (ML Kit) sends Google anonymous usage statistics; it could be swapped for a ZXing-based scanner.

### 6.5 Phase 3 outcome (2026-10-14)

Built and verified on the phone (desktop in the browser preview and dev app):
- Sessions (presets 25/5, 50/10, 90/15 or 5-180 min) with tag and linked task; six hand-drawn SVG species growing from seed to tree; coins (one per completed minute) unlock species; forest by day/week/month; stats (today, 7 days, all time, best hour, longest, 14-day chart, tags). Completed sessions record `focus` activity for the heatmap.
- Full-screen focus mode on both devices: everything but the tree, ring, clock and controls is blurred.
- Android: native `focus` plugin (`src-tauri/plugins/focus`) with a special-use foreground service: countdown notification with Pause / Give up, strict mode via usage access (another app in front past the grace period withers the tree; home, phone and system UI allowed), Do Not Disturb with the previous setting restored, alerts when the app is closed. Events are applied to the session when the app returns.
- Laptop: other apps allowed (strict mode is phone-only for now); chime and notification at the end.

Still to check: end-of-session notifications on the laptop, which need the bundled `Kaizen.app` (dev builds are not a real app bundle, so macOS drops their notifications).

**Activity heatmap** (built 2026-10-14): GitHub-style grid over 3 months / 6 months / a year from `activity_events`, one colour per type with intensity by each type's own quartiles, split cells for days with several activities, type toggles (double-click for one type), tag filter (tasks and focus tags), tap a day for its log with titles from each source, totals per type for the range. Streaks per type and overall with editable rules: daily minimum, weekly streaks (N active days a week), rest weekdays and freezes per month. Milestones at 7/30/100/365 (toast and notification, once each) and an 8:30 pm nudge for daily streaks of 3+ days not yet done (Settings → Notifications → Streaks). A Today card shows the overall streak and the last five weeks. Not yet: year-over-year comparison, monthly totals view.

**Universal search and command palette** (built 2026-10-14): migration v7 rebuilds `search_index` (FTS5, trigram) with filter columns (`src`, `module`, `date`, `amount`, `status`) and fills it with triggers on tasks, ideas, habits, important dates, subjects, people, debts and goals, so rows written by sync are indexed too; soft-deleted rows drop out. Matching runs in memory over the index rows: substrings anywhere, word-prefix typos (1 edit from 4 letters, 2 from 7, transpositions count as one) and results grouped by module with highlighted titles. Filters: `in:` (tasks, books, watch, ideas, habits, dates, college, debts, people, goals, lists, calendar), `tag:` or `#tag`, `before:` / `after:` (a day or a month), `amount:>500`, `is:done|open|pinned|archived`. The same palette runs commands (start a focus session, new goal, new habit, sync, back up, theme, lock), adds the typed text as a task (natural language) or an idea, and keeps recent searches and recently opened items (device-local). Picking a result opens it in its module (task editor, idea, habit, date, subject, person, goal). `Cmd/Ctrl+K` on desktop; the search button or a pull-down from the top of any page on the phone. Not yet: transactions, CP problems, workouts and whiteboard text, which arrive with their modules.

**Goals** (built 2026-10-14): `goals`, `goal_links` and `goal_entries` (synced). Four kinds: a number logged by hand (rating, weight; may go down), an activity total since the start date (optionally one tag, focus in hours), check-ins of linked habits, or linked tasks done. Cards show progress, a step chart against the planned pace, ahead / on track / behind, days left and what is needed per day or week. Goals are marked reached automatically (toast and notification); reminders a week and a day before the finish date (Settings → Notifications → Goals). Ideas can become a task or a goal; Today shows the active goals.

Phase 3 is complete; the laptop end-of-session notification still needs checking with the bundled app.

### 6.6 Phase 4 outcome: Practice (2026-10-14)

Built and tested (Rust unit tests with saved responses, a live test against all four sites, browser preview of the UI):
- **Connectors** (Rust, `src-tauri/src/practice/`): one adapter per site turns its data into the same shapes (account, submissions newer than a cursor, rating history, upcoming contests). Codeforces uses the official API, paged until known submissions; LeetCode the website's GraphQL (only the 20 most recent accepted submissions are public, so history builds up from the first refresh; totals by difficulty are complete); AtCoder the official history JSON plus AtCoder Problems; CodeChef the profile page and its recent-activity feed. Sites are fetched in parallel without holding the database, at a polite pace, and a failure shows a readable message on that site's card.
- **Storage** (migration v8): `cp_accounts` (one row per site, synced, so a handle set on the laptop reaches the phone), `cp_problems` (one row per problem, not per submission: attempts, first and latest try, first solve, plus my notes, time taken and solution link, which refreshes never overwrite; ids come from the site's problem id so both devices agree), `cp_revisit` (synced), and device-local caches `cp_ratings` and `cp_contests`. Each first solve records a `cp` activity event, so problems feed the heatmap, streaks and activity goals. Problems are in the search index (`in:cp`, `rating:>1600`, `is:solved`, `#dp`).
- **Practice page**: a card per site (rating coloured by rank, max, solved, last update), totals (all sites, this week, last 30 days, solving streak), rating history across sites with a hover tooltip, solved by difficulty (Codeforces and AtCoder in 200-point bands, LeetCode by Easy/Medium/Hard), topics with solved vs tried and weak spots (topics whose solve rate is well below the overall one; topic names from different sites are merged), revisit queue (1, 3, 7 and 21 days; "Struggled" starts over), upcoming contests with a per-site filter, and a filterable problem list with notes, time taken and a solution link per problem. Problems from elsewhere (CSES, books) can be logged by hand.
- Refreshes run 20 s after unlock and every half hour for sites not updated in 3 hours; contests every 6 hours; the Refresh button does both now.
- Contest reminders (Settings → Notifications → Contests, 10 min to 2 h before) and contests in Today's "Up next" card.
- Goals: a number goal can follow a site's rating after each contest ("Reach CF Expert").

**GitHub** (added after Phase 4, migration v9): a GitHub username on the Practice page. The contribution calendar (every year on the first refresh, then the last twelve months) becomes `github` activity events, one per day with ids `ae:github:{date}`, so GitHub shows on the heatmap with its own streak. The page also lists the five repositories pushed to most recently (from push events, so other people's repositories count, with the latest commit message) and the issues I opened, am assigned or took part in (open and closed). Everything is read without a token: the REST API allows 60 requests an hour, a refresh uses about a dozen and skips commits it already knows. `gh_account` is synced; repositories and issues are device-local caches.

Changed later (2026-10-14): only the 30 most recent problems are kept (on each device, after every fetch and log; migration v13 trimmed existing data). Solves stay on the heatmap as activity events, which now drive this week, this month, last 30 days and the solving streak; sites without a solved total get new solves added to the stored count. The topics and revisit sections were removed (the `cp_revisit` table stays, empty). The rating chart became "Ratings and contributions": GitHub contributions per week sit in a panel below the ratings on the same time axis, with one crosshair and tooltip for both. On the Activity page the Gym streak always shows, counted in weeks, with the share of weeks met.

Known limits: LeetCode history only from the first refresh on (its topic stats cover only those problems); CodeChef shows problem codes, not names, and reads at most 300 past submissions on the first refresh; the LeetCode and CodeChef adapters depend on their websites and may need fixing when those change.

### 6.7 Phase 5, part 1: Sports (2026-10-14)

Built and tested (Rust unit tests with sample payloads, a live test against ESPN and Cricbuzz, browser preview on desktop and phone):
- **Sessions**: log a game or practice (sport, date, minutes, how hard, notes). Minutes feed the existing `sports` activity type, so sessions show on the heatmap and its streaks; the Sports page shows this week, this month, most played and a playing streak that follows the heatmap's rule for Sports.
- **Following** (Rust, `src-tauri/src/sports/`): NBA and football through ESPN's public site API (search, team schedules across every competition, player stats); cricket through Cricbuzz, which has no open API, so the adapter reads the data its pages embed. Cricket search uses a local index of every international and league team plus about 1,100 players: the main national squads and the latest squads of eleven franchise leagues (IPL, PSL, BBL, SA20, The Hundred, CPL, MLC, ILT20, LPL, BPL, Super Smash), with photos. It is built on the first cricket search and kept a week; anyone else can be added by pasting their Cricbuzz profile link. Profiles are fetched by their name slug. Players without international caps show their main league's numbers. Players ESPN or Cricbuzz have no photo for get the lead image of their Wikipedia article, and cricket teams take their logo from their games. Teams show their next fixtures and latest results (live games first, a game between two followed teams once, W/L/D for the followed side).
- **Favourite players**: up to five, in a swipeable carousel on the Sports page with a few headline numbers; each opens a separate Players page (`/sports/players`) with this season and all-time tables. NBA: the season's per-game and total numbers, career per-game, totals and every season. Football: this season by competition and the career by club, all competitions (ESPN reports per club and competition, so these are added up). Cricket: recent batting and bowling, ICC rankings, and career batting and bowling by format (Test, ODI, T20I, IPL).
- **Storage** (migration v10): `sport_sessions` and `sport_follows` (synced; follow ids are `{sport}:{kind}:{source id}` so both devices agree), and device-local caches `sport_games`, `sport_stats` and `sport_index`. Sessions and follows are in search (`in:sports`).
- Games refresh 25 s after unlock and every half hour when over an hour old; player stats at most every six hours (or on demand from the player page).

Known limits: cricket has no per-season numbers on Cricbuzz, so "this season" is recent form; ESPN has no football appearances count (starts instead) and few football headshots; the Cricbuzz adapter depends on its pages and may need fixing when they change. Game reminders followed in part 3 (below).

### 6.9 Phase 5, part 3: Game reminders (2026-10-14)

Followed teams' games are announced before they start (30 minutes by default; Settings > Notifications, "Games", with 10 minutes to 2 hours), through the same notification plan as contests, so Android schedules them as alarms and the desktop as timers. A game between two followed teams is announced once. Today's "Up next" lists games that are live or start within two days, with the home team's crest, alongside contests and important dates. This finishes Phase 5.

Afterwards (same day): **results and player performances**. When a followed team's game goes from upcoming or live to finished between two refreshes, its result is announced ("India won by 14 runs", "IND 172 v WI 158/7"); when a favourite player has a newer game than last time, their line is ("Stephen Curry: 35 pts, 4 reb, 8 ast", "W 111-96 @ Phoenix Suns"; cricket from Cricbuzz's recent innings, NBA and football from ESPN's game logs, now fetched every refresh while full stats stay six-hourly). The first game seen only sets the baseline, nothing older than 36 hours is announced, and `sport_alerts` (device-local, migration v12) keeps each announced once per device. While a followed team is playing, the app refreshes every ten minutes.
- **Muting** (`sport_mutes`, synced): `game:{sport}:{id}` silences one game's reminder and result, `follow:{id}` a team or player. A bell on each upcoming game, "Mute notifications" in a team's menu, a bell on the player page, and per-device switches for results and performances in Settings.
- **Android**: reminders, results and performances are posted natively (`SportsNotifier.kt`, called from Rust over JNI with the app's class loader) with a **Mute** button. Reminders are exact alarms; tapping Mute appends to `pending-mutes` in the data folder, so it works with the app locked or closed, and Rust moves those into `sport_mutes` the next time the database is open. With background sync on, the WorkManager job also checks teams with a game under way and favourite players every ~15 minutes and posts what it finds. On the desktop, results and performances are ordinary notifications while the app runs; muting is in the app.

### 6.8 Phase 5, part 2: Gym (2026-10-14)

Built and tested (unit tests for the gym logic and for encrypted attachments, browser preview on desktop and phone):
- **Library**: 80 built-in exercises (ids `ex:{slug}`, seeded by migration v11 before its clock triggers, so they never sync) plus my own, each with a muscle, equipment and what its sets record: weight and reps, reps, time, or time and distance.
- **Routines**: named lists of exercises with target sets and reps; Push, Pull and Legs can be added in one tap. Starting one fills a workout with its exercises and last time's numbers.
- **Live logging** (`/fitness/workout`): one workout in progress at a time, kept in the database so it survives restarts; per set weight, reps, RPE and warm-up; the previous workout's sets alongside; ticking a set starts the rest timer (default 90 s, set per device), which chimes, vibrates and notifies when the app is in the background. Finishing drops unticked sets, totals the volume and marks the day on the heatmap (the `gym` type, counted in weeks). Past workouts can be logged ("Log past" beside Start: date, start time, length, and optionally a routine whose sets come in ticked with the weights used before that day; sets of a finished workout always count: ticking is only for live workouts, so finished ones show no ticks; migration v14 ticked sets left unticked in earlier past workouts and recomputed their volume) and edited; a workout can be saved as a routine.
- **Records and progress** (`/fitness/exercises`): heaviest weight, best estimated 1RM (Epley, up to 12 reps), best set volume, most reps, longest time or distance; new records are marked on the set and listed when finishing. Each exercise has a progress chart and its history.
- **Body parts trained**: a heatmap of the last three months of gym days (under the weekly charts, above routines) coloured by body region (chest, back, shoulders, arms, legs, core, other; the validated categorical palette with dark steps), striped with one band per region trained that day (most worked first), a legend to show one region's days, and a tooltip listing the workouts and sets per region.
- **Overview**: sessions this week against the weekly target, volume, gym streak, bodyweight, 12 weeks of volume or workouts, and working sets per muscle this week against the four weeks before.
- **Body** (`/fitness/body`): weight, body fat and six measurements, one entry per day (`bm:{date}`), with a trend chart; progress photos are shrunk to 1600 px and stored as attachments encrypted with the database key. Attachment rows sync; the files stay on the device that took them.
- Units (kg or lb) are a device setting; weights are stored in kg. Workouts, exercises and routines are in search (`in:gym`), and the palette has "Log a workout".

## 7. Open questions

Answered: Android 16, CSV statements, sync via Google Drive (dedicated account) plus LAN / Tailscale (college Wi-Fi blocks LAN), React, LLM on laptop only, package `com.matt.kaizen`, Spotify Premium (yes), attendance minimum 80%, sports teams and players followed from inside the app, debts in ₹ only, bank is PNB, timetable entered manually (weekly) with extra classes, cancellations, holidays and vacations, labs/tutorials counted separately as an option, medical/duty leave counts as present, extra modules chosen (section 3), Finance built last.

Still open:
1. Which download formats does PNB offer for statements (CSV, XLS/XLSX, PDF)? A sample statement (with numbers blanked) will help build the profile. Needed by Phase 9.

**Project identity**
- App name: Kaizen (continuous small improvement). Identifier / Android package: `com.matt.kaizen`.
- Phone: Nothing (model A059), Android 16 (API 36), arm64-v8a. Dev builds can target `aarch64` only for faster compiles. Nothing OS is close to stock Android, so battery-saver restrictions should be mild. Target SDK 36; minimum SDK left at 24 (Tauri default), since only one phone needs support.
- Android 16 implications: edge-to-edge layout is mandatory (handle system bar insets / safe areas from Phase 0), predictive back gesture should be supported, and exact alarms need the `USE_EXACT_ALARM` or `SCHEDULE_EXACT_ALARM` permission (fine for a sideloaded app).
