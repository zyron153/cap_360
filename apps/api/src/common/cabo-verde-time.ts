// Cabo Verde is UTC-1 year-round (no DST) — fixed offset, no timezone DB needed.
const CV_OFFSET = "-01:00";

const p2 = (n: number) => String(n).padStart(2, "0");

export interface CvParts {
  year: number;
  month: number;
  day: number;
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM:SS" */
  time: string;
  /** "YYYY-MM-DDTHH:MM:SS" (no zone suffix — the platform's datetime format) */
  dateTime: string;
  /** "YYMMDD" and "YYMMDDHHMMSS", as embedded in IUDs / event ids */
  yymmdd: string;
  yymmddhhmmss: string;
}

/** Wall-clock components of an instant in Cabo Verde local time (UTC-1, no DST). */
export function cvParts(instant: Date): CvParts {
  const d = new Date(instant.getTime() - 3_600_000); // shift, then read the UTC fields
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hh = p2(d.getUTCHours());
  const mm = p2(d.getUTCMinutes());
  const ss = p2(d.getUTCSeconds());
  const date = `${year}-${p2(month)}-${p2(day)}`;
  const yymmdd = `${p2(year % 100)}${p2(month)}${p2(day)}`;
  return {
    year, month, day, date,
    time: `${hh}:${mm}:${ss}`,
    dateTime: `${date}T${hh}:${mm}:${ss}`,
    yymmdd,
    yymmddhhmmss: `${yymmdd}${hh}${mm}${ss}`,
  };
}

/** Start of a "YYYY-MM-DD" calendar day in Cabo Verde local time, as a UTC Date. */
export function cvDayStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000${CV_OFFSET}`);
}

/** End of a "YYYY-MM-DD" calendar day in Cabo Verde local time, as a UTC Date. */
export function cvDayEnd(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999${CV_OFFSET}`);
}
