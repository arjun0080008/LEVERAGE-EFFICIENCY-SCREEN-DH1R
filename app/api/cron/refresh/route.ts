import { waitUntil } from "@vercel/functions";
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { authorised, selfUrl } from "@/lib/auth";
import { CONFIG } from "@/lib/config";
import { runRefresh } from "@/lib/job/refresh";

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
  const result = await runRefresh({ force, trigger: chained ? "chain" : "cron", log: (m) => lines.push(m) });

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
    job: { id: result.job.id, phase: result.job.phase, shards: `${result.job.shardsDone.length}/${result.job.totalShards}`, hops: result.job.hops, lastError: result.job.lastError },
    chained: result.needsChain,
    budgetMs: CONFIG.TIME_BUDGET_MS,
    log: lines,
  });
}

export const GET = handle;
export const POST = handle;
