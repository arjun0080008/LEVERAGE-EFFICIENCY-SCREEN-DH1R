import type { UniverseRow } from "@/lib/types";
import { etfIssuer } from "@/lib/metrics/wrappers";
import { fetchText } from "./http";

/**
 * Fallback universe from the Nasdaq Trader symbol directory (no industry classification).
 * nasdaqlisted.txt: Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
 * otherlisted.txt:  ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
 */
export async function fetchNasdaqUniverse(): Promise<UniverseRow[]> {
  const base = "https://www.nasdaqtrader.com/dynamic/symdir/";
  const [nq, other] = await Promise.all([fetchText(base + "nasdaqlisted.txt", { timeoutMs: 30_000 }), fetchText(base + "otherlisted.txt", { timeoutMs: 30_000 })]);
  const rows: UniverseRow[] = [];
  const bad = /\b(warrant|right|unit|preferred|depositary|notes? due|debenture)s?\b/i;
  const push = (sym: string, name: string, etf: string, test: string, exchange: string) => {
    if (test === "Y" || !sym || /[$.=^]/.test(sym) || bad.test(name)) return;
    const kind = etf === "Y" ? "etf" : "stock";
    rows.push({ sym, name, kind, industry: kind === "etf" ? etfIssuer(name) : "", sector: "", exchange, scanClose: null, marketCap: null, spx: false });
  };
  for (const line of nq.split("\n").slice(1)) {
    const f = line.split("|");
    if (f.length < 7 || f[0].startsWith("File Creation")) continue;
    push(f[0].trim(), f[1].trim(), f[6].trim(), f[3].trim(), "NASDAQ");
  }
  for (const line of other.split("\n").slice(1)) {
    const f = line.split("|");
    if (f.length < 8 || f[0].startsWith("File Creation")) continue;
    const ex = { A: "AMEX", N: "NYSE", P: "AMEX", Z: "BATS", V: "IEX" }[f[2].trim()] ?? f[2].trim();
    push(f[0].trim(), f[1].trim(), f[4].trim(), f[6].trim(), ex);
  }
  return rows;
}
