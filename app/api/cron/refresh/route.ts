import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { authorised } from "@/lib/auth";
import { CONFIG } from "@/lib/config";
import { nowNewYork } from "@/lib/data/dates";
import { kickNextHop } from "@/lib/job/kick";
import { runRefresh, type RunResult } from "@/lib/job/refresh";
import { KEYS, putJson } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The daily job. Vercel Cron calls this once at 23:00 UTC on weekdays. Each invocation does as much
 * fetching as fits in the time budget, saves progress, triggers the next hop, and returns. Calling it
 * again at any time is safe: it resumes the current job, starts a new one, or reports busy.
 *
 *   GET /api/cron/refresh              run one hop and trigger the next (cron / manual / chained)
 *   GET /api/cron/refresh?force=1      recompute even if there is no new trading day
 */
async function handle(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const force = req.nextUrl.searchParams.get("force") === "1";
  const chained = req.nextUrl.searchParams.get("hop") === "1";

  const lines: string[] = [];
  let result: RunResult;
  try {
    result = await runRefresh({ force, trigger: chained ? "chain" : "cron", log: (m) => lines.push(m) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await putJson(KEYS.status, { lastRunAt: new Date().toISOString(), lastRunAtNY: nowNewYork(), result: "failed", message: `Could not start the job: ${msg}`, asOf: null, jobId: null, checks: [], hops: 0 }).catch(() => undefined);
    return NextResponse.json({ error: msg, log: lines }, { status: 500 });
  }
  if (result.job.phase === "done") {
    try {
      revalidatePath("/");
    } catch {
      /* the page also revalidates on its own schedule */
    }
  }
  let kicked = false;
  if (result.needsChain && !result.busy) kicked = await kickNextHop(req);
  return NextResponse.json({
    job: { id: result.job.id, phase: result.job.phase, target: result.job.target, days: `${result.job.totalDates - result.job.pending.length}/${result.job.totalDates}`, hops: result.job.hops, rateLimitWaits: result.job.rateLimitWaits, lastError: result.job.lastError },
    busy: !!result.busy,
    chained: result.needsChain,
    kicked,
    budgetMs: CONFIG.TIME_BUDGET_MS,
    log: lines,
  });
}

export const GET = handle;
export const POST = handle;
