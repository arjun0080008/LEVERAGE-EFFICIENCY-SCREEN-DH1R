# Return Per Unit of Downside

A self-updating leverage-efficiency screen. Every US-listed stock and ETF is scored on how much return it earned
per unit of *downside* volatility versus SPY, and the whole page — every table, count, percentage and sentence
with a number in it — is regenerated from fresh daily bars after each close. Nothing on the page is hardcoded.

```
k   = asset return ÷ SPY return              (return multiple)
m   = asset downside vol ÷ SPY downside vol  (risk multiple; only down days count)
k/m = return per unit of added downside      (SPY = 1.000 by construction)
```

Green = `k > 1` and `k/m > 1`. Amber = beat SPY but `SSO_k/m < k/m ≤ 1`. Red = `k/m ≤ SSO_k/m`, you'd have been
better off in 2× leverage. The ranked list requires green on both the 6m and 12m windows; the industry table uses
the 12m test only, and both are labelled as such on the page.

---

## How it works

```
app/page.tsx              static page rendered from the JSON snapshot (ISR, revalidated on publish)
app/api/cron/refresh      the daily job: fetch → compute → verify → publish (chunked across invocations)
app/api/health            what is live, how old it is, and how the last run went
app/api/snapshot          the live snapshot JSON (?which=previous, ?which=scored)
lib/data                  TradingView scanner (universe + industries), Polygon grouped-daily bars,
                          Nasdaq Trader fallback, retry/backoff/concurrency pool
lib/metrics               all the math, pure functions: indicators, scoring, industry table, studies, wrappers
lib/verify                the verification suite that gates every publish
lib/job                   snapshot builder and the chunked job orchestrator
lib/store                 Vercel Blob in production, ./.data on disk locally
components                the dashboard (client) and its animation primitives
tests                     unit tests (node:test)
scripts                   probe-sources, refresh-local, seed-blob, golden-check
golden                    the verified output for the 2026-09-03 close (green.txt, ind.txt)
```

**Schedule.** `vercel.json` runs `/api/cron/refresh` at `0 23 * * 1-5` (23:00 UTC, always after the 4pm ET close in
both DST regimes). Holidays are detected by checking whether SPY has a bar newer than the live snapshot; if not, the
run is skipped and the snapshot untouched.

**Day files, not symbol files.** Bars come from Polygon's *grouped daily* endpoint, which returns every US
ticker's OHLCV for one trading date in a single request. So the store is organised by date: each fetch hop writes one
gzipped file holding the days it fetched (`days/<from>_<to>.json.gz`, all ~10,000 tickers per day, ~150 KB each) and
an index (`state/days.json`) lists what is held. A normal night is **one API request**. The compute phase downloads
all day files in parallel, pivots them into per-symbol series for the universe, and scores.

**Chunking.** A Hobby function gets 60 s and a Pro function 300 s, and the free Polygon plan allows 5 requests a
minute, so the one-time backfill (~500 trading days) cannot happen in one invocation. The job keeps its state in Blob
(`state/job.json`), fetches as many dates as the time budget allows (`TIME_BUDGET_MS`, default 45 s, pausing 12.5 s on
a 429), saves, and re-invokes itself via `?hop=1` until the pending list is empty. The compute phase runs in its own
invocation. Any call to the endpoint resumes the current job, so it is safe to poke it manually, and the optional
GitHub Actions workflow (`.github/workflows/refresh.yml`) can drive it to completion as a backup.

**Retention.** Day files whose newest date is older than `RETENTION_DAYS` (820) are deleted; series are trimmed to
`MAX_BARS` (520) at compute time, enough for the 12-month windows plus the forward lookback study.

**Publishing.** On a passing verification the previous snapshot is moved to `snapshots/previous.json`, the new one
written to `snapshots/latest.json` and `snapshots/<date>.json`, and the page is revalidated. On a failing
verification nothing is written except `state/status.json`; the page keeps serving the last good snapshot and shows
a stale-data banner with the age and the failure reason.

---

## Deploying

1. **Create the Vercel project** from this repository. Framework: Next.js (auto-detected).
2. **Attach a Blob store**: Vercel dashboard → Storage → Create → Blob → connect to the project. This injects
   `BLOB_READ_WRITE_TOKEN` automatically.
