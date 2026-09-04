import { CONFIG } from "@/lib/config";
import type { AssetKind, Bars, Scored, UniverseRow, WindowStats } from "@/lib/types";
import { atr, ema, highest, lowest, mean, stdevPop } from "./indicators";
import { classifyWrapper } from "./wrappers";

export const ANNUALISE = Math.sqrt(252);

/** Truncate a series so its last bar is on or before `asOf` (YYYYMMDD). */
export function truncate(b: Bars, asOf: number | null | undefined): Bars {
  if (!asOf) return b;
  let n = b.t.length;
  while (n > 0 && b.t[n - 1] > asOf) n--;
  if (n === b.t.length) return b;
  return { t: b.t.slice(0, n), o: b.o.slice(0, n), h: b.h.slice(0, n), l: b.l.slice(0, n), c: b.c.slice(0, n), v: b.v.slice(0, n) };
}

export function dailyReturns(c: number[]): number[] {
  const r = new Array<number>(c.length).fill(NaN);
  for (let i = 1; i < c.length; i++) r[i] = c[i] / c[i - 1] - 1;
  return r;
}

/** Annualised root-mean-square of negative daily returns only, over the last `w` returns ending at `end` (inclusive). */
export function downsideVol(r: number[], end: number, w: number): number {
  let ss = 0;
  let n = 0;
  for (let i = end - w + 1; i <= end; i++) {
    const x = r[i];
    if (x < 0) {
      ss += x * x;
      n++;
    }
  }
  if (n === 0) return 0;
  return Math.sqrt(ss / n) * ANNUALISE;
}

