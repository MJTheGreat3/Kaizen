import { describe, expect, it } from "vitest";

import { nextOccurrence } from "./data";

describe("nextOccurrence", () => {
  it("handles one-off dates", () => {
    expect(nextOccurrence({ date: "2026-11-02", recurrence: "none" }, "2026-10-13")).toBe("2026-11-02");
    expect(nextOccurrence({ date: "2026-10-01", recurrence: "none" }, "2026-10-13")).toBeNull();
  });

  it("rolls yearly dates to this year or next", () => {
    expect(nextOccurrence({ date: "2004-12-25", recurrence: "yearly" }, "2026-10-13")).toBe("2026-12-25");
    expect(nextOccurrence({ date: "2004-03-05", recurrence: "yearly" }, "2026-10-13")).toBe("2027-03-05");
    expect(nextOccurrence({ date: "2004-10-13", recurrence: "yearly" }, "2026-10-13")).toBe("2026-10-13");
  });

  it("clamps monthly dates to short months", () => {
    expect(nextOccurrence({ date: "2026-01-31", recurrence: "monthly" }, "2026-11-05")).toBe("2026-11-30");
    expect(nextOccurrence({ date: "2026-01-10", recurrence: "monthly" }, "2026-10-13")).toBe("2026-11-10");
  });
});