3. **Set `CRON_SECRET`** in the project's environment variables (`openssl rand -hex 32`). Vercel Cron sends it as
   `Authorization: Bearer <CRON_SECRET>`; manual calls can use the same header or `?key=<CRON_SECRET>`.
   **Set `POLYGON_API_KEY`** too: sign up at polygon.io (the free Basic plan is enough), Dashboard → API Keys.
4. Deploy. The page shows a setup screen until the first snapshot exists.
5. **Verify the data sources before trusting them** (see below), then kick off the first backfill:
   ```
   curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>.vercel.app/api/cron/refresh
   ```
   Watch `/api/health` — it reports the job phase, days fetched, hop count and the last log lines. On the free
   Polygon plan the first backfill is ~500 requests at 5 per minute, so expect **about 100 minutes** across ~130
   chained hops. Every night after that is one request and 1–2 hops. If you would rather have the backfill done in
   five minutes, Polygon's Starter plan removes the rate limit and can be cancelled afterwards.
   `/api/probe?key=<CRON_SECRET>` tests every data source from inside Vercel and prints what each one returned.
6. Optional but recommended: add `APP_URL` and `CRON_SECRET` as GitHub repository secrets so the backup workflow
   drives the job if a self-chained hop is ever dropped.

**Which tier.** It runs on **Hobby** because the job is chunked to the 60 s limit and the cron is once a day. **Pro**
is the comfortable choice: 300 s functions mean 3–5 hops instead of 10+, and Pro crons fire on the minute (Hobby
crons can fire anywhere within the hour, still well before midnight ET).

**Cost.** Blob: ~500 gzipped day files of ~150 KB plus snapshots, ~90 MB total; a normal night is ~6 writes and
~140 reads. Functions: 1–3 invocations of ≤60 s per night after the backfill. Page views are static. Polygon's Basic
plan and the TradingView scanner cost nothing; Polygon Starter is $29/month if you want unlimited request rate.

---

## Data sources, and why

The brief listed Stooq and Yahoo as the free candidates and said to verify them before building. I did, from inside
the Vercel region (`/api/probe`), and both failed:

| Source | From Vercel (iad1) | Verdict |
| --- | --- | --- |
| Yahoo Finance chart endpoint (query1 and query2, with and without cookie/crumb) | HTTP 429 on the very first request | Yahoo throttles cloud IP ranges; unusable from a server |
| Stooq CSV | HTTP 200 but the body is a JavaScript proof-of-work challenge page, not CSV | anti-bot wall; unusable from a server |
| TradingView scanner | 200, 10,316 US symbols with industry, plus the S&P 500 symbol set (503) | **works** |
| Nasdaq Trader symbol directory | 200 | works (fallback universe, no industries) |
| Polygon.io grouped daily | needs an API key | **chosen for bars** |

