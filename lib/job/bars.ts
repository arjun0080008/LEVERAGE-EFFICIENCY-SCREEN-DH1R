import { CONFIG } from "@/lib/config";
import { pool } from "@/lib/data/http";
import type { DayRows } from "@/lib/data/polygon";
import { getGz, getJson, KEYS } from "@/lib/store";
import type { Bars } from "@/lib/types";

/** Index of stored day files. `empty` lists ISO dates known to be market holidays. */
export interface DaysIndex {
  files: Array<{ id: string; dates: number[] }>;
  empty: string[];
}

export interface DayFile {
  days: DayRows[];
}

export const emptyIndex = (): DaysIndex => ({ files: [], empty: [] });

export async function loadIndex(): Promise<DaysIndex> {
  return (await getJson<DaysIndex>(KEYS.days)) ?? emptyIndex();
}

export function datesHeld(index: DaysIndex): Set<number> {
  const s = new Set<number>();
  for (const f of index.files) for (const d of f.dates) s.add(d);
  return s;
}

/** Turn day-oriented rows into per-symbol series, keeping only `wanted` tickers. */
export function pivot(days: DayRows[], wanted: Set<string>): Map<string, Bars> {
  const sorted = days.slice().sort((a, b) => a.date - b.date);
  const out = new Map<string, Bars>();
  let lastDate = -1;
  for (const d of sorted) {
    if (d.date === lastDate) continue;
    lastDate = d.date;
    for (const sym of wanted) {
      const r = d.rows[sym];
      if (!r) continue;
      let b = out.get(sym);
      if (!b) {
        b = { t: [], o: [], h: [], l: [], c: [], v: [] };
        out.set(sym, b);
      }
      b.t.push(d.date);
      b.o.push(r[0]);
      b.h.push(r[1]);
      b.l.push(r[2]);
      b.c.push(r[3]);
      b.v.push(r[4]);
    }
  }
  for (const b of out.values()) {
    if (b.t.length > CONFIG.MAX_BARS) for (const k of ["t", "o", "h", "l", "c", "v"] as const) b[k] = b[k].slice(-CONFIG.MAX_BARS);
  }
  return out;
}

/** Download every day file in the index (in parallel) and pivot to per-symbol bars. */
export async function loadBars(index: DaysIndex, wanted: Set<string>, log?: (m: string) => void): Promise<{ bars: Map<string, Bars>; days: number; failedFiles: number }> {
  const results = await pool(index.files, CONFIG.LOAD_CONCURRENCY, async (f) => (await getGz<DayFile>(KEYS.dayFile(f.id)))?.days ?? []);
  const days: DayRows[] = [];
  let failedFiles = 0;
  results.forEach((r, i) => {
    if (r.ok) days.push(...r.value);
    else {
      failedFiles++;
      log?.(`day file ${index.files[i].id} failed to load: ${r.error}`);
    }
  });
  return { bars: pivot(days, wanted), days: days.length, failedFiles };
}
