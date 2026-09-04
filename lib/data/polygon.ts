import { fetchText, HttpError } from "./http";
import { ymdFromIso } from "./dates";

/**
 * Polygon.io grouped daily bars: every US ticker's OHLCV for one trading date in a single request.
 * Free plan: 5 requests/minute, 2 years of history, split-adjusted with adjusted=true.
 */
export interface DayRows {
  /** YYYYMMDD */
  date: number;
  /** ticker -> [open, high, low, close, volume] */
  rows: Record<string, [number, number, number, number, number]>;
}

interface Grouped {
  status: string;
  queryCount?: number;
  resultsCount?: number;
  results?: Array<{ T: string; o: number; h: number; l: number; c: number; v: number }>;
  error?: string;
  message?: string;
}

export class RateLimited extends Error {
  constructor() {
    super("polygon: rate limited (429)");
  }
}

export function polygonKey(): string {
  const k = process.env.POLYGON_API_KEY;
  if (!k) throw new Error("POLYGON_API_KEY is not set");
  return k;
}

/** Fetch one date. Returns null rows when the market was closed. Throws RateLimited on 429 so the caller can pace itself. */
export async function fetchGroupedDaily(iso: string): Promise<DayRows | null> {
  const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${iso}?adjusted=true&include_otc=false&apiKey=${polygonKey()}`;
  let text: string;
  try {
    text = await fetchText(url, { timeoutMs: 30_000, retries: 0, headers: { Accept: "application/json" } });
  } catch (e) {
    if (e instanceof HttpError && e.status === 429) throw new RateLimited();
    if (e instanceof HttpError && e.status === 403) throw new Error("polygon: 403 — check POLYGON_API_KEY and that the plan includes this date range");
    throw e;
  }
  const j = JSON.parse(text) as Grouped;
  if (j.status === "ERROR") throw new Error(`polygon: ${j.error ?? j.message ?? "error"}`);
  if (!j.results || j.results.length === 0) return null;
  const rows: DayRows["rows"] = {};
  for (const r of j.results) {
    if (!r.T || !(r.c > 0) || !(r.o > 0) || !(r.h > 0) || !(r.l > 0)) continue;
    rows[r.T] = [r.o, r.h, r.l, r.c, r.v ?? 0];
  }
  return { date: ymdFromIso(iso), rows };
}

/** ISO weekdays between two dates inclusive, ascending. */
export function weekdaysBetween(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const d = new Date(fromIso + "T00:00:00Z");
  const end = new Date(toIso + "T00:00:00Z");
  while (d <= end) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
