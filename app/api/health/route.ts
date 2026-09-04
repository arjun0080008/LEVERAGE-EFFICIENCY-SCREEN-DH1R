import { NextResponse, type NextRequest } from "next/server";
import { CONFIG } from "@/lib/config";
import { daysBetween, ymdFromDate } from "@/lib/data/dates";
import { datesHeld, loadIndex } from "@/lib/job/bars";
import { kickNextHop } from "@/lib/job/kick";
import type { JobState } from "@/lib/job/refresh";
import type { Snapshot, Status } from "@/lib/snapshot";
import { getJson, getStore, KEYS } from "@/lib/store";

export const dynamic = "force-dynamic";

const STALL_MS = 2 * 60 * 1000;

/** True when a job is mid-flight but nothing has touched it for a while (a dropped hop). */
function stalled(job: JobState | null): boolean {
  if (!job || (job.phase !== "fetch" && job.phase !== "compute")) return false;
  if (job.leaseUntil && Date.parse(job.leaseUntil) > Date.now()) return false;
  const last = job.log.length ? Date.parse(job.log[job.log.length - 1].slice(0, 24)) : Date.parse(job.startedAt);
  return Number.isFinite(last) && Date.now() - last > STALL_MS;
}

/** Public read-only health: what is live, how old it is, and how the last run went. Revives a stalled job. */
export async function GET(req: NextRequest) {
  try {
    const [latest, status, job, index] = await Promise.all([getJson<Snapshot>(KEYS.latest), getJson<Status>(KEYS.status), getJson<JobState>(KEYS.job), loadIndex()]);
    const revived = stalled(job) ? await kickNextHop(req) : false;
    const today = ymdFromDate(new Date());
    const age = latest ? daysBetween(latest.asOf, today) : null;
    const held = datesHeld(index);
    const dates = [...held].sort();
    return NextResponse.json({
      ok: !!latest,
      revived,
      store: getStore().kind,
      provider: "polygon grouped daily",
      polygonKey: !!process.env.POLYGON_API_KEY,
      snapshot: latest ? { asOf: latest.asOfIso, generatedAt: latest.generatedAt, names: latest.universe.total, green: latest.totals.green, listGreen: latest.totals.listGreen, ageDays: age, stale: age !== null && age > CONFIG.STALE_AFTER_DAYS } : null,
      bars: { tradingDaysStored: held.size, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null, files: index.files.length },
      lastRun: status,
      job: job ? { id: job.id, phase: job.phase, target: job.target, daysFetched: `${job.totalDates - job.pending.length}/${job.totalDates}`, hops: job.hops, rateLimitWaits: job.rateLimitWaits, leaseUntil: job.leaseUntil, startedAt: job.startedAt, finishedAt: job.finishedAt, lastError: job.lastError, tail: job.log.slice(-8) } : null,
      config: { minDollarVolume: CONFIG.MIN_DOLLAR_VOLUME_USD, minBars: CONFIG.MIN_BARS, maxBars: CONFIG.MAX_BARS, industryMinN: CONFIG.INDUSTRY_MIN_N, backfillDays: CONFIG.BACKFILL_DAYS, timeBudgetMs: CONFIG.TIME_BUDGET_MS },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
