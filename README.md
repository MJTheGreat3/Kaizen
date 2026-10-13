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
- **College timetable and important dates**: class reminders, attendance tracking, countdowns
- **Whiteboard and idea scrapbook**: free-form canvas and zero-friction capture
- **Universal search**: across everything, with a command palette

## Principles

- **Local-first**: encrypted SQLite on each device, works fully offline
- **No cloud**: laptop and phone sync directly over the local network
- **Single user**: no accounts, no servers

## Stack

Tauri 2 (Rust) · React · TypeScript · Tailwind CSS · SQLite + SQLCipher

## Status

Planning. See [PLAN.md](PLAN.md) for the full design and roadmap.
