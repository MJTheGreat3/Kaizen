import { describe, expect, it } from "vitest";

import { parseDebt, parseTask } from "./parse";

// Tuesday 13 October 2026, 10:00.
const now = new Date(2026, 9, 13, 10, 0);

describe("parseTask", () => {
  it("pulls date, time, tag and priority out of the title", () => {
    const t = parseTask("submit OS assignment friday 5pm #college !high", now);
    expect(t).toMatchObject({
      list: "todo",
      title: "submit OS assignment",
      dueDate: "2026-10-16",
      dueTime: "17:00",
      tags: ["college"],
      priority: 3,
    });
  });

  it("drops connectors left before a date", () => {
    expect(parseTask("finish report by tomorrow", now)).toMatchObject({
      title: "finish report",
      dueDate: "2026-10-14",
      dueTime: null,
    });
  });

  it("routes watch and read items to their lists", () => {
    expect(parseTask("watch Dune part two", now)).toMatchObject({ list: "watch", title: "Dune part two" });
    expect(parseTask("read Designing Data-Intensive Applications", now)).toMatchObject({
      list: "read",
      title: "Designing Data-Intensive Applications",
    });
    expect(parseTask("Interstellar @watch", now)).toMatchObject({ list: "watch", title: "Interstellar" });
  });

  it("keeps a dated read task on the to-do list", () => {
    expect(parseTask("read chapter 4 tomorrow", now)).toMatchObject({ list: "todo", title: "read chapter 4" });
  });

  it("understands recurrence", () => {
    expect(parseTask("call mom every sunday 8pm", now)).toMatchObject({
      title: "call mom",
      recurrence: "weekly",
      dueDate: "2026-10-18",
      dueTime: "20:00",
    });
    expect(parseTask("drink water daily", now)).toMatchObject({
      title: "drink water",
      recurrence: "daily",
      dueDate: "2026-10-13",
    });
  });

  it("uses !, !! and !!! for priority", () => {
    expect(parseTask("a !", now).priority).toBe(1);
    expect(parseTask("a !!", now).priority).toBe(2);
    expect(parseTask("a !!!", now).priority).toBe(3);
  });
});

describe("parseDebt", () => {
  it("records money owed to me", () => {
    expect(parseDebt("Rahul owes 250 for pizza yesterday", now)).toEqual({
      type: "debt",
      person: "Rahul",
      direction: "owed_to_me",
      amountPaise: 25000,
      reason: "pizza",
      occurredOn: "2026-10-12",
    });
  });

  it("records money I owe", () => {
    expect(parseDebt("I owe priya 1,200 for cab to airport", now)).toMatchObject({
      type: "debt",
      person: "Priya",
      direction: "i_owe",
      amountPaise: 120000,
      reason: "cab to airport",
      occurredOn: "2026-10-13",
    });
  });

  it("understands lent, borrowed and k amounts", () => {
    expect(parseDebt("lent Aman 1.5k for concert tickets", now)).toMatchObject({
      direction: "owed_to_me",
      person: "Aman",
      amountPaise: 150000,
    });
    expect(parseDebt("borrowed ₹500 from Neha for books", now)).toMatchObject({
      direction: "i_owe",
      person: "Neha",
      amountPaise: 50000,
      reason: "books",
    });
  });

  it("records repayments both ways", () => {
    expect(parseDebt("Rahul paid me back 100", now)).toMatchObject({
      type: "payment",
      direction: "to_me",
      person: "Rahul",
      amountPaise: 10000,
    });
    expect(parseDebt("paid Priya back 600", now)).toMatchObject({
      type: "payment",
      direction: "from_me",
      person: "Priya",
      amountPaise: 60000,
    });
  });

  it("returns null for text that isn't a debt", () => {
    expect(parseDebt("buy milk", now)).toBeNull();
  });
});
