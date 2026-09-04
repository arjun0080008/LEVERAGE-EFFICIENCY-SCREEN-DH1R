import assert from "node:assert/strict";
import { test } from "node:test";
import { atr, ema, ranks, rma, sma, spearman, stdevPop } from "../lib/metrics/indicators";
import { dailyReturns, downsideVol, maxDrawdown, momentum, scoreSymbol, syntheticDownsideVol, truncate, windowStats, type SpyRef } from "../lib/metrics/score";
import { classifyWrapper, etfIssuer } from "../lib/metrics/wrappers";
import { industryTable } from "../lib/metrics/industry";
import { build } from "../lib/job/build";
import { runChecks } from "../lib/verify/checks";
import type { Bars, UniverseRow } from "../lib/types";

/** Deterministic pseudo-random generator so the synthetic market is reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function gauss(r: () => number) {
  const u = 1 - r(), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Build a bar series from daily returns starting at 2024-01-02 on a synthetic weekday calendar. */
function barsFromReturns(rets: number[], start = 100): Bars {
  const b: Bars = { t: [], o: [], h: [], l: [], c: [], v: [] };
  let c = start;
  let d = new Date(Date.UTC(2024, 0, 2));
  for (let i = 0; i < rets.length; i++) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() + 86_400_000);
    const prev = c;
    c = i === 0 ? start : prev * (1 + rets[i]);
    b.t.push(d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate());
    b.o.push(prev);
    b.h.push(Math.max(prev, c) * 1.004);
    b.l.push(Math.min(prev, c) * 0.996);
    b.c.push(c);
    b.v.push(1_000_000);
    d = new Date(d.getTime() + 86_400_000);
  }
  return b;
}

const N = 520;
const r = rng(7);
const spyRets = Array.from({ length: N }, (_, i) => (i === 0 ? 0 : 0.0006 + 0.009 * gauss(r)));
const spyBars = barsFromReturns(spyRets);
const spy: SpyRef = { bars: spyBars, r: dailyReturns(spyBars.c) };
const lev = (L: number) => barsFromReturns(spyRets.map((x) => x * L));

test("EMA is SMA-seeded and matches a hand-computed recursion", () => {
  const src = [1, 2, 3, 4, 5, 6];
  const e = ema(src, 3);
  assert.ok(Number.isNaN(e[0]) && Number.isNaN(e[1]));
  assert.equal(e[2], 2);
  const a = 0.5;
  assert.ok(Math.abs(e[3] - (a * 4 + (1 - a) * 2)) < 1e-12);
  assert.ok(Math.abs(e[4] - (a * 5 + (1 - a) * e[3])) < 1e-12);
});

test("RMA uses alpha = 1/len and ATR is Wilder RMA of true range", () => {
  const src = [10, 12, 11, 13, 12];
  const w = rma(src, 3);
  assert.equal(w[2], 11);
  assert.ok(Math.abs(w[3] - (13 / 3 + (2 / 3) * 11)) < 1e-12);
  const h = [11, 13, 12, 14, 13], l = [9, 11, 10, 12, 11], c = [10, 12, 11, 13, 12];
  const a = atr(h, l, c, 3);
  // TR: 2, max(2,|13-10|,|11-10|)=3, max(2,|12-12|,|10-12|)=2 -> SMA seed 7/3
  assert.ok(Math.abs(a[2] - 7 / 3) < 1e-12);
});

test("population stdev and SMA", () => {
  assert.ok(Math.abs(stdevPop([2, 4, 4, 4, 5, 5, 7, 9], 8)[7] - 2) < 1e-12);
  assert.equal(sma([1, 2, 3, 4], 2)[3], 3.5);
});

test("ranks and Spearman", () => {
  assert.deepEqual(ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
  assert.ok(Math.abs(spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]) - 1) < 1e-12);
  assert.ok(Math.abs(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]) + 1) < 1e-12);
});

test("downside volatility counts only negative days", () => {
  const rets = [NaN, 0.02, -0.01, 0.03, -0.02];
  const dv = downsideVol(rets, 4, 4);
  assert.ok(Math.abs(dv - Math.sqrt((0.0001 + 0.0004) / 2) * Math.sqrt(252)) < 1e-12);
  assert.equal(downsideVol([NaN, 0.01, 0.02], 2, 2), 0);
});

