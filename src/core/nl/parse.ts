/**
 * Natural-language parsing for quick capture. Rule based and offline:
 * chrono-node finds dates and times, and simple patterns find the rest.
 */
import * as chrono from "chrono-node";

import type { Recurrence, TaskList } from "@/core/db/schema";
import { minutesToTime, toKey, type DateKey } from "@/lib/dates";
import { parseRupees } from "@/lib/money";

export interface ParsedTask {
  list: TaskList;
  title: string;
  dueDate: DateKey | null;
  dueTime: string | null;
  recurrence: Recurrence | null;
  priority: number;
  tags: string[];
}

const RECURRENCE_PATTERNS: [RegExp, Recurrence][] = [
  [/\bevery\s*day\b|\bdaily\b/i, "daily"],
  [/\bevery\s*weekday\b|\bon\s+weekdays\b/i, "weekdays"],
  [/\bevery\s*week\b|\bweekly\b/i, "weekly"],
  [/\bevery\s*month\b|\bmonthly\b/i, "monthly"],
  [/\bevery\s*year\b|\byearly\b|\bannually\b/i, "yearly"],
];

const WEEKDAY_EVERY = /\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/i;

function squash(text: string): string {
  return text.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}

/**
 * "submit OS assignment friday 5pm #college !high" becomes a to-do due on
 * Friday at 17:00 with tag `college` and high priority. "watch Dune" and
 * "read Atomic Habits" go to the watch and read lists.
 */
export function parseTask(input: string, now = new Date(), defaultList: TaskList = "todo"): ParsedTask {
  let text = ` ${input} `;
  const tags: string[] = [];
  let priority = 0;
  let list: TaskList | null = null;
  let recurrence: Recurrence | null = null;

  text = text.replace(/\s#([\p{L}\p{N}_-]+)/gu, (_, tag: string) => {
    tags.push(tag.toLowerCase());
    return " ";
  });

  text = text.replace(/\s(!{1,3}|!(?:high|med(?:ium)?|low|[123]))(?=\s)/gi, (_, mark: string) => {
    const m = mark.toLowerCase();
    priority =
      m === "!!!" || m === "!high" || m === "!3" ? 3 : m === "!!" || m.startsWith("!med") || m === "!2" ? 2 : 1;
    return " ";
  });

  text = text.replace(/\s@(todo|watch|read)\b/gi, (_, l: string) => {
    list = l.toLowerCase() as TaskList;
    return " ";
  });

  const everyDay = text.match(WEEKDAY_EVERY);
  if (everyDay) {
    recurrence = "weekly";
    // Keep the weekday so chrono sets the first due date.
    text = text.replace(WEEKDAY_EVERY, everyDay[1]);
  } else {
    for (const [pattern, value] of RECURRENCE_PATTERNS) {
      if (pattern.test(text)) {
        recurrence = value;
        text = text.replace(pattern, " ");
        break;
      }
    }
  }

  let dueDate: DateKey | null = null;
  let dueTime: string | null = null;
  const results = chrono.parse(text, now, { forwardDate: true });
  if (results.length) {
    const r = results[0];
    const date = r.start.date();
    dueDate = toKey(date);
    if (r.start.isCertain("hour")) dueTime = minutesToTime(date.getHours() * 60 + date.getMinutes());
    text = text.slice(0, r.index) + " " + text.slice(r.index + r.text.length);
    // Drop a dangling connector left behind ("submit report by", "call mom on").
    text = text.replace(/\s(by|on|at|due|before)\s*$/i, " ");
  }
  if (recurrence && !dueDate) dueDate = toKey(now);

  let title = squash(text);
  if (!list) {
    const verb = title.match(/^(watch|read)\s+(.+)$/i);
    if (verb && !dueDate) {
      list = verb[1].toLowerCase() as TaskList;
      title = verb[2];
    }
  }

  return { list: list ?? defaultList, title, dueDate, dueTime, recurrence, priority, tags };
}

// ---------------------------------------------------------------------------
// Debts
// ---------------------------------------------------------------------------

