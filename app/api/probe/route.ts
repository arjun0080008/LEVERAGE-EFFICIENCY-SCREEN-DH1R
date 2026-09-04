import { NextResponse, type NextRequest } from "next/server";
import { authorised } from "@/lib/auth";
import { BROWSER_HEADERS } from "@/lib/data/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Result { ok: boolean; ms: number; status?: number; note?: string; sample?: unknown }

async function timed(fn: () => Promise<Partial<Result>>): Promise<Result> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { ok: r.ok ?? true, ms: Date.now() - t0, ...r };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, note: e instanceof Error ? e.message : String(e) };
  }
}

const get = (url: string, headers: Record<string, string> = BROWSER_HEADERS, init: RequestInit = {}) =>
  fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(15_000), ...init });

/** Diagnostic: which data sources are reachable from this Vercel region? GET /api/probe?key=CRON_SECRET */
export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const out: Record<string, Result> = {};

  out.yahoo_query1 = await timed(async () => {
    const r = await get("https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=5d&interval=1d");
    const t = await r.text();
    return { ok: r.ok, status: r.status, sample: t.slice(0, 160) };
  });

  out.yahoo_query2_cookie_crumb = await timed(async () => {
    const c = await get("https://fc.yahoo.com", BROWSER_HEADERS, { redirect: "manual" });
    const cookie = (c.headers.get("set-cookie") ?? "").split(";")[0];
    const cr = await get("https://query2.finance.yahoo.com/v1/test/getcrumb", { ...BROWSER_HEADERS, cookie });
    const crumb = await cr.text();
    const r = await get(`https://query2.finance.yahoo.com/v8/finance/chart/SPY?range=5d&interval=1d&crumb=${encodeURIComponent(crumb)}`, { ...BROWSER_HEADERS, cookie });
    const t = await r.text();
    return { ok: r.ok, status: r.status, note: `cookie=${cookie ? "yes" : "no"} crumbStatus=${cr.status} crumb=${crumb.slice(0, 12)}`, sample: t.slice(0, 160) };
  });

  out.stooq = await timed(async () => {
    const r = await get("https://stooq.com/q/d/l/?s=spy.us&i=d&d1=20260801");
    const t = await r.text();
    return { ok: r.ok && /^Date,Open/i.test(t), status: r.status, sample: t.trim().split("\n").slice(-2) };
  });

  out.tradingview_scanner = await timed(async () => {
    const r = await get("https://scanner.tradingview.com/america/scan", { ...BROWSER_HEADERS, "Content-Type": "application/json", Origin: "https://www.tradingview.com", Referer: "https://www.tradingview.com/" }, {
      method: "POST",
      body: JSON.stringify({ filter: [{ left: "type", operation: "in_range", right: ["stock", "fund"] }, { left: "exchange", operation: "in_range", right: ["NYSE", "NASDAQ", "AMEX"] }], columns: ["name", "description", "industry", "close", "type", "subtype"], range: [0, 3], symbols: { query: { types: [] }, tickers: [] }, options: { lang: "en" } }),
    });
    const t = await r.text();
    return { ok: r.ok, status: r.status, sample: t.slice(0, 300) };
  });

  out.tradingview_spx = await timed(async () => {
    const r = await get("https://scanner.tradingview.com/america/scan", { ...BROWSER_HEADERS, "Content-Type": "application/json", Origin: "https://www.tradingview.com", Referer: "https://www.tradingview.com/" }, {
      method: "POST",
      body: JSON.stringify({ columns: ["name"], symbols: { symbolset: ["SYML:SP;SPX"] }, range: [0, 3], options: { lang: "en" } }),
    });
    const t = await r.text();
    return { ok: r.ok, status: r.status, sample: t.slice(0, 200) };
  });

  out.nasdaqtrader = await timed(async () => {
    const r = await get("https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt");
    const t = await r.text();
    return { ok: r.ok, status: r.status, sample: t.split("\n").slice(0, 2) };
  });

  const pk = process.env.POLYGON_API_KEY;
  out.polygon_grouped_daily = await timed(async () => {
    if (!pk) return { ok: false, note: "POLYGON_API_KEY not set" };
    const d = new Date(Date.now() - 86_400_000);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
    const iso = d.toISOString().slice(0, 10);
    const r = await get(`https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${iso}?adjusted=true&apiKey=${pk}`, {});
    const t = await r.text();
    return { ok: r.ok, status: r.status, sample: t.slice(0, 200) };
  });

  const tk = process.env.TIINGO_TOKEN;
  out.tiingo = await timed(async () => {
    if (!tk) return { ok: false, note: "TIINGO_TOKEN not set" };
    const r = await get(`https://api.tiingo.com/tiingo/daily/SPY/prices?startDate=2026-08-25&token=${tk}`, {});
    const t = await r.text();
    return { ok: r.ok, status: r.status, sample: t.slice(0, 200) };
  });

  return NextResponse.json({ region: process.env.VERCEL_REGION ?? null, results: out });
}
