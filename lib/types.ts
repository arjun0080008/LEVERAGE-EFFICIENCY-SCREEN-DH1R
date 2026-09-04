/** Compact daily bar series. Dates are YYYYMMDD integers (exchange-local trading dates). */
export interface Bars {
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
}

export type AssetKind = "stock" | "etf";

export interface UniverseRow {
  /** Canonical ticker as used by the scanner (class shares use a dot, e.g. BRK.B). */
  sym: string;
  name: string;
  kind: AssetKind;
  /** Industry for stocks; fund issuer for ETFs. */
  industry: string;
  sector: string;
  exchange: string;
  /** Scanner close, used only to cross-check the fetched bars. */
  scanClose: number | null;
  marketCap: number | null;
  spx: boolean;
}

export interface WindowStats {
  /** window length in bars */
  w: number;
  /** asset return over the window, as a fraction */
  r: number;
  /** SPY return over the same span */
  rSpy: number;
  /** return multiple; null when SPY was flat (rSpy <= 0.0001) */
  k: number | null;
  /** annualised downside volatility, fraction */
  dv: number;
  /** risk multiple */
  m: number | null;
  /** k / m */
  rrr: number | null;
  /** max peak-to-trough drawdown over the window, negative fraction */
  mdd: number;
}

export interface Scored {
  sym: string;
  name: string;
  kind: AssetKind;
  industry: string;
  sector: string;
  wrapper: string | null;
  spx: boolean;
  bars: number;
  lastDate: number;
  lastClose: number;
  /** 1-day change, fraction */
  d1: number;
  /** 20-bar mean dollar volume, USD */
  dollarVol: number;
  w1: WindowStats;
  w3: WindowStats;
  w6: WindowStats;
  w12: WindowStats;
  mom: number | null;
  momDays: number | null;
  gAligned: boolean | null;
  gSep: number | null;
  squeeze: boolean | null;
  /** largest single-day absolute move over the 12m window, fraction */
  maxDay: number;
  verify: string[];
  green12: boolean;
  green6: boolean;
  /** green on both 6m and 12m, and not a structural wrapper */
  listGreen: boolean;
  light12: "green" | "amber" | "red" | null;
}
