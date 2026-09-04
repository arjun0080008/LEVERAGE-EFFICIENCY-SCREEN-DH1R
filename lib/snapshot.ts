import type { IndustryRow } from "@/lib/metrics/industry";
import type { LookbackStudy, MetricCorrRow } from "@/lib/metrics/study";

export interface BenchRow {
  sym: string;
  label: string;
  leverage: number;
  r12: number;
  dv: number;
  k: number | null;
  m: number | null;
  rrr: number | null;
  r6: number;
  rrr6: number | null;
}

export interface SyntheticCheck {
  sym: string;
  leverage: number;
  /** downside vol of a synthetic leverage× daily-rebalanced SPY */
  synthetic: number;
  measured: number;
  /** relative error, fraction */
  err: number;
  pass: boolean;
}

export interface GreenRow {
  t: string;
  etf: boolean;
  d: string;
  ind: string;
  r12: number;
  k: number;
  m: number;
  rrr: number;
  dv: number;
  mdd: number;
  r6: number;
  rrr6: number | null;
  r3: number;
  mom: number | null;
  momDays: number | null;
  gA: boolean | null;
  gSep: number | null;
  sq: boolean | null;
  /** $M/day */
  adv: number;
  vf: string[];
  maxDay: number;
}

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
  blocking: boolean;
}

export interface Snapshot {
  version: 1;
  asOf: number;
  asOfIso: string;
  generatedAt: string;
  generatedAtNY: string;
  provider: string;
  universeSource: string;
  universe: {
    scanned: number;
    walked: number;
    total: number;
    stocks: number;
    etfs: number;
    lackedHistory: number;
    lowLiquidity: number;
    fetchFailed: number;
    mismatchRejected: number;
    verifiedClose: number;
    minDollarVolume: number;
    minBars: number;
    barsCalendar: number;
    prevTotal: number | null;
  };
  bench: BenchRow[];
  synthetic: SyntheticCheck[];
  ssoRRR: number | null;
  uproRRR: number | null;
  totals: {
    beat: number;
    beatPct: number;
    green: number;
    amber: number;
    red: number;
    listGreen: number;
    listGreenStocks: number;
    listGreenEtfs: number;
  };
  industries: IndustryRow[];
  industryMinN: number;
  spotlight: {
    industry: string;
    n: number;
    meanK: number;
    meanM: number;
    meanRRR: number;
    green: number;
    pct: number;
    rank: number;
    of: number;
    minN: number;
    leaders: Array<{ t: string; rrr: number }>;
    above: Array<{ industry: string; meanRRR: number; meanK: number; meanM: number; green: number; n: number; pct: number; leaders: string[] }>;
    topOverall: { t: string; d: string; r12: number; maxDay: number; etf: boolean; ind: string } | null;
  } | null;
  green: GreenRow[];
  greenTotal: number;
  wrappers: {
    count: number;
    byCategory: Array<{ category: string; n: number; green12: number; meanRRR: number }>;
    themeCount: number;
    avgD1Wrapper: number;
    avgD1Theme: number;
    upShare: number;
    green12: number;
    meanRRR: number;
    themeMeanRRR: number;
  };
  metricCorr: MetricCorrRow[];
  metricN: number;
  lookback: LookbackStudy | null;
  path: { t: number[]; spy: number[]; sso: number[]; upro: number[] };
  checks: Check[];
  flaggedExamples: Array<{ t: string; reason: string }>;
}

export interface Status {
  lastRunAt: string;
  lastRunAtNY: string;
  result: "published" | "failed" | "skipped" | "running";
  message: string;
  asOf: number | null;
  jobId: string | null;
  checks: Check[];
  hops: number;
}
