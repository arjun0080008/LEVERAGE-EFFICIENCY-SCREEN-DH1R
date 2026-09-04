import { CONFIG } from "@/lib/config";
import { isoFromYmd, nowNewYork } from "@/lib/data/dates";
import { industryTable } from "@/lib/metrics/industry";
import { dailyReturns, scoreSymbol, truncate, type SpyRef } from "@/lib/metrics/score";
import { lookbackStudy, metricCorrelations, STUDY_MIN_MEMBERS } from "@/lib/metrics/study";
import type { BenchRow, GreenRow, Snapshot } from "@/lib/snapshot";
import type { Bars, Scored, UniverseRow } from "@/lib/types";
import { runChecks } from "@/lib/verify/checks";

export interface BuildInput {
  universe: UniverseRow[];
  universeSource: string;
  scanned: number;
  bars: Map<string, Bars>;
  fetchFailed: number;
  provider: string;
  prevTotal: number | null;
  /** YYYYMMDD; truncate all series to this date (used to reproduce a historical close) */
  asOf?: number | null;
  todayNY: number;
}

export interface BuildOutput {
  snapshot: Snapshot;
  scored: Scored[];
  pass: boolean;
}

const bySym = (a: { sym: string }, b: { sym: string }) => a.sym.localeCompare(b.sym);

