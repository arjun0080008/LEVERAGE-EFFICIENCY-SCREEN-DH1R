import { CONFIG } from "@/lib/config";
import type { Bars, Scored } from "@/lib/types";
import { mean, spearman, stdevSample } from "./indicators";
import { dailyReturns, downsideVol, indexAtOrBefore, type SpyRef } from "./score";

/** Rank correlation of each supporting metric against realised excess return and the ratio, across names. */
export interface MetricCorrRow {
  metric: string;
  key: "mom" | "momDays" | "gSep" | "gAligned";
  vs3: number;
  vs6: number;
  vs12: number;
  vsRRR: number;
  n: number;
}

export function metricCorrelations(rows: Scored[]): MetricCorrRow[] {
  const pool = rows.filter((s) => s.wrapper === null);
  const col = (f: (s: Scored) => number | boolean | null) => pool.map((s) => {
    const v = f(s);
    return v === null ? NaN : typeof v === "boolean" ? (v ? 1 : 0) : v;
  });
  const r3 = col((s) => s.w3.r - s.w3.rSpy);
  const r6 = col((s) => s.w6.r - s.w6.rSpy);
  const r12 = col((s) => s.w12.r - s.w12.rSpy);
  const rrr = col((s) => s.w12.rrr);
  const defs: Array<[string, MetricCorrRow["key"]]> = [
    ["momValue", "mom"],
    ["Days momValue > 1", "momDays"],
    ["GMMA separation", "gSep"],
    ["GMMA fully aligned", "gAligned"],
  ];
  return defs.map(([metric, key]) => {
    const x = col((s) => s[key]);
    return {
      metric,
      key,
      vs3: spearman(x, r3),
      vs6: spearman(x, r6),
      vs12: spearman(x, r12),
      vsRRR: spearman(x, rrr),
      n: x.filter((v) => Number.isFinite(v)).length,
    };
  });
}

/** Forward test: rank a member set at non-overlapping monthly dates and correlate with the next month's excess return over SPY. */
export interface LookbackRow {
  lookback: string;
  bars: number;
  skip: number;
  raw: number;
  volAdj: number;
  downside: number;
  tRaw: number;
  tVolAdj: number;
  tDownside: number;
  hitRaw: number;
  hitVolAdj: number;
  hitDownside: number;
}

export interface LookbackStudy {
  rows: LookbackRow[];
  months: number;
  members: number;
  memberLabel: string;
  bestT: number;
  hitLow: number;
  hitHigh: number;
}

const LOOKBACKS: Array<{ lookback: string; bars: number; skip: number }> = [
  { lookback: "1 month", bars: 21, skip: 0 },
  { lookback: "3 months", bars: 63, skip: 0 },
  { lookback: "6 months", bars: 126, skip: 0 },
  { lookback: "12 months", bars: 252, skip: 0 },
  { lookback: "12m skip 1m", bars: 252, skip: 21 },
];

function sampleVolAnnualised(r: number[], end: number, w: number): number {
  const xs: number[] = [];
  for (let i = end - w + 1; i <= end; i++) if (Number.isFinite(r[i])) xs.push(r[i]);
  const sd = stdevSample(xs);
  return sd * Math.sqrt(252);
}

export function lookbackStudy(members: Array<{ sym: string; bars: Bars }>, spy: SpyRef, memberLabel: string): LookbackStudy | null {
  const FWD = 21;
  const need = 252 + 21 + FWD + 1;
  const spyN = spy.bars.t.length;
  if (spyN < need) return null;
  // Monthly rank dates on SPY's calendar: last usable date is spyN-1-FWD, step back 21 bars while the longest lookback fits
  const dates: number[] = [];
  for (let e = spyN - 1 - FWD; e - (252 + 21) >= 0; e -= 21) dates.push(e);
  dates.reverse();
  if (dates.length < 3) return null;
  const prepared = members.map((m) => ({ ...m, r: dailyReturns(m.bars.c) }));

  const rows: LookbackRow[] = LOOKBACKS.map((L) => {
    const ics = { raw: [] as number[], volAdj: [] as number[], downside: [] as number[] };
    for (const e of dates) {
      const dEnd = spy.bars.t[e];
      const dFwd = spy.bars.t[e + FWD];
      const spyStartIdx = e - L.skip - L.bars;
      const spyEndIdx = e - L.skip;
      const spyR = spy.bars.c[spyEndIdx] / spy.bars.c[spyStartIdx] - 1;
      const spyFwd = spy.bars.c[e + FWD] / spy.bars.c[e] - 1;
      const spyDv = downsideVol(spy.r, spyEndIdx, L.bars);
      const raw: number[] = [];
      const volAdj: number[] = [];
      const down: number[] = [];
      const fwd: number[] = [];
      for (const m of prepared) {
        const iEnd = indexAtOrBefore(m.bars.t, dEnd);
        const iFwd = indexAtOrBefore(m.bars.t, dFwd);
        if (iEnd < 0 || iFwd <= iEnd || m.bars.t[iEnd] !== dEnd) continue;
        const iLbEnd = iEnd - L.skip;
        const iLbStart = iLbEnd - L.bars;
        if (iLbStart < 1) continue;
        const R = m.bars.c[iLbEnd] / m.bars.c[iLbStart] - 1;
        const vol = sampleVolAnnualised(m.r, iLbEnd, L.bars);
        const dv = downsideVol(m.r, iLbEnd, L.bars);
        const f = m.bars.c[iFwd] / m.bars.c[iEnd] - 1 - spyFwd;
        raw.push(R);
        volAdj.push(vol > 0 ? R / vol : NaN);
        down.push(dv > 0 ? (R - spyR) / dv : spyDv > 0 ? NaN : NaN);
        fwd.push(f);
      }
      if (raw.length < 30) continue;
      ics.raw.push(spearman(raw, fwd));
      ics.volAdj.push(spearman(volAdj, fwd));
      ics.downside.push(spearman(down, fwd));
    }
    const t = (xs: number[]) => (xs.length > 1 ? mean(xs) / (stdevSample(xs) / Math.sqrt(xs.length)) : NaN);
    const hit = (xs: number[]) => (xs.length ? xs.filter((x) => x > 0).length / xs.length : NaN);
    return {
      ...L,
      raw: mean(ics.raw),
      volAdj: mean(ics.volAdj),
      downside: mean(ics.downside),
      tRaw: t(ics.raw),
      tVolAdj: t(ics.volAdj),
      tDownside: t(ics.downside),
      hitRaw: hit(ics.raw),
      hitVolAdj: hit(ics.volAdj),
      hitDownside: hit(ics.downside),
    };
  });
  const ts = rows.flatMap((r) => [r.tRaw, r.tVolAdj, r.tDownside]).filter((x) => Number.isFinite(x));
  const hits = rows.flatMap((r) => [r.hitRaw, r.hitVolAdj, r.hitDownside]).filter((x) => Number.isFinite(x));
  return {
    rows,
    months: dates.length,
    members: members.length,
    memberLabel,
    bestT: ts.length ? Math.max(...ts.map(Math.abs)) : NaN,
    hitLow: hits.length ? Math.min(...hits) : NaN,
    hitHigh: hits.length ? Math.max(...hits) : NaN,
  };
}

export const STUDY_MIN_MEMBERS = 100;
export const MAX_BARS = CONFIG.MAX_BARS;
