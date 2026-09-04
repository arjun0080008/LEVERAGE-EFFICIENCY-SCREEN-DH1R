import { NextResponse } from "next/server";
import { CONFIG } from "@/lib/config";
import { daysBetween, ymdFromDate } from "@/lib/data/dates";
import type { JobState } from "@/lib/job/refresh";
import type { Snapshot, Status } from "@/lib/snapshot";
import { getJson, getStore, KEYS } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Public read-only health: what is live, how old it is, and how the last run went. */
export async function GET() {
  try {
    const [latest, status, job] = await Promise.all([getJson<Snapshot>(KEYS.latest), getJson<Status>(KEYS.status), getJson<JobState>(KEYS.job)]);
    const today = ymdFromDate(new Date());
    const age = latest ? daysBetween(latest.asOf, today) : null;
    return NextResponse.json({
      ok: !!latest,
      store: getStore().kind,
      provider: process.env.DATA_PROVIDER ?? "yahoo",
      snapshot: latest ? { asOf: latest.asOfIso, generatedAt: latest.generatedAt, names: latest.universe.total, green: latest.totals.green, listGreen: latest.totals.listGreen, ageDays: age, stale: age !== null && age > CONFIG.STALE_AFTER_DAYS } : null,
      lastRun: status,
      job: job ? { id: job.id, phase: job.phase, shards: `${job.shardsDone.length}/${job.totalShards}`, hops: job.hops, startedAt: job.startedAt, finishedAt: job.finishedAt, lastError: job.lastError, tail: job.log.slice(-8) } : null,
      config: { minDollarVolume: CONFIG.MIN_DOLLAR_VOLUME_USD, minBars: CONFIG.MIN_BARS, maxBars: CONFIG.MAX_BARS, industryMinN: CONFIG.INDUSTRY_MIN_N, shardSize: CONFIG.SHARD_SIZE, timeBudgetMs: CONFIG.TIME_BUDGET_MS },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
