import { waitUntil } from "@vercel/functions";
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { authorised, selfUrl } from "@/lib/auth";
import { CONFIG } from "@/lib/config";
import { nowNewYork } from "@/lib/data/dates";
import { runRefresh, type RunResult } from "@/lib/job/refresh";
import { KEYS, putJson } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The daily job. Vercel Cron calls this once at 23:00 UTC on weekdays. Each invocation does as much
 * fetching as fits in the time budget, saves progress, and triggers the next hop until the job is done.
 * Calling it again at any time is safe: it resumes the current job or starts a new one.
 *
 *   GET /api/cron/refresh              run one hop synchronously and start the chain (cron / manual)
 *   GET /api/cron/refresh?force=1      recompute even if there is no new trading day
 *   GET /api/cron/refresh?hop=1        a chained hop: replies 202 at once and works in the background
 *
 * Chained hops answer immediately so the hop that triggers them never has to wait or abort; the work
 * continues under waitUntil. State is in Blob, so a dropped hop is resumed by the next call from anywhere.
 */
function revalidate() {
  try {
    revalidatePath("/");
  } catch {
    /* the page also revalidates on its own schedule */
  }
}

async function kick(req: NextRequest): Promise<void> {
  const next = selfUrl(req, "/api/cron/refresh?hop=1");
  const secret = process.env.CRON_SECRET ?? "";
  try {
    await fetch(next, { headers: { authorization: `Bearer ${secret}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    console.error("chain trigger failed", e);
  }
}

async function runHop(req: NextRequest): Promise<void> {
  try {
    const result = await runRefresh({ trigger: "chain" });
    if (result.job.phase === "done") revalidate();
    if (result.needsChain) await kick(req);
  } catch (e) {
    console.error("chained hop failed", e);
  }
}

async function handle(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const force = req.nextUrl.searchParams.get("force") === "1";
  const chained = req.nextUrl.searchParams.get("hop") === "1";

  if (chained) {
    waitUntil(runHop(req));
    return NextResponse.json({ accepted: true }, { status: 202 });
  }

  const lines: string[] = [];
  let result: RunResult;
  try {
    result = await runRefresh({ force, trigger: "cron", log: (m) => lines.push(m) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await putJson(KEYS.status, { lastRunAt: new Date().toISOString(), lastRunAtNY: nowNewYork(), result: "failed", message: `Could not start the job: ${msg}`, asOf: null, jobId: null, checks: [], hops: 0 }).catch(() => undefined);
    return NextResponse.json({ error: msg, log: lines }, { status: 500 });
  }
  if (result.job.phase === "done") revalidate();
  if (result.needsChain) await kick(req);
  return NextResponse.json({
    job: { id: result.job.id, phase: result.job.phase, target: result.job.target, days: `${result.job.totalDates - result.job.pending.length}/${result.job.totalDates}`, hops: result.job.hops, rateLimitWaits: result.job.rateLimitWaits, lastError: result.job.lastError },
    busy: !!result.busy,
    chained: result.needsChain,
    budgetMs: CONFIG.TIME_BUDGET_MS,
    log: lines,
  });
}

export const GET = handle;
export const POST = handle;
