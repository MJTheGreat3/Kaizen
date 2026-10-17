import { describe, expect, it } from "vitest";

import { defaultPrefs } from "@/core/db/prefs";
import type { Habit, ImportantDate, Semester, Subject, Task, TimetableSlot } from "@/core/db/schema";
import { buildPlan, notificationId } from "./plan";

const base = { createdAt: 0, updatedAt: 0, deletedAt: null, deviceId: "d" };
// Tuesday 13 Oct 2026, 08:00.
const now = new Date(2026, 9, 13, 8, 0);

const semester = { id: "s", name: "S5", startDate: "2026-09-14", endDate: "2026-12-18", target: 80, separateLabs: false, separateTutorials: false, unmarkedDefault: "unmarked", reminderMinutes: 10, isActive: true, ...base } as Semester;
const subject = { id: "ds", semesterId: "s", name: "Data Structures", code: null, professor: null, color: "#000", target: null, ...base } as Subject;
const slot = { id: "a", semesterId: "s", subjectId: "ds", weekday: 2, startMin: 540, endMin: 600, kind: "lecture", room: "LT-1", weekParity: "all", ...base } as TimetableSlot;

function plan(overrides: Partial<Parameters<typeof buildPlan>[0]> = {}) {
  return buildPlan({
    now,
    prefs: { ...defaultPrefs, "notify.digest": "" },
    tasks: [],
    habits: { habits: [], values: new Map() },
    calendar: { semester, subjects: [subject], slots: [slot], exceptions: [], marks: [] },
    dates: [],
    debts: { people: [], debts: [], payments: [], balance: new Map() },
    ...overrides,
  });
}

describe("buildPlan", () => {
  it("reminds before each class and asks about attendance after", () => {
    const today = plan().filter((n) => n.at.getDate() === 13);
    expect(today.map((n) => [n.title, n.at.getHours(), n.at.getMinutes()])).toEqual([
      ["Data Structures in 10 min", 8, 50],
      ["Attended Data Structures?", 10, 0],
    ]);
  });

  it("skips attendance prompts for marked classes and respects toggles", () => {
    const marked = plan({
      calendar: { semester, subjects: [subject], slots: [slot], exceptions: [], marks: [{ classKey: "2026-10-13:a" } as never] },
      prefs: { ...defaultPrefs, "notify.digest": "", "notify.classes": false },
    });
    expect(marked.filter((n) => n.at.getDate() === 13)).toEqual([]);
  });

  it("schedules task, habit and date reminders, never in the past", () => {
    const tasks = [
      { id: "t", list: "todo", title: "Submit report", status: "open", dueDate: "2026-10-13", dueTime: "17:00", remind: true, ...base } as Task,
      { id: "old", list: "todo", title: "Old", status: "open", dueDate: "2026-10-12", dueTime: "17:00", remind: true, ...base } as Task,
    ];
    const habit = { id: "h", name: "Read", kind: "check", target: 1, schedule: { type: "daily" }, reminderTime: "21:00", startDate: "2026-10-01", ...base } as Habit;
    const date = { id: "b", title: "Mom's birthday", kind: "birthday", date: "1970-10-14", recurrence: "yearly", remindOffsets: [0, 1], ...base } as ImportantDate;
    const p = plan({ tasks, habits: { habits: [habit], values: new Map([["h", new Map([["2026-10-13", 1]])]]) }, dates: [date] });
    const titles = p.map((n) => `${n.at.getDate()} ${n.title}`);
    expect(titles).toContain("13 Submit report");
    expect(titles).not.toContain("12 Old");
    expect(titles).not.toContain("13 Read");
    expect(titles).toContain("14 Read");
    expect(titles).toContain("13 Mom's birthday tomorrow");
    expect(titles).toContain("14 Mom's birthday today");
  });

  it("nudges in the evening only for daily streaks at risk", () => {
    const titles = plan({
      streaks: [
        { name: "Reading", current: 12, doneToday: false, unit: "days" },
        { name: "Tasks", current: 5, doneToday: true, unit: "days" },
        { name: "Habits", current: 2, doneToday: false, unit: "days" },
        { name: "Gym", current: 4, doneToday: false, unit: "weeks" },
      ],
    })
      .filter((n) => n.key.startsWith("streak:"))
      .map((n) => [n.title, n.at.getHours(), n.at.getMinutes()]);
    expect(titles).toEqual([["Keep your 12-day Reading streak", 20, 30]]);
  });

  it("reminds a week and a day before a goal's finish date", () => {
    const goals = plan({ goals: [{ id: "g", title: "100 h reading", targetDate: "2026-10-17", left: "Behind: 12 h to go" }] }).filter((n) => n.key.startsWith("goal:"));
    expect(goals.map((n) => [n.title, n.body])).toEqual([["100 h reading: due tomorrow", "Behind: 12 h to go"]]);
  });

  it("reminds the day before a bill, and on the day when it waits to be marked paid", () => {
    const bills = plan({
      bills: [
        { id: "s", name: "Spotify", nextOn: "2026-10-15", amount: "₹119", kind: "expense", auto: false },
        { id: "a", name: "Allowance", nextOn: "2026-10-15", amount: "₹5,000", kind: "income", auto: true },
      ],
    }).filter((n) => n.key.startsWith("bill:"));
    expect(bills.map((n) => n.title)).toEqual(["Spotify due tomorrow", "Spotify is due today"]);
  });

  it("announces contests ahead of their start", () => {
    const start = new Date(2026, 9, 14, 20, 0).getTime();
    const n = plan({ contests: [{ id: "cc:START260", name: "Starters 260", startAt: start, site: "CodeChef" }] }).filter((x) => x.key.startsWith("contest:"));
    expect(n.map((x) => [x.title, x.at.getHours()])).toEqual([["Starters 260 starts in 1 h", 19]]);
  });

  it("announces followed teams' games ahead of their start", () => {
    const start = new Date(2026, 9, 14, 19, 30).getTime();
    const n = plan({ matches: [{ id: "151598", title: "India v West Indies", startAt: start, detail: "West Indies tour of India · 4th T20I" }] }).filter((x) => x.key.startsWith("match:"));
    expect(n.map((x) => [x.title, x.body, x.at.getHours(), x.at.getMinutes()])).toEqual([["India v West Indies starts in 30 min", "West Indies tour of India · 4th T20I", 19, 0]]);
  });

  it("makes stable positive ids", () => {
    expect(notificationId("class:x")).toBe(notificationId("class:x"));
    expect(notificationId("class:x")).toBeGreaterThan(0);
    expect(notificationId("class:x")).not.toBe(notificationId("class:y"));
  });
});
