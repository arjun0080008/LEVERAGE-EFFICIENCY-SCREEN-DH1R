import { CONFIG } from "@/lib/config";
import { daysBetween, nowNewYork, ymdFromDate } from "@/lib/data/dates";
import { pool } from "@/lib/data/http";
import { fetchNasdaqUniverse } from "@/lib/data/nasdaq";
import { getProvider, type Range } from "@/lib/data/providers";
import { fetchSpxMembers, fetchUniverse } from "@/lib/data/tradingview";
import type { Check, Snapshot, Status } from "@/lib/snapshot";
import { getJson, getStore, KEYS, putJson } from "@/lib/store";
import type { Bars, UniverseRow } from "@/lib/types";
import { build } from "./build";

export interface JobState {
  id: string;
  startedAt: string;
  phase: "fetch" | "compute" | "done" | "failed" | "skipped";
  totalShards: number;
  shardsDone: number[];
  hops: number;
  force: boolean;
  fetchFailed: number;
  lastError: string | null;
  log: string[];
  finishedAt: string | null;
}

export interface UniverseDoc {
  fetchedAt: string;
  source: string;
  scanned: number;
  rows: UniverseRow[];
}

export type ShardDoc = Record<string, Bars>;

export interface RunOptions {
  force?: boolean;
  budgetMs?: number;
  trigger: "cron" | "manual" | "chain" | "local";
  /** local runs can loop until done */
  untilDone?: boolean;
  log?: (m: string) => void;
}

export interface RunResult {
  job: JobState;
  /** true when another invocation is needed to finish */
  needsChain: boolean;
}

const nowIso = () => new Date().toISOString();

function log(job: JobState, m: string, opts: RunOptions) {
  const line = `${nowIso()} ${m}`;
  job.log.push(line);
  if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
  opts.log?.(line);
}

async function saveStatus(s: Status) {
  await putJson(KEYS.status, s);
}

function mergeBars(oldB: Bars | undefined, fresh: Bars): Bars {
  if (!oldB || oldB.t.length === 0) return prune(fresh);
  if (fresh.t.length === 0) return oldB;
  const cut = fresh.t[0];
  let keep = 0;
  while (keep < oldB.t.length && oldB.t[keep] < cut) keep++;
  const out: Bars = { t: [], o: [], h: [], l: [], c: [], v: [] };
  for (const k of ["t", "o", "h", "l", "c", "v"] as const) out[k] = oldB[k].slice(0, keep).concat(fresh[k]);
  return prune(out);
}

function prune(b: Bars): Bars {
  if (b.t.length <= CONFIG.MAX_BARS) return b;
  const out: Bars = { t: [], o: [], h: [], l: [], c: [], v: [] };
  for (const k of ["t", "o", "h", "l", "c", "v"] as const) out[k] = b[k].slice(-CONFIG.MAX_BARS);
  return out;
}

