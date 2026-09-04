import { CONFIG } from "@/lib/config";
import { isoFromYmd, nowNewYork, ymdFromDate, ymdFromIso } from "@/lib/data/dates";
import { fetchNasdaqUniverse } from "@/lib/data/nasdaq";
import { fetchGroupedDaily, RateLimited, weekdaysBetween, type DayRows } from "@/lib/data/polygon";
import { fetchSpxMembers, fetchUniverse } from "@/lib/data/tradingview";
import type { Check, Snapshot, Status } from "@/lib/snapshot";
import { getJson, getStore, KEYS, putGz, putJson } from "@/lib/store";
import type { UniverseRow } from "@/lib/types";
import { datesHeld, loadBars, loadIndex, type DayFile, type DaysIndex } from "./bars";
import { build } from "./build";

export interface JobState {
  id: string;
  startedAt: string;
  phase: "fetch" | "compute" | "done" | "failed" | "skipped";
  /** ISO date of the newest trading day, the one the snapshot will be "as of" */
  target: string;
  /** ISO dates still to fetch, newest first */
  pending: string[];
  totalDates: number;
  hops: number;
  force: boolean;
  rateLimitWaits: number;
  lastError: string | null;
  log: string[];
  finishedAt: string | null;
  /** while set and in the future, another invocation is working this job and new callers must not */
  leaseUntil: string | null;
}

export interface UniverseDoc {
  fetchedAt: string;
  source: string;
  scanned: number;
  rows: UniverseRow[];
}

export interface RunOptions {
  force?: boolean;
  budgetMs?: number;
  trigger: "cron" | "manual" | "chain" | "local";
  /** local runs loop until done, waiting out rate limits inline */
  untilDone?: boolean;
  log?: (m: string) => void;
}

export interface RunResult {
  job: JobState;
  /** true when another invocation is needed to finish */
  needsChain: boolean;
  /** true when another invocation holds the lease and this call did nothing */
  busy?: boolean;
}

const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(job: JobState, m: string, opts: RunOptions) {
  const line = `${nowIso()} ${m}`;
  job.log.push(line);
  if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
  opts.log?.(line);
}

async function saveStatus(s: Status) {
  await putJson(KEYS.status, s);
}

function isoShift(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Newest weekday whose close should already be published: today in New York after 16:15 ET, otherwise the previous weekday. */
function expectedTargetIso(): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let iso = `${get("year")}-${get("month")}-${get("day")}`;
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  if (mins < 16 * 60 + 15) iso = isoShift(iso, -1);
  while ([0, 6].includes(new Date(iso + "T00:00:00Z").getUTCDay())) iso = isoShift(iso, -1);
  return iso;
}

async function writeDayFile(index: DaysIndex, days: DayRows[]): Promise<void> {
  if (!days.length) return;
  const sorted = days.slice().sort((a, b) => a.date - b.date);
  const id = `${sorted[0].date}_${sorted[sorted.length - 1].date}_${Math.random().toString(36).slice(2, 6)}`;
  const file: DayFile = { days: sorted };
  await putGz(KEYS.dayFile(id), file);
  index.files.push({ id, dates: sorted.map((d) => d.date) });
  index.files.sort((a, b) => a.dates[0] - b.dates[0]);
}