| Need | Chosen | Why | Fallback |
| --- | --- | --- | --- |
| Universe + industry classification | **TradingView public scanner** (`POST scanner.tradingview.com/america/scan`) | The only free source with the industry field, plus type/subtype to drop warrants, rights, units and preferreds, and S&P 500 membership via its index symbol set. One request returns the whole US universe. | **Nasdaq Trader** symbol directory (no industries; the previous run's industry map is reused so the industry table survives a scanner outage) |
| Daily OHLCV | **Polygon.io grouped daily** (`/v2/aggs/grouped/locale/us/market/stocks/{date}?adjusted=true`) | One request returns every US ticker's bar for a date, so the nightly job is a single call and there is no per-symbol rate-limit problem at all. Split-adjusted, includes ETFs, excludes OTC. The free Basic plan (5 requests/minute, 2 years of history) is sufficient. | Polygon Starter ($29/month) for an unthrottled backfill; the same code path |

Closes are **split-adjusted but not dividend-adjusted**, matching a TradingView chart, which is what the golden
dataset was computed from. Each series is cross-checked against the scanner's close and rejected if it differs by
more than 2.5% (the count is shown in the page header).

### Verify the sources yourself, first

```
npm install
POLYGON_API_KEY=... npm run probe
```

This hits the scanner, prints the universe size, the industry sample and the scanner rows for MATX / SNDK / VLO, then
fetches the three most recent grouped-daily dates from Polygon and prints SPY / SSO / UPRO / MATX / BRK.B / BWET
closes so you can check them against a chart. Deployed, `/api/probe?key=<CRON_SECRET>` does the same from Vercel.

> **Honest note.** The sandbox used to write this code blocks all four market-data hosts, so nothing was exercised
> end to end there. The source probing above was done against the real deployment; the Polygon path was written from
> its documented response shape and gets its first real exercise on the first backfill. Everything downstream of the
> fetchers is covered by tests.

---

## The math (as specified, with three notes)

Implemented in `lib/metrics/score.ts` and `lib/metrics/indicators.ts`, exactly as written in the brief:

- Windows 21 / 63 / 126 / 252 bars; 12m is the headline window.
- `k = R_asset / R_spy` only when `R_spy > 0.0001`, else null. SPY's return is taken over the same calendar span
  (located by date), so a missing bar on the asset side does not shift the reference.
- `downVol = sqrt(mean(r² for r < 0)) · sqrt(252)`, negative days only. `m = downVol_asset / downVol_spy`. `RRR = k/m`.
- `momValue = ema((close − midAll)/atr(20), 3)` with `midAll = ((highest(high,20)+lowest(low,20))/2 + ema(close,20))/2`,
  ATR as Wilder RMA seeded with an SMA, EMAs SMA-seeded (Pine conventions). `momDays` = bars in the last 126 with
  `momValue > 1`.
- GMMA: EMA 3/5/8/10/12/15 vs 30/35/40/45/50/60; aligned when `min(short) > max(long)`; separation
  `(mean(short)/mean(long) − 1) · 100`.
- Squeeze: `(stdev(close,21)·1.8·2) / (atr(21)·1.6·2) < 1`, population stdev.
- Max drawdown on closes over the window; dollar volume `mean(close·volume)` over 20 bars.
- Wrappers (leveraged, inverse, option-income, buffer, target-date, VIX) classified by fund-name keywords in
  `lib/metrics/wrappers.ts`, scored but excluded from the ranked list, shown in their own section with the live
  "wrapper tax" comparison.
- Industry table: stocks only, grouped by scanner industry, `n ≥ INDUSTRY_MIN_N`, sorted by mean k/m, share-green bar
  scaled to the best industry and labelled as such.

Three places where the brief and the golden dataset disagree, and what the code does:

1. **The `k` cap.** The brief says `k = min(k, 12)`, but the golden file has `k = 181.93` for BWET and `140.92` for
   SNDK at 12m, so the cap was not applied on the long window in the reference run. The code applies the cap only to
   the 1m and 3m windows (`K_CAP_MAX_WINDOW = 63`), which is what the brief's own comment ("short windows blow up when
   SPY is near flat") describes. Change one constant in `lib/config.ts` if you want it everywhere.
2. **The synthetic-leverage check.** `DD_synth = (k − 1) · downVol_spy` with `k` = the *measured return multiple*
   (1.80 for SSO) gives 0.80× SPY's downside, which is 18% away from SSO's real added downside — it cannot be the
   check that matched "to within 1.3%". With `k` = the *stated leverage* it is exact by construction: a daily-rebalanced
   L× series has exactly L× the downside vol (same down days, scaled). So the suite builds the synthetic 2× and 3×
   series from SPY's own daily returns and requires their downside vol to be within 3% of SSO's and UPRO's measured
   downside vol. That is the test the golden run (m = 1.998 and 3.008) passes.
3. **Industry minimum.** The brief says `n ≥ 8`; `ind.txt` includes industries down to `n = 5`. Default is 8 per the
   brief (`INDUSTRY_MIN_N`), and the golden check compares only the rows with `n ≥ 8`.

Two further judgement calls: the **"verify" flag** fires on any of single-day move > 50%, 12m return > 1,000%, or
k > 20 (the golden file's `verify` column corresponds to the k > 20 rule, the other two are from the brief), and the
flag's tooltip on the page says which. The **"Which lookback" forward test** in the original page used 20 monthly
observations on S&P 500 members; with a 520-bar store it uses as many non-overlapping months as the history allows
(about 10–12) and says so in its heading, using S&P 500 membership from the scanner (or the 500 largest stocks by
market cap, labelled, if membership is unavailable). The rank-correlation table is recomputed across the whole
universe every run.

---

## Verification

Everything below runs inside every cron job; a blocking failure aborts the publish and leaves the previous snapshot
live. The results are also shown on the page.

| Check | Rule | Blocking |
| --- | --- | --- |
| SPY against itself | `k`, `m`, `k/m` all equal 1.000000 (to 6 decimals) | yes |
| Synthetic 2× vs SSO, 3× vs UPRO | synthetic downside vol within 3% of the real ETF's | yes |
| Row count guard | universe shrank by more than 15% vs the previous snapshot → data-source failure | yes |
| Minimum universe | at least 500 scored names | yes |
| Sanity bounds | names with a > 50% day, > 1,000% 12m, or k > 20 are flagged on the page, not dropped | info |
| Bar freshness | newest SPY bar is ≤ 5 calendar days old | info |

**Unit tests** (`npm test`, 16 tests): EMA/RMA/ATR against hand-computed values, population stdev, ranks and
Spearman, downside vol counting only negative days, drawdown, the SPY identity, the synthetic-leverage check against
simulated 2× and 3× daily-rebalanced series, the k cap on short windows only, wrapper classification on real fund
names, a full `build()` on a synthetic 520-name universe (tier counts add up, list ⊆ green, industry shares
consistent, chart path ends on the 12m return), the row-count guard, and the day-file pivot. All pass.

**Golden dataset** (`npm run test:golden`): rebuilds the snapshot with every series truncated to 2026-09-03 and
compares each row of `golden/green.txt` (14 fields) and `golden/ind.txt` against it, printing every mismatch and a
per-field tally. Because bars are kept for two years, this can be run any time within the retention window:

```
# after the first backfill has completed
STORE=fs POLYGON_API_KEY=... npm run refresh:local            # local backfill into ./.data (once, ~100 min on the free plan)
npx tsx scripts/golden-check.ts --asof 2026-09-03 --tol 0.02   # or with BLOB_READ_WRITE_TOKEN set, against Blob
```

Reference rows to expect: Marine Shipping `26 | 3.96 | 2.63 | 1.52 | 21 | 81`, Oil Refining/Marketing
`10 | 5.62 | 3.23 | 1.80 | 8 | 80`, Computer Peripherals `13 | 15.21 | 5.42 | 2.22 | 5 | 38`, SSO k/m `0.903`, UPRO
`0.866`. **This check has not been run yet** for the reason in the honest note above; it is the first thing to run
after deploying. Expect small differences from (a) the universe filter ($1M vs the reference run's $5M turnover
floor, which changes `n` per industry), (b) the industry minimum, and (c) any difference between Yahoo's and
TradingView's split adjustment on individual names. Differences in k/m on a name whose bars agree would indicate a
real bug.

---

## Running locally

```
npm install
cp .env.example .env.local          # STORE=fs for a disk-backed store under ./.data
npm run dev                          # http://localhost:3000 — shows the setup screen until a snapshot exists
STORE=fs POLYGON_API_KEY=... npm run refresh:local   # full backfill + compute + verify + publish into ./.data
npm test
```

`scripts/seed-blob.ts` uploads a local `./.data` into Blob so the first production run is incremental instead of a
cold backfill.

## Swapping the bar provider

The job only needs one function: `fetchGroupedDaily(isoDate) → { date, rows: { TICKER: [o, h, l, c, v] } } | null`
in `lib/data/polygon.ts`. Any source that can deliver a day's bars for all tickers (Tiingo's IEX end-of-day dump,
a paid Polygon plan, a bulk EOD vendor) drops in there; the day-file store, compute and verification are unchanged.
The universe and industry classification stay on the scanner regardless of the bar provider.

## Configuration

All optional, in `lib/config.ts` / environment: `MIN_DOLLAR_VOLUME_USD` (1,000,000), `MIN_BARS` (260), `MAX_BARS`
(520), `INDUSTRY_MIN_N` (8), `GREEN_LIST_ROWS` (150), `TIME_BUDGET_MS` (45,000 — raise to ~280,000 on Pro),
`MAX_HOPS` (400), `BACKFILL_DAYS` (740), `RETENTION_DAYS` (820), `RATE_LIMIT_WAIT_MS` (12,500).

---

Analysis, not advice. Every figure describes the twelve months that already happened.