test("max drawdown", () => {
  assert.ok(Math.abs(maxDrawdown([100, 120, 90, 110, 80], 0, 4) - (80 / 120 - 1)) < 1e-12);
});

test("SPY against itself: k, m and k/m are exactly 1.000000", () => {
  const w = windowStats(spyBars, spy.r, N - 1, 252, spy);
  assert.ok(Math.abs((w.k as number) - 1) < 1e-9);
  assert.ok(Math.abs((w.m as number) - 1) < 1e-9);
  assert.ok(Math.abs((w.rrr as number) - 1) < 1e-9);
});

test("synthetic L× SPY matches a daily-rebalanced levered series to within 3%", () => {
  for (const L of [2, 3]) {
    const b = lev(L);
    const rr = dailyReturns(b.c);
    const measured = downsideVol(rr, N - 1, 252);
    const synth = syntheticDownsideVol(spy, N - 1, 252, L);
    assert.ok(Math.abs(measured / synth - 1) < 0.03, `L=${L}: ${measured} vs ${synth}`);
    const w = windowStats(b, rr, N - 1, 252, spy);
    assert.ok(Math.abs((w.m as number) - L) < 0.03 * L, `risk multiple ${w.m} should be ≈ ${L}`);
  }
});

test("k is capped at 12 on short windows only", () => {
  // asset that rises 5% a day for the last 21 bars: a huge multiple of SPY on every window
  const rets = spyRets.map((x, i) => (i >= N - 21 ? 0.05 : x));
  const b = barsFromReturns(rets);
  const rr = dailyReturns(b.c);
  const w1 = windowStats(b, rr, N - 1, 21, spy);
  const w3 = windowStats(b, rr, N - 1, 63, spy);
  const w12 = windowStats(b, rr, N - 1, 252, spy);
  assert.ok(w1.k === null || w1.k === 12, `1m k should be capped, got ${w1.k}`);
  assert.ok(w3.k === null || w3.k <= 12, `3m k should be capped, got ${w3.k}`);
  assert.ok(w12.k !== null && w12.k > 12, `12m k must be uncapped, got ${w12.k}`);
});

test("momentum indicators produce finite values on a long series", () => {
  const m = momentum(spyBars, N - 1);
  assert.ok(m.mom !== null && Number.isFinite(m.mom));
  assert.ok(m.momDays !== null && m.momDays >= 0 && m.momDays <= 126);
  assert.ok(m.gSep !== null && Number.isFinite(m.gSep));
  assert.equal(typeof m.gAligned, "boolean");
});

test("truncate cuts the series at a date", () => {
  const t = truncate(spyBars, spyBars.t[100]);
  assert.equal(t.t.length, 101);
  assert.equal(truncate(spyBars, null).t.length, N);
});

test("wrapper classification by fund name", () => {
  assert.equal(classifyWrapper("ProShares Ultra S&P500", "etf"), "leveraged");
  assert.equal(classifyWrapper("Direxion Daily Semiconductor Bull 3X Shares", "etf"), "leveraged");
  assert.equal(classifyWrapper("ProShares Short QQQ", "etf"), "inverse");
  assert.equal(classifyWrapper("JPMorgan Equity Premium Income ETF", "etf"), "option-income");
  assert.equal(classifyWrapper("Global X S&P 500 Covered Call ETF", "etf"), "option-income");
  assert.equal(classifyWrapper("Innovator U.S. Equity Power Buffer ETF - January", "etf"), "buffer");
  assert.equal(classifyWrapper("iShares LifePath Target Date 2040 ETF", "etf"), "target-date");
  assert.equal(classifyWrapper("ProShares VIX Short-Term Futures ETF", "etf"), "vix");
  assert.equal(classifyWrapper("Vanguard Short-Term Treasury ETF", "etf"), null);
  assert.equal(classifyWrapper("Breakwave Tanker Shipping ETF", "etf"), null);
  assert.equal(classifyWrapper("iShares MSCI USA Value Factor ETF", "etf"), null);
  assert.equal(classifyWrapper("Ultra Clean Holdings", "stock"), null);
  assert.equal(etfIssuer("State Street SPDR S&P Biotech ETF"), "SPDR");
  assert.equal(etfIssuer("United States Gasoline Fund LP"), "US Commodity Funds");
  assert.equal(etfIssuer("Breakwave Tanker Shipping ETF"), "Breakwave");
});