async function startJob(opts: RunOptions): Promise<{ job: JobState; universe: UniverseDoc | null }> {
  const job: JobState = {
    id: `${ymdFromDate(new Date())}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: nowIso(),
    phase: "fetch",
    totalShards: 0,
    shardsDone: [],
    hops: 0,
    force: !!opts.force,
    fetchFailed: 0,
    lastError: null,
    log: [],
    finishedAt: null,
  };
  const provider = getProvider();
  log(job, `job ${job.id} started by ${opts.trigger}; provider=${provider.name}; store=${getStore().kind}`, opts);

  // Holiday / no-new-bar detection: does SPY have a bar newer than the live snapshot?
  const spyProbe = await provider.fetchBars("SPY", "recent");
  const spyLast = spyProbe.t[spyProbe.t.length - 1];
  if (!spyLast) throw new Error("SPY probe returned no bars");
  const latest = await getJson<Snapshot>(KEYS.latest);
  log(job, `SPY latest bar ${spyLast}; live snapshot as of ${latest?.asOf ?? "none"}`, opts);
  if (!opts.force && latest && latest.asOf >= spyLast) {
    job.phase = "skipped";
    job.finishedAt = nowIso();
    log(job, "no new SPY bar since the live snapshot (holiday or already refreshed); nothing to do", opts);
    await putJson(KEYS.job, job);
    await saveStatus({ lastRunAt: nowIso(), lastRunAtNY: nowNewYork(), result: "skipped", message: `No new SPY bar (latest ${spyLast}); kept snapshot as of ${latest.asOfIso}.`, asOf: latest.asOf, jobId: job.id, checks: latest.checks, hops: 0 });
    return { job, universe: null };
  }

  // Universe
  let rows: UniverseRow[];
  let source = "tradingview";
  let scanned = 0;
  try {
    rows = await fetchUniverse({ minDollarVolume: CONFIG.MIN_DOLLAR_VOLUME_USD });
    scanned = rows.length;
    const spx = await fetchSpxMembers();
    if (spx) for (const r of rows) r.spx = spx.has(r.sym);
    log(job, `tradingview scanner: ${rows.length} candidates; S&P 500 membership ${spx ? spx.size + " names" : "unavailable"}`, opts);
  } catch (e) {
    log(job, `tradingview scanner failed (${e instanceof Error ? e.message : e}); falling back to Nasdaq Trader (no industries)`, opts);
    rows = await fetchNasdaqUniverse();
    source = "nasdaqtrader";
    scanned = rows.length;
    // Reuse the previous universe's industry map when the scanner is down, so the industry table survives a scanner outage
    const prev = await getJson<UniverseDoc>(KEYS.universe);
    if (prev) {
      const ind = new Map(prev.rows.map((r) => [r.sym, r]));
      for (const r of rows) {
        const p = ind.get(r.sym);
        if (p) {
          r.industry = p.industry;
          r.sector = p.sector;
          r.spx = p.spx;
        }
      }
      source = "nasdaqtrader+previous-industries";
    }
  }
  for (const b of CONFIG.BENCHMARKS) {
    if (!rows.some((r) => r.sym === b)) rows.push({ sym: b, name: b, kind: "etf", industry: "Benchmark", sector: "", exchange: "AMEX", scanClose: null, marketCap: null, spx: false });
  }
  rows.sort((a, b) => a.sym.localeCompare(b.sym));
  const universe: UniverseDoc = { fetchedAt: nowIso(), source, scanned, rows };
  job.totalShards = Math.ceil(rows.length / CONFIG.SHARD_SIZE);
  await putJson(KEYS.universe, universe);
  await putJson(KEYS.job, job);
  log(job, `universe saved: ${rows.length} symbols in ${job.totalShards} shards of ${CONFIG.SHARD_SIZE}`, opts);
  return { job, universe };
}

async function processShard(i: number, universe: UniverseDoc, job: JobState, opts: RunOptions): Promise<void> {
  const provider = getProvider();
  const syms = universe.rows.slice(i * CONFIG.SHARD_SIZE, (i + 1) * CONFIG.SHARD_SIZE).map((r) => r.sym);
  const existing = (await getJson<ShardDoc>(KEYS.shard(i))) ?? {};
  const today = ymdFromDate(new Date());
  let full = 0;
  let failed = 0;
  const results = await pool(syms, CONFIG.FETCH_CONCURRENCY, async (sym) => {
    const old = existing[sym];
    const last = old?.t[old.t.length - 1];
    const range: Range = old && last && daysBetween(last, today) <= CONFIG.INCREMENTAL_MAX_AGE_DAYS ? "recent" : "full";
    if (range === "full") full++;
    const fresh = await provider.fetchBars(sym, range);
    return { sym, bars: mergeBars(old, fresh) };
  });
  const out: ShardDoc = {};
  results.forEach((r, idx) => {
    const sym = syms[idx];
    if (r.ok) out[sym] = r.value.bars;
    else {
      failed++;
      if (existing[sym]) out[sym] = existing[sym];
    }
  });
  job.fetchFailed += failed;
  await putJson(KEYS.shard(i), out);
  log(job, `shard ${i + 1}/${job.totalShards}: ${syms.length} symbols, ${full} full backfills, ${failed} failed`, opts);
}

async function compute(job: JobState, opts: RunOptions): Promise<void> {
  const universe = await getJson<UniverseDoc>(KEYS.universe);
  if (!universe) throw new Error("universe document missing");
  const bars = new Map<string, Bars>();
  for (let i = 0; i < job.totalShards; i++) {
    const shard = await getJson<ShardDoc>(KEYS.shard(i));
    if (!shard) continue;
    for (const [sym, b] of Object.entries(shard)) bars.set(sym, b);
  }
  log(job, `loaded bars for ${bars.size} symbols`, opts);
  const prev = await getJson<Snapshot>(KEYS.latest);
  const { snapshot, scored, pass } = build({
    universe: universe.rows,
    universeSource: universe.source,
    scanned: universe.scanned,
    bars,
    fetchFailed: job.fetchFailed,
    provider: getProvider().name,
    prevTotal: prev?.universe.total ?? null,
    todayNY: ymdFromDate(new Date()),
  });
  for (const c of snapshot.checks) log(job, `${c.pass ? "PASS" : c.blocking ? "FAIL" : "WARN"} ${c.name}: ${c.detail}`, opts);
  if (!pass) {
    job.phase = "failed";
    job.lastError = "verification failed: " + snapshot.checks.filter((c) => !c.pass && c.blocking).map((c) => c.name).join(", ");
    job.finishedAt = nowIso();
    await putJson(KEYS.job, job);
    await saveStatus({ lastRunAt: nowIso(), lastRunAtNY: nowNewYork(), result: "failed", message: job.lastError + ". The previous snapshot stays live.", asOf: prev?.asOf ?? null, jobId: job.id, checks: snapshot.checks, hops: job.hops });
    return;
  }
  if (prev) await putJson(KEYS.previous, prev);
  await putJson(KEYS.dated(snapshot.asOfIso), snapshot);
  await putJson(KEYS.latest, snapshot);
  await putJson("snapshots/scored-latest.json", { asOf: snapshot.asOf, rows: scored });
  job.phase = "done";
  job.finishedAt = nowIso();
  await putJson(KEYS.job, job);
  await saveStatus({ lastRunAt: nowIso(), lastRunAtNY: nowNewYork(), result: "published", message: `Published snapshot as of ${snapshot.asOfIso}: ${snapshot.universe.total} names, ${snapshot.totals.green} green, ${snapshot.totals.listGreen} on the list.`, asOf: snapshot.asOf, jobId: job.id, checks: snapshot.checks, hops: job.hops });
  log(job, `published ${snapshot.asOfIso}`, opts);
}

const STALE_JOB_MS = 6 * 3600 * 1000;

/** One unit of work. Safe to call repeatedly; each call advances the current job as far as the time budget allows. */
export async function runRefresh(opts: RunOptions): Promise<RunResult> {
  const t0 = Date.now();
  const budget = opts.budgetMs ?? CONFIG.TIME_BUDGET_MS;
  const deadline = t0 + budget;
  let job = await getJson<JobState>(KEYS.job);
  let universe: UniverseDoc | null = null;
  const active = job && (job.phase === "fetch" || job.phase === "compute") && Date.now() - Date.parse(job.startedAt) < STALE_JOB_MS;
  if (!active || (opts.trigger !== "chain" && opts.force)) {
    const started = await startJob(opts);
    job = started.job;
    universe = started.universe;
    if (job.phase === "skipped") return { job, needsChain: false };
  }
  job = job as JobState;
  job.hops++;
  if (job.hops > CONFIG.MAX_HOPS) {
    job.phase = "failed";
    job.lastError = `exceeded ${CONFIG.MAX_HOPS} invocations`;
    job.finishedAt = nowIso();
    await putJson(KEYS.job, job);
    await saveStatus({ lastRunAt: nowIso(), lastRunAtNY: nowNewYork(), result: "failed", message: job.lastError, asOf: null, jobId: job.id, checks: [], hops: job.hops });
    return { job, needsChain: false };
  }
  await saveStatus({ lastRunAt: nowIso(), lastRunAtNY: nowNewYork(), result: "running", message: `Job ${job.id} in phase ${job.phase}, ${job.shardsDone.length}/${job.totalShards} shards fetched (hop ${job.hops}).`, asOf: null, jobId: job.id, checks: [], hops: job.hops });

  try {
    if (job.phase === "fetch") {
      universe = universe ?? (await getJson<UniverseDoc>(KEYS.universe));
      if (!universe) throw new Error("universe document missing");
      let lastShardMs = 0;
      const done = new Set(job.shardsDone);
      for (let i = 0; i < job.totalShards; i++) {
        if (done.has(i)) continue;
        if (!opts.untilDone && Date.now() + Math.max(lastShardMs * 1.2, 4000) > deadline) break;
        const s = Date.now();
        await processShard(i, universe, job, opts);
        lastShardMs = Date.now() - s;
        job.shardsDone.push(i);
        done.add(i);
        await putJson(KEYS.job, job);
      }
      if (job.shardsDone.length >= job.totalShards) {
        job.phase = "compute";
        await putJson(KEYS.job, job);
        log(job, "all shards fetched; moving to compute", opts);
      }
    }
    if (job.phase === "compute") {
      const remaining = deadline - Date.now();
      if (opts.untilDone || remaining > 20_000) {
        await compute(job, opts);
      } else {
        log(job, `only ${remaining}ms left; deferring compute to the next invocation`, opts);
        await putJson(KEYS.job, job);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.stack ?? e.message : String(e);
    job.lastError = msg;
    log(job, `error: ${msg}`, opts);
    // transient errors keep the job alive for the next hop; persistent ones hit MAX_HOPS
    await putJson(KEYS.job, job);
    await saveStatus({ lastRunAt: nowIso(), lastRunAtNY: nowNewYork(), result: "running", message: `Job ${job.id} hit an error and will retry on the next invocation: ${msg.split("\n")[0]}`, asOf: null, jobId: job.id, checks: [], hops: job.hops });
    return { job, needsChain: true };
  }
  return { job, needsChain: job.phase === "fetch" || job.phase === "compute" };
}

export async function readStatus(): Promise<Status | null> {
  return getJson<Status>(KEYS.status);
}

export function checksSummary(checks: Check[]): string {
  return checks.map((c) => `${c.pass ? "✓" : "✗"} ${c.name}`).join(", ");
}
