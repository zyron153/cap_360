import { cvDayStart, cvDayEnd } from "./cabo-verde-time";

describe("cabo-verde-time", () => {
  it("cvDayStart converts local midnight to the correct UTC instant", () => {
    // 2026-09-18 00:00 in Cabo Verde (UTC-1) is 2026-09-18 01:00 UTC.
    expect(cvDayStart("2026-09-18").toISOString()).toBe("2026-09-18T01:00:00.000Z");
  });

  it("cvDayEnd converts local end-of-day to the correct UTC instant", () => {
    // 2026-09-18 23:59:59.999 in Cabo Verde (UTC-1) is 2026-09-19 00:59:59.999 UTC —
    // the bug this fixes: entries in that last local hour were previously excluded
    // because a bare `${to}T23:59:59Z` cut off an hour too early.
    expect(cvDayEnd("2026-09-18").toISOString()).toBe("2026-09-19T00:59:59.999Z");
  });

  it("a timestamp in the last local hour of the day falls within that day's range", () => {
    const lastLocalHour = new Date("2026-09-18T23:30:00-01:00");
    expect(lastLocalHour >= cvDayStart("2026-09-18")).toBe(true);
    expect(lastLocalHour <= cvDayEnd("2026-09-18")).toBe(true);
  });
});