/** A synthetic universe: SPY, SSO, UPRO and 520 stocks in 8 industries with varied alpha and downside. */
function syntheticUniverse() {
  const rows: UniverseRow[] = [];
  const bars = new Map<string, Bars>();
  const add = (sym: string, name: string, kind: UniverseRow["kind"], industry: string, b: Bars) => {
    rows.push({ sym, name, kind, industry, sector: "", exchange: "X", scanClose: b.c[b.c.length - 1], marketCap: 1e9, spx: false });
    bars.set(sym, b);
  };
  add("SPY", "SPDR S&P 500 ETF Trust", "etf", "SPDR", spyBars);
  add("SSO", "ProShares Ultra S&P500", "etf", "ProShares", lev(2));
  add("UPRO", "ProShares UltraPro S&P500", "etf", "ProShares", lev(3));
  const g = rng(99);
  for (let i = 0; i < 520; i++) {
    const beta = 0.6 + g() * 1.6;
    const alpha = (g() - 0.4) * 0.0015;
    const idio = 0.004 + g() * 0.02;
    const rets = spyRets.map((x, j) => (j === 0 ? 0 : beta * x + alpha + idio * gauss(g)));
    add(`S${i}`, `Stock ${i}`, "stock", `Industry ${i % 8}`, barsFromReturns(rets));
  }
  add("JEPI", "JPMorgan Equity Premium Income ETF", "etf", "JPMorgan", barsFromReturns(spyRets.map((x) => x * 0.7)));
  return { rows, bars };
}

test("build() produces a consistent snapshot and the verification suite passes", () => {
  const { rows, bars } = syntheticUniverse();
  const { snapshot, scored, pass } = build({ universe: rows, universeSource: "test", scanned: rows.length, bars, fetchFailed: 0, provider: "test", prevTotal: null, todayNY: spyBars.t[N - 1] });
  assert.ok(pass, snapshot.checks.map((c) => `${c.name}: ${c.pass}`).join(", "));
  assert.equal(snapshot.totals.green + snapshot.totals.amber + snapshot.totals.red, snapshot.totals.beat);
  assert.ok(snapshot.totals.listGreen <= snapshot.totals.green);
  assert.equal(snapshot.green.length, Math.min(150, snapshot.greenTotal));
  for (const gr of snapshot.green) assert.ok(gr.k > 1 && gr.rrr > 1);
  const spyS = scored.find((s) => s.sym === "SPY")!;
  assert.ok(Math.abs((spyS.w12.rrr as number) - 1) < 1e-9);
  const jepi = scored.find((s) => s.sym === "JEPI")!;
  assert.equal(jepi.wrapper, "option-income");
  assert.equal(jepi.listGreen, false);
  assert.equal(snapshot.wrappers.count, 1);
  // industry table shares are consistent with counts
  for (const ind of snapshot.industries) assert.equal(ind.pct, Math.round((100 * ind.green) / ind.n));
  assert.ok(snapshot.path.t.length > 40);
  assert.equal(snapshot.path.spy[snapshot.path.spy.length - 1].toFixed(6), spyS.w12.r.toFixed(6));
});

test("row-count guard blocks a publish when the universe shrinks by more than 15%", () => {
  const { rows, bars } = syntheticUniverse();
  const scoredMap = new Map(rows.map((row) => [row.sym, scoreSymbol({ row, bars: bars.get(row.sym)!, spy, ssoRRR: null })!]));
  const ok = runChecks({ scored: scoredMap, spy, universeTotal: 1000, prevTotal: 1100, lastBar: spyBars.t[N - 1], todayNY: spyBars.t[N - 1] });
  assert.ok(ok.pass);
  const bad = runChecks({ scored: scoredMap, spy, universeTotal: 800, prevTotal: 1100, lastBar: spyBars.t[N - 1], todayNY: spyBars.t[N - 1] });
  assert.ok(!bad.pass);
  assert.ok(bad.checks.find((c) => c.name === "Row count guard" && !c.pass));
});

test("industry table excludes small groups and sorts by mean k/m", () => {
  const { rows, bars } = syntheticUniverse();
  const scored = rows.map((row) => scoreSymbol({ row, bars: bars.get(row.sym)!, spy, ssoRRR: null })!).filter(Boolean);
  const t = industryTable(scored, 8);
  assert.equal(t.length, 8);
  for (let i = 1; i < t.length; i++) assert.ok(t[i - 1].meanRRR >= t[i].meanRRR);
  assert.equal(industryTable(scored, 66).length, 0);
});
