/**
 * Verify the data sources end to end before trusting them:
 *   POLYGON_API_KEY=... npx tsx scripts/probe-sources.ts
 * Prints the scanner universe size and industry sample, then the newest Polygon grouped-daily date
 * with SPY / SSO / UPRO / MATX closes so you can check them against a chart.
 */
import { fetchUniverse, fetchSpxMembers } from "../lib/data/tradingview";
import { fetchGroupedDaily, weekdaysBetween } from "../lib/data/polygon";
import { CONFIG } from "../lib/config";

async function main() {
  console.log("== universe (TradingView scanner) ==");
  try {
    const u = await fetchUniverse({ minDollarVolume: CONFIG.MIN_DOLLAR_VOLUME_USD });
    const stocks = u.filter((r) => r.kind === "stock").length;
    console.log(`${u.length} candidates: ${stocks} stocks, ${u.length - stocks} ETFs`);
    const ind = new Set(u.filter((r) => r.kind === "stock").map((r) => r.industry));
    console.log(`${ind.size} distinct industries; sample:`, [...ind].slice(0, 8).join(" | "));
    for (const s of ["MATX", "SNDK", "VLO"]) {
      const r = u.find((x) => x.sym === s);
      console.log(`  ${s}: ${r ? `${r.name} / ${r.industry} / close ${r.scanClose}` : "NOT FOUND"}`);
    }
    const spx = await fetchSpxMembers();
    console.log(`S&P 500 membership: ${spx ? spx.size + " names" : "unavailable"}`);
  } catch (e) {
    console.log("scanner FAILED:", e instanceof Error ? e.message : e);
  }

  console.log("\n== bars (Polygon grouped daily) ==");
  const today = new Date().toISOString().slice(0, 10);
  const days = weekdaysBetween(new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10), today).reverse();
  for (const iso of days.slice(0, 3)) {
    try {
      const t0 = Date.now();
      const d = await fetchGroupedDaily(iso);
      if (!d) {
        console.log(`${iso}: no rows (closed or not yet published)`);
        continue;
      }
      console.log(`${iso}: ${Object.keys(d.rows).length} tickers (${Date.now() - t0}ms)`);
      for (const s of ["SPY", "SSO", "UPRO", "MATX", "BRK.B", "BWET"]) console.log(`   ${s.padEnd(6)}`, d.rows[s] ? `close ${d.rows[s][3]}  vol ${d.rows[s][4]}` : "missing");
    } catch (e) {
      console.log(`${iso}: FAILED ${e instanceof Error ? e.message : e}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
