import type { Bars } from "@/lib/types";
import { ymdFromIso } from "./dates";
import { BROWSER_HEADERS, fetchJson, fetchText } from "./http";

export type Range = "full" | "recent";

export interface BarProvider {
  name: string;
  /** Daily OHLCV, oldest first, split-adjusted closes (not dividend-adjusted), matching a TradingView chart. */
  fetchBars(sym: string, range: Range): Promise<Bars>;
}

/** Scanner tickers use a dot for share classes (BRK.B); Yahoo and Stooq use a dash. */
export const toDash = (sym: string) => sym.replace(/\./g, "-");

function assemble(rows: Array<[number, number, number, number, number, number]>): Bars {
  rows.sort((a, b) => a[0] - b[0]);
  const b: Bars = { t: [], o: [], h: [], l: [], c: [], v: [] };
  let last = -1;
  for (const [t, o, h, l, c, v] of rows) {
    if (t === last) continue;
    if (!(c > 0) || !(h > 0) || !(l > 0) || !(o > 0)) continue;
    last = t;
    b.t.push(t);
    b.o.push(o);
    b.h.push(h);
    b.l.push(l);
    b.c.push(c);
    b.v.push(Number.isFinite(v) ? v : 0);
  }
  return b;
}

interface YahooChart {
  chart: {
    result: Array<{
      meta: { exchangeTimezoneName?: string };
      timestamp?: number[];
      indicators: { quote: Array<{ open: Array<number | null>; high: Array<number | null>; low: Array<number | null>; close: Array<number | null>; volume: Array<number | null> }> };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

export const yahoo: BarProvider = {
  name: "yahoo",
  async fetchBars(sym, range) {
    const r = range === "full" ? "2y" : "1mo";
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(toDash(sym))}?range=${r}&interval=1d&includePrePost=false&events=splits`;
    const j = await fetchJson<YahooChart>(url, { headers: BROWSER_HEADERS, timeoutMs: 15_000, retries: 3 });
    if (j.chart.error) throw new Error(`yahoo: ${j.chart.error.code} ${j.chart.error.description}`);
    const res = j.chart.result?.[0];
    if (!res || !res.timestamp) throw new Error("yahoo: empty result");
    const q = res.indicators.quote[0];
    const tz = res.meta.exchangeTimezoneName ?? "America/New_York";
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const rows: Array<[number, number, number, number, number, number]> = [];
    for (let i = 0; i < res.timestamp.length; i++) {
      const c = q.close[i];
      if (c === null || c === undefined) continue;
      const parts = fmt.formatToParts(new Date(res.timestamp[i] * 1000));
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
      const ymd = get("year") * 10000 + get("month") * 100 + get("day");
      rows.push([ymd, q.open[i] ?? c, q.high[i] ?? c, q.low[i] ?? c, c, q.volume[i] ?? 0]);
    }
    return assemble(rows);
  },
};

export const stooq: BarProvider = {
  name: "stooq",
  async fetchBars(sym, range) {
    const s = `${toDash(sym).toLowerCase()}.us`;
    const url = range === "full" ? `https://stooq.com/q/d/l/?s=${s}&i=d` : `https://stooq.com/q/d/l/?s=${s}&i=d&d1=${recentStart()}`;
    const csv = await fetchText(url, { headers: BROWSER_HEADERS, timeoutMs: 20_000, retries: 2 });
    if (/exceeded the daily hits limit/i.test(csv)) throw new Error("stooq: daily hit limit exceeded");
    const lines = csv.trim().split("\n");
    if (lines.length < 2 || !/^Date,Open/i.test(lines[0])) throw new Error("stooq: no data");
    const rows: Array<[number, number, number, number, number, number]> = [];
    for (const line of lines.slice(1)) {
      const f = line.split(",");
      if (f.length < 5) continue;
      rows.push([ymdFromIso(f[0]), Number(f[1]), Number(f[2]), Number(f[3]), Number(f[4]), Number(f[5] ?? 0)]);
    }
    const b = assemble(rows);
    // Stooq's full history can be decades; keep the last ~3 years worth
    if (b.t.length > 760) for (const k of ["t", "o", "h", "l", "c", "v"] as const) b[k] = b[k].slice(-760);
    return b;
  },
};

function recentStart(): string {
  const d = new Date(Date.now() - 40 * 86_400_000);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/** Paid fallback. Set DATA_PROVIDER=tiingo and TIINGO_TOKEN. */
export const tiingo: BarProvider = {
  name: "tiingo",
  async fetchBars(sym, range) {
    const token = process.env.TIINGO_TOKEN;
    if (!token) throw new Error("tiingo: TIINGO_TOKEN not set");
    const days = range === "full" ? 760 : 40;
    const start = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(toDash(sym))}/prices?startDate=${start}&token=${token}`;
    const j = await fetchJson<Array<{ date: string; open: number; high: number; low: number; close: number; volume: number; splitFactor?: number }>>(url, { timeoutMs: 20_000 });
    // Tiingo's raw fields are unadjusted; apply cumulative split factors from the end so the series is split-adjusted like a chart.
    let factor = 1;
    const rows: Array<[number, number, number, number, number, number]> = [];
    for (let i = j.length - 1; i >= 0; i--) {
      const x = j[i];
      rows.push([ymdFromIso(x.date), x.open / factor, x.high / factor, x.low / factor, x.close / factor, x.volume * factor]);
      if (x.splitFactor && x.splitFactor !== 1) factor *= x.splitFactor;
    }
    return assemble(rows);
  },
};

export function getProvider(): BarProvider {
  const p = (process.env.DATA_PROVIDER ?? "yahoo").toLowerCase();
  if (p === "stooq") return stooq;
  if (p === "tiingo") return tiingo;
  return yahoo;
}
