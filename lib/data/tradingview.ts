import type { UniverseRow } from "@/lib/types";
import { etfIssuer } from "@/lib/metrics/wrappers";
import { BROWSER_HEADERS, fetchJson } from "./http";

const SCAN_URL = "https://scanner.tradingview.com/america/scan";
const COLUMNS = ["name", "description", "type", "subtype", "exchange", "industry", "sector", "close", "volume", "average_volume_10d_calc", "market_cap_basic"] as const;

interface ScanResponse {
  totalCount: number;
  data: Array<{ s: string; d: unknown[] }>;
}

export interface ScanOptions {
  /** rough pre-filter on 10-day average dollar volume, before the exact 20-bar filter on fetched bars */
  minDollarVolume: number;
}

const HEADERS = {
  ...BROWSER_HEADERS,
  "Content-Type": "application/json",
  Origin: "https://www.tradingview.com",
  Referer: "https://www.tradingview.com/",
};

async function scan(body: Record<string, unknown>): Promise<ScanResponse> {
  return fetchJson<ScanResponse>(SCAN_URL, { method: "POST", headers: HEADERS, body: JSON.stringify(body), timeoutMs: 40_000, retries: 3 });
}

const BAD_NAME = /\b(warrant|warrants|right|rights|units?|preferred|pfd|depositary|notes? due|% notes|debentures|trust preferred|when[- ]issued)\b/i;
const BAD_SYM = /[\/\-]|\.(W|R|U|P|WS|RT|UN)$|\bW$/;

/** Full US stock + ETF universe with industry classification, from the public TradingView scanner. */
export async function fetchUniverse(opts: ScanOptions): Promise<UniverseRow[]> {
  const res = await scan({
    filter: [
      { left: "type", operation: "in_range", right: ["stock", "fund"] },
      { left: "exchange", operation: "in_range", right: ["NYSE", "NASDAQ", "AMEX"] },
      { left: "is_primary", operation: "equal", right: true },
    ],
    options: { lang: "en" },
    markets: ["america"],
    symbols: { query: { types: [] }, tickers: [] },
    columns: COLUMNS,
    sort: { sortBy: "name", sortOrder: "asc" },
    range: [0, 20000],
  });
  const rows: UniverseRow[] = [];
  for (const item of res.data) {
    const d = Object.fromEntries(COLUMNS.map((c, i) => [c, item.d[i]])) as Record<(typeof COLUMNS)[number], unknown>;
    const sym = String(d.name ?? "");
    const name = String(d.description ?? "").trim();
    const type = String(d.type ?? "");
    const subtype = String(d.subtype ?? "").toLowerCase();
    if (!sym || !name) continue;
    if (BAD_SYM.test(sym) || BAD_NAME.test(name)) continue;
    let kind: UniverseRow["kind"];
    if (type === "stock") {
      if (subtype && !/common|foreign-issuer|reit|^$/.test(subtype)) continue;
      kind = "stock";
    } else if (type === "fund") {
      if (!/etf|etn/.test(subtype)) continue;
      kind = "etf";
    } else continue;
    const close = typeof d.close === "number" ? d.close : null;
    const avgVol = typeof d.average_volume_10d_calc === "number" ? d.average_volume_10d_calc : null;
    if (close !== null && avgVol !== null && close * avgVol < opts.minDollarVolume * 0.5) continue;
    rows.push({
      sym,
      name,
      kind,
      industry: kind === "stock" ? String(d.industry ?? "") : etfIssuer(name),
      sector: String(d.sector ?? ""),
      exchange: String(d.exchange ?? ""),
      scanClose: close,
      marketCap: typeof d.market_cap_basic === "number" ? d.market_cap_basic : null,
      spx: false,
    });
  }
  return rows;
}

/** S&P 500 constituents by ticker, via the scanner's index symbol set. Returns null if the call fails. */
export async function fetchSpxMembers(): Promise<Set<string> | null> {
  try {
    const res = await scan({
      columns: ["name"],
      symbols: { symbolset: ["SYML:SP;SPX"] },
      options: { lang: "en" },
      range: [0, 1000],
    });
    const set = new Set(res.data.map((x) => String(x.d[0])));
    return set.size >= 400 ? set : null;
  } catch {
    return null;
  }
}