async function startJob(opts: RunOptions): Promise<JobState> {
  const job: JobState = {
    id: `${ymdFromDate(new Date())}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: nowIso(),
    phase: "fetch",
    target: "",
    pending: [],
    totalDates: 0,
    hops: 0,
    force: !!opts.force,
    rateLimitWaits: 0,
    lastError: null,
    log: [],
    finishedAt: null,
    leaseUntil: null,
  };
  log(job, `job ${job.id} started by ${opts.trigger}; bars=polygon grouped daily; store=${getStore().kind}`, opts);

  // Find the newest published trading day: walk back from the expected date until Polygon returns rows.
  const index = await loadIndex();
  const held = datesHeld(index);
  let iso = expectedTargetIso();
  let latestRows: DayRows | null = null;
  const fresh: DayRows[] = [];
  for (let tries = 0; tries < 6 && !latestRows; tries++) {
    if (held.has(ymdFromIso(iso))) {
      latestRows = { date: ymdFromIso(iso), rows: {} };
      log(job, `${iso} already stored; treating it as the newest trading day`, opts);
      break;
    }
    if (index.empty.includes(iso)) {
      iso = isoShift(iso, -1);
      continue;
    }
    try {
      const rows = await fetchGroupedDaily(iso);
      if (rows) {
        latestRows = rows;
        fresh.push(rows);
        log(job, `${iso}: ${Object.keys(rows.rows).length} tickers`, opts);
      } else {
        index.empty.push(iso);
        log(job, `${iso}: market closed or not yet published`, opts);
        iso = isoShift(iso, -1);
      }
    } catch (e) {
      if (e instanceof RateLimited) {
        job.rateLimitWaits++;
        await sleep(CONFIG.RATE_LIMIT_WAIT_MS);
        tries--;
        continue;
      }
      throw e;
    }
    while ([0, 6].includes(new Date(iso + "T00:00:00Z").getUTCDay())) iso = isoShift(iso, -1);
  }
  if (!latestRows) throw new Error("could not find a published trading day in the last six weekdays");
  job.target = iso;

  const latest = await getJson<Snapshot>(KEYS.latest);
  log(job, `newest trading day ${iso}; live snapshot as of ${latest?.asOfIso ?? "none"}`, opts);
  if (fresh.length) await writeDayFile(index, fresh);
  await putJson(KEYS.days, index);
  if (!opts.force && latest && latest.asOf >= ymdFromIso(iso)) {
    job.phase = "skipped";
    job.finishedAt = nowIso();
    log(job, "no new trading day since the live snapshot; nothing to do", opts);
    await putJson(KEYS.job, job);
    await saveStatus({ lastRunAt: nowIso(), lastRunAtNY: nowNewYork(), result: "skipped", message: `No new trading day (newest ${iso}); kept snapshot as of ${latest.asOfIso}.`, asOf: latest.asOf, jobId: job.id, checks: latest.checks, hops: 0 });
    return job;
  }

  // Universe with industries
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
    log(job, `tradingview scanner failed (${e instanceof Error ? e.message : e}); falling back to Nasdaq Trader`, opts);
    rows = await fetchNasdaqUniverse();
    source = "nasdaqtrader";
    scanned = rows.length;
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
  await putJson(KEYS.universe, { fetchedAt: nowIso(), source, scanned, rows } satisfies UniverseDoc);

  // Which trading days are missing from the store?
  const have = datesHeld(index);
  const needed = weekdaysBetween(isoShift(iso, -CONFIG.BACKFILL_DAYS), iso);
  job.pending = needed.filter((d) => !have.has(ymdFromIso(d)) && !index.empty.includes(d)).reverse();
  job.totalDates = job.pending.length;
  job.phase = job.pending.length ? "fetch" : "compute";
  await putJson(KEYS.job, job);
  log(job, `universe saved: ${rows.length} symbols; ${have.size} trading days stored, ${job.pending.length} to fetch`, opts);
  return job;
}

async function fetchDays(job: JobState, deadline: number, opts: RunOptions): Promise<void> {
  const index = await loadIndex();
  const batch: DayRows[] = [];
  while (job.pending.length) {
    if (!opts.untilDone && Date.now() + 6000 > deadline) break;
    const iso = job.pending[0];
    try {
      const rows = await fetchGroupedDaily(iso);
      if (rows) batch.push(rows);
      else index.empty.push(iso);
      job.pending.shift();
    } catch (e) {
      if (e instanceof RateLimited) {
        job.rateLimitWaits++;
        if (!opts.untilDone && Date.now() + CONFIG.RATE_LIMIT_WAIT_MS + 6000 > deadline) break;
        await sleep(CONFIG.RATE_LIMIT_WAIT_MS);
        continue;
      }
      throw e;
    }
  }
  await writeDayFile(index, batch);
  // retention
  const cutoff = ymdFromIso(isoShift(job.target, -CONFIG.RETENTION_DAYS));
  const stale = index.files.filter((f) => f.dates[f.dates.length - 1] < cutoff);
  for (const f of stale) {
    await getStore().del(KEYS.dayFile(f.id));
    index.files = index.files.filter((x) => x.id !== f.id);
  }
  await putJson(KEYS.days, index);
  log(job, `fetched ${batch.length} trading days this hop (${job.pending.length} left, ${job.rateLimitWaits} rate-limit pauses so far)`, opts);
  if (job.pending.length === 0) {
    job.phase = "compute";
    log(job, "all days fetched; moving to compute", opts);
  }
  await putJson(KEYS.job, job);
}

async function compute(job: JobState, opts: RunOptions): Promise<void> {
  const universe = await getJson<UniverseDoc>(KEYS.universe);
  if (!universe) throw new Error("universe document missing");
  const index = await loadIndex();
  const wanted = new Set<string>([...universe.rows.map((r) => r.sym), ...CONFIG.BENCHMARKS]);
  const { bars, days, failedFiles } = await loadBars(index, wanted, (m) => log(job, m, opts));
  log(job, `loaded ${days} trading days for ${bars.size} symbols from ${index.files.length} files`, opts);
  if (failedFiles) throw new Error(`${failedFiles} day files failed to load; retrying next invocation`);
  const prev = await getJson<Snapshot>(KEYS.latest);
  const { snapshot, scored, pass } = build({
    universe: universe.rows,
    universeSource: universe.source,
    scanned: universe.scanned,
    bars,
    fetchFailed: 0,
    provider: "polygon",
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
  await putGz("snapshots/scored-latest.json.gz", { asOf: snapshot.asOf, rows: scored });
  job.phase = "done";
  job.finishedAt = nowIso();
  await putJson(KEYS.job, job);
  await saveStatus({ lastRunAt: nowIso(), lastRunAtNY: nowNewYork(), result: "published", message: `Published snapshot as of ${snapshot.asOfIso}: ${snapshot.universe.total} names, ${snapshot.totals.green} green, ${snapshot.totals.listGreen} on the list.`, asOf: snapshot.asOf, jobId: job.id, checks: snapshot.checks, hops: job.hops });
  log(job, `published ${snapshot.asOfIso} (${isoFromYmd(snapshot.asOf)})`, opts);
}

const STALE_JOB_MS = 12 * 3600 * 1000;

/** One unit of work. Safe to call repeatedly; each call advances the current job as far as the time budget allows. */
export async function runRefresh(opts: RunOptions): Promise<RunResult> {
  const t0 = Date.now();
  const budget = opts.budgetMs ?? CONFIG.TIME_BUDGET_MS;
  const deadline = t0 + budget;
  let job = await getJson<JobState>(KEYS.job);
  const active = job && (job.phase === "fetch" || job.phase === "compute") && Date.now() - Date.parse(job.startedAt) < STALE_JOB_MS;
  if (active && job?.leaseUntil && Date.parse(job.leaseUntil) > Date.now()) {
    opts.log?.(`job ${job.id} is being worked by another invocation until ${job.leaseUntil}; nothing to do`);
    return { job, needsChain: false, busy: true };
  }
  if (!active || (opts.trigger !== "chain" && opts.force)) {
    job = await startJob(opts);
    if (job.phase === "skipped") return { job, needsChain: false };
  }
  job = job as JobState;
  job.hops++;
  job.leaseUntil = new Date(deadline + 30_000).toISOString();
  await putJson(KEYS.job, job);
  if (job.hops > CONFIG.MAX_HOPS) {
    job.phase = "failed";
    job.lastError = `exceeded ${CONFIG.MAX_HOPS} invocations`;
    job.finishedAt = nowIso();
    await putJson(KEYS.job, job);
    await saveStatus({ lastRunAt: nowIso(), lastRunAtNY: nowNewYork(), result: "failed", message: job.lastError, asOf: null, jobId: job.id, checks: [], hops: job.hops });
    return { job, needsChain: false };
  }
  await saveStatus({ lastRunAt: nowIso(), lastRunAtNY: nowNewYork(), result: "running", message: `Job ${job.id} in phase ${job.phase}: ${job.totalDates - job.pending.length}/${job.totalDates} trading days fetched (hop ${job.hops}).`, asOf: null, jobId: job.id, checks: [], hops: job.hops });

  try {
    if (job.phase === "fetch") {
      do {
        await fetchDays(job, deadline, opts);
      } while (opts.untilDone && job.phase === "fetch");
    }
    if (job.phase === "compute") {
      const remaining = deadline - Date.now();
      if (opts.untilDone || remaining > 25_000) {
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
    job.leaseUntil = null;
    await putJson(KEYS.job, job);
    await saveStatus({ lastRunAt: nowIso(), lastRunAtNY: nowNewYork(), result: "running", message: `Job ${job.id} hit an error and will retry on the next invocation: ${msg.split("\n")[0]}`, asOf: null, jobId: job.id, checks: [], hops: job.hops });
    return { job, needsChain: true };
  }
  job.leaseUntil = null;
  await putJson(KEYS.job, job);
  return { job, needsChain: job.phase === "fetch" || job.phase === "compute" };
}

export async function readStatus(): Promise<Status | null> {
  return getJson<Status>(KEYS.status);
}

export function checksSummary(checks: Check[]): string {
  return checks.map((c) => `${c.pass ? "✓" : "✗"} ${c.name}`).join(", ");
}
