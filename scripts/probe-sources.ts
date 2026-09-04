/**
 * Verify the free data sources end to end before trusting them:
 *   npx tsx scripts/probe-sources.ts [--provider yahoo|stooq|tiingo] [--symbols SPY,SSO,UPRO,...]
 * Prints the universe size from the scanner, then the last five bars of each symbol and whether
 * the newest bar date matches the newest SPY bar.
 */
import { fetchUniverse, fetchSpxMembers } from "../lib/data/tradingview";
import { stooq, tiingo, yahoo, type BarProvider } from "../lib/data/providers";
import { CONFIG } from "../lib/config";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const providers: Record<string, BarProvider> = { yahoo, stooq, tiingo };
const provider = providers[arg("--provider", process.env.DATA_PROVIDER ?? "yahoo")];
const symbols = arg("--symbols", "SPY,SSO,UPRO,MATX,INSW,SB,DAC,BWET,SNDK,MU,MRNA,BRK.B,VLUE,XBI,IWD,AAPL,NVDA,TGT,STX,DELL").split(",");

async function main() {
  console.log(`provider: ${provider.name}`);
  console.log("\n== universe (TradingView scanner) ==");
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

  console.log(`\n== bars (${provider.name}) ==`);
  let spyLast = 0;
  let okCount = 0;
  for (const sym of symbols) {
    try {
      const t0 = Date.now();
      const b = await provider.fetchBars(sym, "full");
      const n = b.t.length;
      const last = b.t[n - 1];
      if (sym === "SPY") spyLast = last;
      const fresh = spyLast ? (last === spyLast ? "fresh" : `STALE vs SPY ${spyLast}`) : "";
      if (last === spyLast) okCount++;
      console.log(`${sym.padEnd(6)} ${String(n).padStart(4)} bars  ${b.t[0]} → ${last}  close ${b.c[n - 1].toFixed(2)}  ${fresh}  (${Date.now() - t0}ms)`);
      console.log("       last 5 closes:", b.c.slice(-5).map((x) => x.toFixed(2)).join(", "));
    } catch (e) {
      console.log(`${sym.padEnd(6)} FAILED: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`\n${okCount}/${symbols.length} symbols end on the same bar as SPY (${spyLast}). Check the closes against a chart before backfilling.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
