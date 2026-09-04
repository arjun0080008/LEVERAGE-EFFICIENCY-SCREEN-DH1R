import type { Scored } from "@/lib/types";

export interface IndustryRow {
  industry: string;
  n: number;
  meanK: number;
  meanM: number;
  meanRRR: number;
  green: number;
  /** green / n, as a percentage 0..100 */
  pct: number;
}

/**
 * Industry table: stocks only, grouped by scanner industry, 12m test only.
 * Means are over members that have a defined k, m and RRR.
 */
export function industryTable(rows: Scored[], minN: number): IndustryRow[] {
  const groups = new Map<string, Scored[]>();
  for (const s of rows) {
    if (s.kind !== "stock" || !s.industry) continue;
    const g = groups.get(s.industry) ?? [];
    g.push(s);
    groups.set(s.industry, g);
  }
  const out: IndustryRow[] = [];
  for (const [industry, g] of groups) {
    if (g.length < minN) continue;
    const ks = g.map((s) => s.w12.k).filter((x): x is number => x !== null);
    const ms = g.map((s) => s.w12.m).filter((x): x is number => x !== null);
    const rs = g.map((s) => s.w12.rrr).filter((x): x is number => x !== null);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    const green = g.filter((s) => s.green12).length;
    out.push({ industry, n: g.length, meanK: avg(ks), meanM: avg(ms), meanRRR: avg(rs), green, pct: Math.round((100 * green) / g.length) });
  }
  out.sort((a, b) => b.meanRRR - a.meanRRR);
  return out;
}
