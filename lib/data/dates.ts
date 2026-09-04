/** YYYYMMDD integer helpers. */
export function ymdFromDate(d: Date, tz = "America/New_York"): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return get("year") * 10000 + get("month") * 100 + get("day");
}

export function ymdFromIso(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return y * 10000 + m * 100 + d;
}

export function isoFromYmd(ymd: number): string {
  const y = Math.floor(ymd / 10000);
  const m = Math.floor((ymd % 10000) / 100);
  const d = ymd % 100;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function ymdToUtcDate(ymd: number): Date {
  return new Date(Date.UTC(Math.floor(ymd / 10000), Math.floor((ymd % 10000) / 100) - 1, ymd % 100));
}

export function daysBetween(a: number, b: number): number {
  return Math.round((ymdToUtcDate(b).getTime() - ymdToUtcDate(a).getTime()) / 86_400_000);
}

export function formatLong(ymd: number): string {
  return ymdToUtcDate(ymd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function nowNewYork(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date());
}