/** Max peak-to-trough drawdown of closes c[start..end], as a negative fraction. */
export function maxDrawdown(c: number[], start: number, end: number): number {
  let peak = -Infinity;
  let mdd = 0;
  for (let i = start; i <= end; i++) {
    if (c[i] > peak) peak = c[i];
    const dd = c[i] / peak - 1;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

/** Index of the last bar dated on or before `date`, or -1. */
export function indexAtOrBefore(t: number[], date: number): number {
  let lo = 0;
  let hi = t.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export interface SpyRef {
  bars: Bars;
  r: number[];
}

export function windowStats(bars: Bars, r: number[], end: number, w: number, spy: SpyRef): WindowStats {
  const c = bars.c;
  const start = end - w;
  const ret = c[end] / c[start] - 1;
  // SPY over the same calendar span, located by date so a missing bar on the asset side does not shift the reference
  const sEnd = indexAtOrBefore(spy.bars.t, bars.t[end]);
  const sStart = indexAtOrBefore(spy.bars.t, bars.t[start]);
  const rSpy = spy.bars.c[sEnd] / spy.bars.c[sStart] - 1;
  const spyDv = downsideVol(spy.r, sEnd, sEnd - sStart);
  let k: number | null = rSpy > 0.0001 ? ret / rSpy : null;
  if (k !== null && w <= CONFIG.K_CAP_MAX_WINDOW) k = Math.min(k, CONFIG.K_CAP);
  const dv = downsideVol(r, end, w);
  const m = spyDv > 0 && dv > 0 ? dv / spyDv : null;
  const rrr = k !== null && m !== null ? k / m : null;
  return { w, r: ret, rSpy, k, dv, m, rrr, mdd: maxDrawdown(c, start, end) };
}

export interface Momentum {
  mom: number | null;
  momDays: number | null;
  gAligned: boolean | null;
  gSep: number | null;
  squeeze: boolean | null;
}

/** Adaptive Squeeze Momentum Pro (default preset), GMMA and squeeze state at the last bar. */
export function momentum(b: Bars, end: number): Momentum {
  const n = end + 1;
  const h = b.h.slice(0, n);
  const l = b.l.slice(0, n);
  const c = b.c.slice(0, n);
  if (n < 61) return { mom: null, momDays: null, gAligned: null, gSep: null, squeeze: null };

  const hh = highest(h, 20);
  const ll = lowest(l, 20);
  const e20 = ema(c, 20);
  const a20 = atr(h, l, c, 20);
  const raw = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const midAll = ((hh[i] + ll[i]) * 0.5 + e20[i]) * 0.5;
    raw[i] = a20[i] > 0 ? (c[i] - midAll) / a20[i] : NaN;
  }
  const mv = ema(raw, 3);
  const mom = Number.isFinite(mv[n - 1]) ? mv[n - 1] : null;
  let momDays = 0;
  for (let i = Math.max(0, n - 126); i < n; i++) if (mv[i] > 1) momDays++;

  const shortL = [3, 5, 8, 10, 12, 15].map((L) => ema(c, L)[n - 1]);
  const longL = [30, 35, 40, 45, 50, 60].map((L) => ema(c, L)[n - 1]);
  const gAligned = Math.min(...shortL) > Math.max(...longL);
  const gSep = (mean(shortL) / mean(longL) - 1) * 100;

  const sd = stdevPop(c, 21)[n - 1];
  const a21 = atr(h, l, c, 21)[n - 1];
  const ratio = a21 > 0 ? (sd * 1.8 * 2) / (a21 * 1.6 * 2) : NaN;
  const squeeze = Number.isFinite(ratio) ? ratio < 1 : null;

  return { mom, momDays, gAligned, gSep: Number.isFinite(gSep) ? gSep : null, squeeze };
}

export interface ScoreInput {
  row: Pick<UniverseRow, "sym" | "name" | "kind" | "industry" | "sector" | "spx">;
  bars: Bars;
  spy: SpyRef;
  ssoRRR: number | null;
}

export function light12(k: number | null, rrr: number | null, ssoRRR: number | null): Scored["light12"] {
  if (k === null || rrr === null || k <= 1) return null;
  if (rrr > 1) return "green";
  if (ssoRRR !== null && rrr <= ssoRRR) return "red";
  if (ssoRRR === null) return "amber";
  return "amber";
}

export function scoreSymbol({ row, bars, spy, ssoRRR }: ScoreInput): Scored | null {
  const n = bars.c.length;
  const end = n - 1;
  const W = CONFIG.WINDOWS;
  if (n < W.w12 + 1) return null;
  const r = dailyReturns(bars.c);
  const w1 = windowStats(bars, r, end, W.w1, spy);
  const w3 = windowStats(bars, r, end, W.w3, spy);
  const w6 = windowStats(bars, r, end, W.w6, spy);
  const w12 = windowStats(bars, r, end, W.w12, spy);
  const mo = momentum(bars, end);
  const dvs: number[] = [];
  for (let i = Math.max(0, n - 20); i < n; i++) dvs.push(bars.c[i] * bars.v[i]);
  let maxDay = 0;
  for (let i = end - W.w12 + 1; i <= end; i++) if (Math.abs(r[i]) > maxDay) maxDay = Math.abs(r[i]);
  const verify: string[] = [];
  if (maxDay > CONFIG.VERIFY_MAX_DAY) verify.push(`single-day move ${(maxDay * 100).toFixed(0)}%`);
  if (w12.r > CONFIG.VERIFY_MAX_R12) verify.push(`12m return ${(w12.r * 100).toFixed(0)}%`);
  if (w12.k !== null && w12.k > CONFIG.VERIFY_MAX_K) verify.push(`k ${w12.k.toFixed(1)}× SPY`);
  const kind: AssetKind = row.kind;
  const wrapper = classifyWrapper(row.name, kind);
  const green12 = w12.k !== null && w12.rrr !== null && w12.k > 1 && w12.rrr > 1;
  const green6 = w6.k !== null && w6.rrr !== null && w6.k > 1 && w6.rrr > 1;
  return {
    sym: row.sym,
    name: row.name,
    kind,
    industry: row.industry,
    sector: row.sector,
    wrapper,
    spx: row.spx,
    bars: n,
    lastDate: bars.t[end],
    lastClose: bars.c[end],
    d1: r[end],
    dollarVol: mean(dvs),
    w1,
    w3,
    w6,
    w12,
    mom: mo.mom,
    momDays: mo.momDays,
    gAligned: mo.gAligned,
    gSep: mo.gSep,
    squeeze: mo.squeeze,
    maxDay,
    verify,
    green12,
    green6,
    listGreen: green12 && green6 && wrapper === null,
    light12: light12(w12.k, w12.rrr, ssoRRR),
  };
}

/** Downside vol of a synthetic L× daily-rebalanced SPY, built from SPY's own daily returns. */
export function syntheticDownsideVol(spy: SpyRef, end: number, w: number, leverage: number): number {
  const rl = spy.r.map((x) => x * leverage);
  return downsideVol(rl, end, w);
}