export type ParsedDebt =
  | {
      type: "debt";
      person: string;
      direction: "owed_to_me" | "i_owe";
      amountPaise: number;
      reason: string | null;
      occurredOn: DateKey;
    }
  | {
      type: "payment";
      person: string;
      direction: "to_me" | "from_me";
      amountPaise: number;
      reason: string | null;
      occurredOn: DateKey;
    };

const AMOUNT = String.raw`(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?\s*k?)`;
const NAME = String.raw`([\p{L}][\p{L} .'-]*?)`;
const REST = String.raw`(?:\s+(?:for|towards|because of|as)\s+(.+))?`;

const DEBT_PATTERNS: { re: RegExp; build: (m: RegExpMatchArray) => Omit<ParsedDebt, "occurredOn"> | null }[] = [
  // "Rahul owes me 250 for pizza", "Rahul owes 250"
  {
    re: new RegExp(String.raw`^${NAME}\s+owes(?:\s+me)?\s+${AMOUNT}${REST}$`, "iu"),
    build: (m) => debt(m[1], "owed_to_me", m[2], m[3]),
  },
  // "I owe Priya 1200 for the cab"
  {
    re: new RegExp(String.raw`^i\s+owe\s+${NAME}\s+${AMOUNT}${REST}$`, "iu"),
    build: (m) => debt(m[1], "i_owe", m[2], m[3]),
  },
  // "lent Rahul 500 for movie tickets"
  {
    re: new RegExp(String.raw`^(?:i\s+)?lent\s+${NAME}\s+${AMOUNT}${REST}$`, "iu"),
    build: (m) => debt(m[1], "owed_to_me", m[2], m[3]),
  },
  // "borrowed 500 from Rahul for books"
  {
    re: new RegExp(String.raw`^(?:i\s+)?borrowed\s+${AMOUNT}\s+from\s+${NAME}${REST}$`, "iu"),
    build: (m) => debt(m[2], "i_owe", m[1], m[3]),
  },
  // "Rahul paid me 100", "Rahul paid back 100", "got 100 from Rahul"
  {
    re: new RegExp(String.raw`^${NAME}\s+(?:paid|returned|gave)(?:\s+me)?(?:\s+back)?\s+${AMOUNT}${REST}$`, "iu"),
    build: (m) => payment(m[1], "to_me", m[2], m[3]),
  },
  {
    re: new RegExp(String.raw`^(?:got|received)\s+${AMOUNT}\s+(?:back\s+)?from\s+${NAME}${REST}$`, "iu"),
    build: (m) => payment(m[2], "to_me", m[1], m[3]),
  },
  // "paid Rahul back 100", "I paid Rahul 100"
  {
    re: new RegExp(String.raw`^(?:i\s+)?(?:paid|returned)\s+${NAME}(?:\s+back)?\s+${AMOUNT}${REST}$`, "iu"),
    build: (m) => payment(m[1], "from_me", m[2], m[3]),
  },
];

function cleanName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

function debt(name: string, direction: "owed_to_me" | "i_owe", amount: string, reason?: string) {
  const amountPaise = parseRupees(amount);
  if (!amountPaise) return null;
  return { type: "debt" as const, person: cleanName(name), direction, amountPaise, reason: reason?.trim() || null };
}

function payment(name: string, direction: "to_me" | "from_me", amount: string, reason?: string) {
  const amountPaise = parseRupees(amount);
  if (!amountPaise) return null;
  return { type: "payment" as const, person: cleanName(name), direction, amountPaise, reason: reason?.trim() || null };
}

/** Parses "Rahul owes 250 for pizza yesterday" and similar. */
export function parseDebt(input: string, now = new Date()): ParsedDebt | null {
  let text = input.trim();
  let occurredOn = toKey(now);
  const results = chrono.parse(text, now, { forwardDate: false });
  const last = results.at(-1);
  if (last) {
    occurredOn = toKey(last.start.date());
    text = squash(text.slice(0, last.index) + " " + text.slice(last.index + last.text.length)).replace(
      /\s+(on|at)$/i,
      "",
    );
  }
  for (const { re, build } of DEBT_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const parsed = build(m);
      if (parsed) return { ...parsed, occurredOn } as ParsedDebt;
    }
  }
  return null;
}
