import { waitUntil } from "@vercel/functions";
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { authorised, selfUrl } from "@/lib/auth";
import { CONFIG } from "@/lib/config";
import { runRefresh } from "@/lib/job/refresh";
import { KEYS, putJson } from "@/lib/store";
import { nowNewYork } from "@/lib/data/dates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The daily job. Vercel Cron calls this once at 23:00 UTC on weekdays. Each invocation does as much
 * fetching as fits in the time budget, saves progress, and re-invokes itself until the job is done.
 * Calling it again at any time is safe: it resumes the current job or starts a new one.
 *
 *   GET /api/cron/refresh              continue / start today's job
 *   GET /api/cron/refresh?force=1      recompute even if SPY has no new bar
 */
async function handle(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const force = req.nextUrl.searchParams.get("force") === "1";
  const chained = req.nextUrl.searchParams.get("hop") === "1";
  const lines: string[] = [];
  let result: Awaited<ReturnType<typeof runRefresh>>;
  try {
    result = await runRefresh({ force, trigger: chained ? "chain" : "cron", log: (m) => lines.push(m) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await putJson(KEYS.status, { lastRunAt: new Date().toISOString(), lastRunAtNY: nowNewYork(), result: "failed", message: `Could not start the job: ${msg}`, asOf: null, jobId: null, checks: [], hops: 0 }).catch(() => undefined);
    return NextResponse.json({ error: msg, log: lines }, { status: 500 });
  }

  if (result.job.phase === "done") revalidatePath("/");

  if (result.needsChain) {
    const next = selfUrl(req, "/api/cron/refresh?hop=1");
    const secret = process.env.CRON_SECRET ?? "";
    // Fire the next hop and return. The short abort only closes our side; the invoked function keeps running.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    waitUntil(
      fetch(next, { headers: { authorization: `Bearer ${secret}` }, signal: ctrl.signal, cache: "no-store" })
        .catch(() => undefined)
        .finally(() => clearTimeout(timer)),
    );
  }
  return NextResponse.json({
    job: { id: result.job.id, phase: result.job.phase, target: result.job.target, days: `${result.job.totalDates - result.job.pending.length}/${result.job.totalDates}`, hops: result.job.hops, rateLimitWaits: result.job.rateLimitWaits, lastError: result.job.lastError },
    chained: result.needsChain,
    budgetMs: CONFIG.TIME_BUDGET_MS,
    log: lines,
  });
}

export const GET = handle;
export const POST = handle;
