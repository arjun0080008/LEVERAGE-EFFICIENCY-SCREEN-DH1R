const num = (k: string, d: number): number => {
  const v = process.env[k];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};

export const CONFIG = {
  /** windows in trading bars */
  WINDOWS: { w1: 21, w3: 63, w6: 126, w12: 252 } as const,
  /** k is capped only on the short windows, where a near-flat SPY denominator blows up */
  K_CAP: 12,
  K_CAP_MAX_WINDOW: 63,
  /** flag thresholds for the "verify" column */
  VERIFY_MAX_DAY: 0.5,
  VERIFY_MAX_R12: 10,
  VERIFY_MAX_K: 20,
  MIN_DOLLAR_VOLUME_USD: num("MIN_DOLLAR_VOLUME_USD", 1_000_000),
  MIN_BARS: num("MIN_BARS", 260),
  MAX_BARS: num("MAX_BARS", 520),
  INDUSTRY_MIN_N: num("INDUSTRY_MIN_N", 8),
  SPOTLIGHT_MIN_N: 10,
  GREEN_LIST_ROWS: num("GREEN_LIST_ROWS", 150),
  /** scanner close vs fetched close tolerance */
  CLOSE_MISMATCH_TOL: 0.025,
  /** synthetic-leverage tolerance for the verification suite */
  LEVERAGE_TOL: 0.03,
  /** universe shrink that is treated as a data-source failure */
  ROW_COUNT_GUARD: 0.15,
  /** fetch orchestration */
  TIME_BUDGET_MS: num("TIME_BUDGET_MS", 45_000),
  MAX_HOPS: num("MAX_HOPS", 400),
  /** calendar days of history to backfill (≈ 2 years, the free Polygon plan's limit) */
  BACKFILL_DAYS: num("BACKFILL_DAYS", 740),
  /** day files whose newest date is older than this are deleted */
  RETENTION_DAYS: num("RETENTION_DAYS", 820),
  /** pause after a 429 from Polygon (free plan: 5 requests per minute) */
  RATE_LIMIT_WAIT_MS: num("RATE_LIMIT_WAIT_MS", 12_500),
  /** parallel day-file downloads in the compute phase */
  LOAD_CONCURRENCY: num("LOAD_CONCURRENCY", 12),
  /** page shows a stale warning when the newest bar is older than this many calendar days */
  STALE_AFTER_DAYS: 4,
  BENCHMARKS: ["SPY", "SSO", "UPRO"] as const,
};
