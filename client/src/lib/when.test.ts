import { describe, expect, it } from "vitest";
import { formatDay, formatFull, formatWhen } from "./when";

const now = new Date(2026, 10, 18, 14, 30);
const time = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

describe("formatWhen", () => {
  it("says Today and Yesterday with the time", () => {
    const today = new Date(2026, 10, 18, 0, 5);
    const yesterday = new Date(2026, 10, 17, 23, 59);
    expect(formatWhen(today, now)).toBe(`Today ${time(today)}`);
    expect(formatWhen(yesterday, now)).toBe(`Yesterday ${time(yesterday)}`);
  });

  it("drops the time for older days and adds the year only for another year", () => {
    const older = formatWhen(new Date(2026, 10, 15, 9), now);
    expect(older).not.toMatch(/Today|Yesterday|2026/);
    expect(older).toMatch(/15/);
    expect(formatWhen(new Date(2025, 10, 15, 9), now)).toMatch(/2025/);
  });

  it("accepts epoch numbers and ISO strings", () => {
    const d = new Date(2026, 10, 18, 9, 0);
    expect(formatWhen(d.getTime(), now)).toBe(formatWhen(d.toISOString(), now));
  });

  it("gives a full timestamp for titles", () => {
    expect(formatFull(new Date(2026, 10, 18, 9, 0))).toMatch(/2026/);
  });
});

describe("formatDay", () => {
  it("reads a date-only value as that local day", () => {
    expect(formatDay("2026-11-21", now)).toBe(
      new Date(2026, 10, 21).toLocaleDateString([], { day: "numeric", month: "short" }),
    );
    expect(formatDay("2025-01-02", now)).toMatch(/2025/);
  });
});
