/** One way to show a time (docs/DESIGN_SYSTEM.md section 4): "Today 08:41", "Yesterday 16:02", "15 Nov",
 *  "15 Nov 2025" for another year. `formatFull` gives the whole timestamp for a `title` or a history. */
export function formatWhen(value: number | string | Date, now: Date = new Date()): string {
  const date = new Date(value);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const t = date.getTime();
  if (t >= startOfToday && t < startOfToday + day) return `Today ${time}`;
  if (t >= startOfToday - day && t < startOfToday) return `Yesterday ${time}`;
  return date.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

export function formatFull(value: number | string | Date): string {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/** A date-only value from the API ("2026-11-21") as "21 Nov", read as a local day (not UTC midnight). */
export function formatDay(isoDate: string, now: Date = new Date()): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(y!, (m ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}
