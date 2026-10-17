/**
 * Turns the notification plan into real notifications.
 *
 * Android: alarms scheduled with the OS, so they fire while the app is
 * closed (and survive reboots). Desktop: timers while the app is running.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getAllPrefs } from "@/core/db/prefs";
import { log } from "@/lib/log";
import { loadCalendar, loadDates } from "@/modules/calendar/data";
import { loadDebts } from "@/modules/debts/data";
import { currentStreaks } from "@/modules/activity/milestones";
import { goalReminders } from "@/modules/goals/watch";
import { loadFinance } from "@/modules/finance/data";
import { formatPaise } from "@/lib/money";
import { loadContests } from "@/modules/practice/data";
import { gameMuteId, isGameMuted, loadMatches, loadMutes } from "@/modules/sports/data";
import { ipc } from "@/lib/ipc";
import { platformOf } from "@/modules/practice/logic";
import { loadHabits } from "@/modules/habits/data";
import { loadTasks } from "@/modules/lists/data";
import { buildPlan, matchReminders, notificationId, type PlannedNotification } from "./plan";

const STORE_KEY = "kaizen.notifications.scheduled";
const CHANNEL = "reminders";
const MAX_SCHEDULED = 60;

type Platform = "android" | "desktop";
let desktopTimers: ReturnType<typeof setTimeout>[] = [];

async function plugin() {
  return import("@tauri-apps/plugin-notification");
}

export async function notificationsAllowed(): Promise<boolean> {
  try {
    // Android answers null while the user hasn't decided yet.
    return (await (await plugin()).isPermissionGranted()) === true;
  } catch {
    return false;
  }
}

export async function requestNotifications(): Promise<boolean> {
  try {
    const n = await plugin();
    if ((await n.isPermissionGranted()) === true) return true;
    return (await n.requestPermission()) === "granted";
  } catch (e) {
    log.warn(`notification permission request failed: ${String(e)}`);
    return false;
  }
}

async function ensureChannel() {
  const n = await plugin();
  try {
    const channels = await n.channels();
    if (!channels.some((c) => c.id === CHANNEL)) {
      await n.createChannel({ id: CHANNEL, name: "Reminders", description: "Classes, tasks, habits and dates", importance: n.Importance.High, visibility: n.Visibility.Private, vibration: true });
    }
  } catch (e) {
    log.warn(`notification channel setup failed: ${String(e)}`);
  }
}

function readScheduled(): number[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function writeScheduled(ids: number[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable; worst case old alarms are cancelled next time.
  }
}

async function applyAndroid(plan: PlannedNotification[]) {
  const n = await plugin();
  await ensureChannel();
  const previous = readScheduled();
  if (previous.length) await n.cancel(previous);
  const next = plan.slice(0, MAX_SCHEDULED);
  for (const item of next) {
    n.sendNotification({
      id: notificationId(item.key),
      channelId: CHANNEL,
      title: item.title,
      body: item.body,
      schedule: n.Schedule.at(item.at, false, true),
    });
  }
  writeScheduled(next.map((i) => notificationId(i.key)));
}

async function applyDesktop(plan: PlannedNotification[]) {
  const n = await plugin();
  desktopTimers.forEach(clearTimeout);
  desktopTimers = [];
  const horizon = Date.now() + 24 * 60 * 60 * 1000;
  for (const item of plan) {
    const delay = item.at.getTime() - Date.now();
    if (delay <= 0 || item.at.getTime() > horizon) continue;
    desktopTimers.push(setTimeout(() => n.sendNotification({ title: item.title, body: item.body }), delay));
  }
}

/** Rebuilds the plan from the database and (re)schedules everything. */
export async function syncNotifications(platform: Platform) {
  if (!(await notificationsAllowed())) return;
  const [prefs, tasks, habits, calendar, dates, debts, streaks, goals, contests, games, mutes, money] = await Promise.all([
    getAllPrefs(),
    loadTasks(),
    loadHabits(14),
    loadCalendar(),
    loadDates(),
    loadDebts(),
    currentStreaks(),
    goalReminders(),
    loadContests(),
    loadMatches(),
    loadMutes(),
    loadFinance(),
  ]);
  const bills = money.recurring
    .filter((r) => r.active)
    .map((r) => ({ id: r.id, name: r.name, nextOn: r.nextOn, amount: formatPaise(r.amountPaise), kind: r.kind, auto: r.auto }));
  const chosen = contests
    .filter((c) => prefs["practice.contestPlatforms"].includes(c.platform))
    .map((c) => ({ id: c.id, name: c.name, startAt: c.startAt, site: platformOf(c.platform)?.name ?? c.platform }));
  const upcoming = games.filter((g) => g.state === "pre" && !isGameMuted(g, mutes));
  const matches = upcoming.map((g) => ({ id: g.id, title: `${g.home} v ${g.away}`, startAt: g.startAt, detail: [g.league, g.title].filter(Boolean).join(" · ") }));
  // Android schedules game reminders natively, with a Mute button.
  const native =
    platform === "android" &&
    (await ipc
      .sportsSchedule(
        matchReminders(matches, prefs)
          .filter((n) => n.at.getTime() > Date.now() && n.at.getTime() < Date.now() + 7 * 86_400_000)
          .map((n) => {
            const g = upcoming.find((x) => x.id === n.match.id)!;
            return { key: n.key, at: n.at.getTime(), title: n.title, body: n.body, muteId: gameMuteId(g), url: g.url };
          }),
      )
      .catch((e) => {
        log.warn(`game reminders failed: ${String(e)}`);
        return false;
      }));
  const plan = buildPlan({ now: new Date(), prefs, tasks, habits, calendar, dates, debts, streaks, goals, bills, contests: chosen, matches: native ? [] : matches });
  if (platform === "android") await applyAndroid(plan);
  else await applyDesktop(plan);
  log.info(`scheduled ${plan.length} notifications`);
}

/**
 * Keeps notifications in step with the data while unlocked: on unlock,
 * shortly after any change, and every 30 minutes.
 */
export function useNotificationSync(enabled: boolean, platform: Platform) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => syncNotifications(platform).catch((e) => log.warn(`notification sync failed: ${String(e)}`));
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(run, 2_000);
    };
    soon();
    const interval = setInterval(run, 30 * 60 * 1000);
    const unsubscribe = client.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.mutation.state.status === "success") soon();
    });
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      unsubscribe();
    };
  }, [enabled, platform, client]);
}