export function build(input: BuildInput): BuildOutput {
  const asOf = input.asOf ?? null;
  const spyBars0 = input.bars.get("SPY");
  if (!spyBars0) throw new Error("SPY bars missing; cannot score");
  const spyBars = truncate(spyBars0, asOf);
  const spy: SpyRef = { bars: spyBars, r: dailyReturns(spyBars.c) };
  const lastBar = spyBars.t[spyBars.t.length - 1];

  // First pass: benchmarks, so the traffic light knows SSO's ratio
  const rowsBySym = new Map(input.universe.map((r) => [r.sym, r]));
  const scoreOne = (sym: string, ssoRRR: number | null): Scored | null => {
    const row = rowsBySym.get(sym);
    const b0 = input.bars.get(sym);
    if (!row || !b0) return null;
    const b = truncate(b0, asOf);
    if (b.t.length < CONFIG.MIN_BARS) return null;
    // only score series that reach the SPY bar date
    if (b.t[b.t.length - 1] !== lastBar) return null;
    return scoreSymbol({ row, bars: b, spy, ssoRRR });
  };
  const sso0 = scoreOne("SSO", null);
  const ssoRRR = sso0?.w12.rrr ?? null;

  let lackedHistory = 0;
  let lowLiquidity = 0;
  let mismatchRejected = 0;
  let verifiedClose = 0;
  let stale = 0;
  const scored: Scored[] = [];
  const benchSet = new Set<string>(CONFIG.BENCHMARKS);
  for (const row of input.universe) {
    const b0 = input.bars.get(row.sym);
    if (!b0) continue;
    const b = truncate(b0, asOf);
    if (b.t.length < CONFIG.MIN_BARS) {
      lackedHistory++;
      continue;
    }
    if (b.t[b.t.length - 1] !== lastBar) {
      stale++;
      continue;
    }
    const s = scoreSymbol({ row, bars: b, spy, ssoRRR });
    if (!s) {
      lackedHistory++;
      continue;
    }
    if (!benchSet.has(row.sym) && s.dollarVol < CONFIG.MIN_DOLLAR_VOLUME_USD) {
      lowLiquidity++;
      continue;
    }
    if (row.scanClose !== null && asOf === null) {
      const diff = Math.abs(s.lastClose / row.scanClose - 1);
      if (diff > CONFIG.CLOSE_MISMATCH_TOL) {
        mismatchRejected++;
        continue;
      }
      verifiedClose++;
    }
    scored.push(s);
  }
  scored.sort(bySym);
  const scoredMap = new Map(scored.map((s) => [s.sym, s]));

  const { checks, synthetic, pass } = runChecks({ scored: scoredMap, spy, universeTotal: scored.length, prevTotal: input.prevTotal, lastBar, todayNY: input.todayNY });

  const bench: BenchRow[] = [];
  for (const [sym, label, L] of [["SPY", "SPY", 1], ["SSO", "SSO — 2× SPY", 2], ["UPRO", "UPRO — 3× SPY", 3]] as const) {
    const s = scoredMap.get(sym);
    if (!s) continue;
    bench.push({ sym, label, leverage: L, r12: s.w12.r, dv: s.w12.dv, k: s.w12.k, m: s.w12.m, rrr: s.w12.rrr, r6: s.w6.r, rrr6: s.w6.rrr });
  }

  const ranked = scored.filter((s) => !benchSet.has(s.sym));
  const beat = ranked.filter((s) => s.w12.k !== null && s.w12.k > 1);
  const green = beat.filter((s) => s.light12 === "green").length;
  const amber = beat.filter((s) => s.light12 === "amber").length;
  const red = beat.filter((s) => s.light12 === "red").length;
  const list = ranked.filter((s) => s.listGreen).sort((a, b) => (b.w12.rrr ?? 0) - (a.w12.rrr ?? 0));

  const industries = industryTable(ranked, CONFIG.INDUSTRY_MIN_N);

  // Spotlight: the industry with the highest share green among those with more than SPOTLIGHT_MIN_N members
  let spotlight: Snapshot["spotlight"] = null;
  const eligible = industries.filter((i) => i.n > CONFIG.SPOTLIGHT_MIN_N);
  if (eligible.length) {
    const top = eligible.slice().sort((a, b) => b.pct - a.pct || b.meanRRR - a.meanRRR)[0];
    const rank = industries.findIndex((i) => i.industry === top.industry) + 1;
    const members = ranked.filter((s) => s.kind === "stock" && s.industry === top.industry && s.w12.rrr !== null).sort((a, b) => (b.w12.rrr ?? 0) - (a.w12.rrr ?? 0));
    const above = industries.slice(0, rank - 1).map((i) => ({
      industry: i.industry,
      meanRRR: i.meanRRR,
      meanK: i.meanK,
      meanM: i.meanM,
      green: i.green,
      n: i.n,
      pct: i.pct,
      leaders: ranked
        .filter((s) => s.kind === "stock" && s.industry === i.industry)
        .sort((a, b) => (b.w12.rrr ?? -1) - (a.w12.rrr ?? -1))
        .slice(0, 4)
        .map((s) => s.sym),
    }));
    const topOverall = list[0] ?? null;
    spotlight = {
      industry: top.industry,
      n: top.n,
      meanK: top.meanK,
      meanM: top.meanM,
      meanRRR: top.meanRRR,
      green: top.green,
      pct: top.pct,
      rank,
      of: industries.length,
      minN: CONFIG.SPOTLIGHT_MIN_N,
      leaders: members.slice(0, 5).map((s) => ({ t: s.sym, rrr: s.w12.rrr as number })),
      above,
      topOverall: topOverall ? { t: topOverall.sym, d: topOverall.name, r12: topOverall.w12.r, maxDay: topOverall.maxDay, etf: topOverall.kind === "etf", ind: topOverall.industry } : null,
    };
  }

  const greenRows: GreenRow[] = list.slice(0, CONFIG.GREEN_LIST_ROWS).map((s) => ({
    t: s.sym,
    etf: s.kind === "etf",
    d: s.name,
    ind: s.industry,
    r12: s.w12.r,
    k: s.w12.k as number,
    m: s.w12.m as number,
    rrr: s.w12.rrr as number,
    dv: s.w12.dv,
    mdd: s.w12.mdd,
    r6: s.w6.r,
    rrr6: s.w6.rrr,
    r3: s.w3.r,
    mom: s.mom,
    momDays: s.momDays,
    gA: s.gAligned,
    gSep: s.gSep,
    sq: s.squeeze,
    adv: s.dollarVol / 1e6,
    vf: s.verify,
    maxDay: s.maxDay,
  }));

  // Wrappers
  const etfs = ranked.filter((s) => s.kind === "etf");
  const wr = etfs.filter((s) => s.wrapper !== null);
  const theme = etfs.filter((s) => s.wrapper === null);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const cats = new Map<string, Scored[]>();
  for (const s of wr) cats.set(s.wrapper as string, [...(cats.get(s.wrapper as string) ?? []), s]);
  const wrappers: Snapshot["wrappers"] = {
    count: wr.length,
    byCategory: [...cats.entries()]
      .map(([category, g]) => ({ category, n: g.length, green12: g.filter((s) => s.green12).length, meanRRR: avg(g.map((s) => s.w12.rrr).filter((x): x is number => x !== null)) }))
      .sort((a, b) => b.n - a.n),
    themeCount: theme.length,
    avgD1Wrapper: avg(wr.map((s) => s.d1)),
    avgD1Theme: avg(theme.map((s) => s.d1)),
    upShare: ranked.length ? ranked.filter((s) => s.d1 > 0).length / ranked.length : NaN,
    green12: wr.filter((s) => s.green12).length,
    meanRRR: avg(wr.map((s) => s.w12.rrr).filter((x): x is number => x !== null)),
    themeMeanRRR: avg(theme.map((s) => s.w12.rrr).filter((x): x is number => x !== null)),
  };

  const metricCorr = metricCorrelations(ranked);

  // Forward lookback study on S&P 500 members (or the 500 largest stocks when membership is unavailable)
  let members = ranked.filter((s) => s.spx && s.kind === "stock");
  let memberLabel = "S&P 500 members";
  if (members.length < STUDY_MIN_MEMBERS) {
    const caps = new Map(input.universe.map((r) => [r.sym, r.marketCap ?? 0]));
    members = ranked.filter((s) => s.kind === "stock").sort((a, b) => (caps.get(b.sym) ?? 0) - (caps.get(a.sym) ?? 0)).slice(0, 500);
    memberLabel = "largest 500 US stocks by market cap";
  }
  const lookback = members.length >= STUDY_MIN_MEMBERS
    ? lookbackStudy(members.map((s) => ({ sym: s.sym, bars: truncate(input.bars.get(s.sym) as Bars, asOf) })), spy, memberLabel)
    : null;

  // 12m cumulative path for the benchmark chart, sampled every 5th bar plus the last
  const path: Snapshot["path"] = { t: [], spy: [], sso: [], upro: [] };
  const W = CONFIG.WINDOWS.w12;
  const end = spyBars.t.length - 1;
  const start = end - W;
  const series = (sym: string) => {
    const b = input.bars.get(sym);
    return b ? truncate(b, asOf) : null;
  };
  const ssoB = series("SSO");
  const uproB = series("UPRO");
  const idxAt = (b: Bars | null, date: number) => {
    if (!b) return -1;
    let lo = 0, hi = b.t.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (b.t[mid] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  };
  const base = (b: Bars | null) => { const i = idxAt(b, spyBars.t[start]); return b && i >= 0 ? b.c[i] : NaN; };
  const ssoBase = base(ssoB), uproBase = base(uproB);
  for (let i = start; i <= end; i += (i + 5 > end && i !== end ? end - i : 5)) {
    path.t.push(spyBars.t[i]);
    path.spy.push(spyBars.c[i] / spyBars.c[start] - 1);
    const si = idxAt(ssoB, spyBars.t[i]), ui = idxAt(uproB, spyBars.t[i]);
    path.sso.push(ssoB && si >= 0 ? ssoB.c[si] / ssoBase - 1 : NaN);
    path.upro.push(uproB && ui >= 0 ? uproB.c[ui] / uproBase - 1 : NaN);
    if (i === end) break;
  }

  const flagged = ranked.filter((s) => s.verify.length).sort((a, b) => b.maxDay - a.maxDay).slice(0, 4).map((s) => ({ t: s.sym, reason: s.verify.join("; ") }));

  const snapshot: Snapshot = {
    version: 1,
    asOf: lastBar,
    asOfIso: isoFromYmd(lastBar),
    generatedAt: new Date().toISOString(),
    generatedAtNY: nowNewYork(),
    provider: input.provider,
    universeSource: input.universeSource,
    universe: {
      scanned: input.scanned,
      walked: input.universe.length,
      total: ranked.length,
      stocks: ranked.filter((s) => s.kind === "stock").length,
      etfs: ranked.filter((s) => s.kind === "etf").length,
      lackedHistory: lackedHistory + stale,
      lowLiquidity,
      fetchFailed: input.fetchFailed,
      mismatchRejected,
      verifiedClose,
      minDollarVolume: CONFIG.MIN_DOLLAR_VOLUME_USD,
      minBars: CONFIG.MIN_BARS,
      barsCalendar: spyBars.t.length,
      prevTotal: input.prevTotal,
    },
    bench,
    synthetic,
    ssoRRR,
    uproRRR: scoredMap.get("UPRO")?.w12.rrr ?? null,
    totals: {
      beat: beat.length,
      beatPct: ranked.length ? beat.length / ranked.length : 0,
      green,
      amber,
      red,
      listGreen: list.length,
      listGreenStocks: list.filter((s) => s.kind === "stock").length,
      listGreenEtfs: list.filter((s) => s.kind === "etf").length,
    },
    industries,
    industryMinN: CONFIG.INDUSTRY_MIN_N,
    spotlight,
    green: greenRows,
    greenTotal: list.length,
    wrappers,
    metricCorr,
    metricN: metricCorr[0]?.n ?? 0,
    lookback,
    path,
    checks,
    flaggedExamples: flagged,
  };
  return { snapshot, scored, pass };
}
