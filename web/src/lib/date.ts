type DateInput = Date | number | string;

function asDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

function format(value: DateInput, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", options).format(asDate(value));
}

export function formatShortDate(value: DateInput, twoDigitDay = false): string {
  return format(value, {
    month: "short",
    day: twoDigitDay ? "2-digit" : "numeric",
    year: "numeric",
  });
}

export function formatShortDateTime(value: DateInput): string {
  return format(value, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatClock(value: DateInput): string {
  return format(value, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export function formatClockWithSeconds(value: DateInput): string {
  return format(value, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).toLowerCase();
}

export function formatMonthDay(value: DateInput): string {
  return format(value, { month: "short", day: "numeric" });
}

export function formatMonthYear(value: DateInput): string {
  return format(value, { month: "short", year: "numeric" });
}

export function differenceInWholeDays(end: DateInput, start: DateInput): number {
  return Math.trunc((asDate(end).getTime() - asDate(start).getTime()) / 86_400_000);
}

export function formatRelativeToNow(value: DateInput): string {
  const deltaSeconds = Math.round((asDate(value).getTime() - Date.now()) / 1_000);
  const absoluteSeconds = Math.abs(deltaSeconds);
  const formatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

  if (absoluteSeconds < 60) return formatter.format(deltaSeconds, "second");
  const minutes = Math.round(deltaSeconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(months, "month");
  return formatter.format(Math.round(months / 12), "year");
}
