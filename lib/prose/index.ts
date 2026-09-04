import type { Snapshot } from "@/lib/snapshot";
import type { LookbackRow, MetricCorrRow } from "@/lib/metrics/study";

export const n0 = (x: number) => Math.round(x).toLocaleString("en-US");
export const f = (x: number | null | undefined, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : (x < 0 ? "−" : "") + Math.abs(x).toFixed(d));
export const pct = (x: number | null | undefined, d = 0) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : (x < 0 ? "−" : "+") + (Math.abs(x) * 100).toFixed(d) + "%");
export const pctPlain = (x: number, d = 0) => (Math.abs(x) * 100).toFixed(d) + "%";
export const times = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "—" : f(x, d) + "×");

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
export function words(n: number): string {
  if (n >= 0 && n <= 20) return WORDS[n];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? "-" + WORDS[n % 10] : "");
  return n0(n);
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function shareWords(x: number): string {
  if (x >= 0.62) return "Most of the market";
  if (x >= 0.45) return "Half the market";
  if (x >= 0.36) return "Two in five names";
  if (x >= 0.29) return "A third of the market";
  if (x >= 0.22) return "A quarter of the market";
  if (x >= 0.16) return "One in five names";
  if (x >= 0.12) return "One in seven names";
  return "A small minority of names";
}

function fractionWords(x: number): string {
  if (x >= 0.9) return "nearly all of those";
  if (x >= 0.72) return "three quarters of those";
  if (x >= 0.6) return "two thirds of those";
  if (x >= 0.42) return "half of those";
  if (x >= 0.28) return "a third of those";
  if (x >= 0.18) return "a quarter of those";
  if (x >= 0.1) return "one in seven of those";
  return "a handful of those";
}

/** The headline, generated from the shares rather than written. */
export function headline(s: Snapshot): string {
  const beatShare = s.totals.beatPct;
  const redShare = s.totals.beat ? s.totals.red / s.totals.beat : 0;
  return `${shareWords(beatShare)} beat the S&P — and ${fractionWords(redShare)} would have done better in SSO`;
}

export function deck(s: Snapshot): string {
  const t = s.totals;
  return `${n0(t.beat)} names outran SPY over twelve months. Only ${n0(t.green)} of them delivered that return with less added downside than the leverage it would have taken to match it. The other ${n0(t.red)} were paying for their outperformance in risk they did not need to take${t.amber ? `, and ${n0(t.amber)} sat in between` : ""}.`;
}

export function benchNote(s: Snapshot): string {
  const sso = s.bench.find((b) => b.sym === "SSO");
  const upro = s.bench.find((b) => b.sym === "UPRO");
  const syn = s.synthetic;
  const worst = syn.length ? Math.max(...syn.map((c) => c.err)) : NaN;
  if (!sso || !upro) return "";
  const ssoGap = sso.m === null ? "" : `${pctPlain(Math.abs(sso.m / 2 - 1), 1)}`;
  return `SSO ran at ${times(sso.m, 3)} SPY's downside volatility — within ${ssoGap} of its stated leverage — while returning ${times(sso.k, 3)}. UPRO ran at ${times(upro.m, 3)} risk for ${times(upro.k, 3)} return. That gap is daily rebalancing, path dependency and fees, and it is the entire reason leverage scores ${sso.rrr !== null && sso.rrr < 1 ? "below" : "near"} 1.00 on this measure. A synthetic k× SPY built from SPY's own daily returns predicted the real ETFs' downside deviation to within ${Number.isFinite(worst) ? pctPlain(worst, 1) : "—"}, so the model and the traded product agree; what the traded product loses is on the return side.`;
}

export function lookbackVerdicts(rows: LookbackRow[]): string[] {
  const best = (k: "raw" | "volAdj" | "downside") => rows.reduce((a, b) => (b[k] > a[k] ? b : a));
  const bestRaw = best("raw");
  const bestDown = best("downside");
  const worstRow = rows.reduce((a, b) => (b.raw + b.volAdj + b.downside < a.raw + a.volAdj + a.downside ? b : a));
  const twelve = rows.find((r) => r.lookback === "12 months");
  const skip = rows.find((r) => r.lookback === "12m skip 1m");
  return rows.map((r) => {
    if (r === bestRaw && r === bestDown) return "Best on every variant against next-month excess return.";
    if (r === bestRaw) return `Best raw-return signal of the five${r.bars <= 21 ? " — short-horizon, and prone to reversal" : ""}.`;
    if (r === bestDown) return "Most consistent once divided by downside deviation. Your metric wins the row.";
    if (r === worstRow) return "The weakest of the five on this sample.";
    if (r === skip && twelve) return twelve.downside > r.downside && twelve.raw > r.raw ? "Worse than plain 12m on every variant. The skip-month cost performance." : "The skip-month helped here, against the usual finding.";
    if (r.volAdj > r.raw && r.downside > r.raw) return "Volatility adjustment helps here, but the base signal is thin.";
    return "Middle of the pack on every variant.";
  });
}

export function metricVerdict(row: MetricCorrRow, all: MetricCorrRow[]): string {
  const bestVsRRR = all.reduce((a, b) => (b.vsRRR > a.vsRRR ? b : a));
  const bestVs3 = all.reduce((a, b) => (b.vs3 > a.vs3 ? b : a));
  const decays = row.vs3 > row.vs12 * 1.5;
  switch (row.key) {
    case "mom":
      return decays ? "Recent outperformance. Decays hard past 6 months." : "Holds its relationship across horizons this run.";
    case "momDays":
      return row === bestVsRRR ? "The strongest relationship to the ratio on the page, and the best predictor of ratio quality." : "A long-horizon measure; not the best link to the ratio this run.";
    case "gSep":
      return row === bestVs3 ? "Sharpest short-term measure of all — not a long-term one." : decays ? "A short-horizon instrument that fades by twelve months." : "Holds up across horizons this run.";
    case "gAligned":
      return "Same shape as separation, coarser. The binary throws away information.";
  }
}

export function staleNote(ageDays: number): string {
  return `The newest bar is ${ageDays} calendar days old. The last refresh did not publish, so the page is serving the previous good snapshot.`;
}
