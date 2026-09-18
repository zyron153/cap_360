// Cabo Verde is UTC-1 year-round (no DST) — fixed offset, no timezone DB needed.
const CV_OFFSET = "-01:00";

/** Start of a "YYYY-MM-DD" calendar day in Cabo Verde local time, as a UTC Date. */
export function cvDayStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000${CV_OFFSET}`);
}

/** End of a "YYYY-MM-DD" calendar day in Cabo Verde local time, as a UTC Date. */
export function cvDayEnd(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999${CV_OFFSET}`);
}
