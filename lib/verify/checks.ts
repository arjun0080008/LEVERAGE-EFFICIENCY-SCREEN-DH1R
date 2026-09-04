import { CONFIG } from "@/lib/config";
import { syntheticDownsideVol, type SpyRef } from "@/lib/metrics/score";
import type { Check, Snapshot, SyntheticCheck } from "@/lib/snapshot";
import type { Scored } from "@/lib/types";

export interface VerifyInput {
  scored: Map<string, Scored>;
  spy: SpyRef;
  universeTotal: number;
  prevTotal: number | null;
  lastBar: number;
  todayNY: number;
}

export function synthetic(sym: string, leverage: number, scored: Map<string, Scored>, spy: SpyRef): SyntheticCheck | null {
  const s = scored.get(sym);
  if (!s) return null;
  const end = spy.bars.t.length - 1;
  const synth = syntheticDownsideVol(spy, end, CONFIG.WINDOWS.w12, leverage);
  const err = synth > 0 ? Math.abs(s.w12.dv / synth - 1) : NaN;
  return { sym, leverage, synthetic: synth, measured: s.w12.dv, err, pass: Number.isFinite(err) && err <= CONFIG.LEVERAGE_TOL };
}

const f6 = (x: number | null) => (x === null ? "null" : x.toFixed(6));

/** The verification suite. Blocking failures abort the publish. */
export function runChecks(input: VerifyInput): { checks: Check[]; synthetic: SyntheticCheck[]; pass: boolean } {
  const checks: Check[] = [];
  const spy = input.scored.get("SPY");

  // 1. SPY against itself
  if (!spy) {
    checks.push({ name: "SPY against itself", pass: false, blocking: true, detail: "SPY missing from scored set" });
  } else {
    const ok = [spy.w12.k, spy.w12.m, spy.w12.rrr].every((x) => x !== null && Math.abs(x - 1) < 5e-7);
    checks.push({ name: "SPY against itself", pass: ok, blocking: true, detail: `k=${f6(spy.w12.k)} m=${f6(spy.w12.m)} k/m=${f6(spy.w12.rrr)} (must be 1.000000)` });
  }

  // 2. Synthetic vs real leverage
  const syn: SyntheticCheck[] = [];
  for (const [sym, L] of [["SSO", 2], ["UPRO", 3]] as const) {
    const c = synthetic(sym, L, input.scored, input.spy);
    if (!c) {
      checks.push({ name: `Synthetic ${L}× vs ${sym}`, pass: false, blocking: true, detail: `${sym} not scored` });
      continue;
    }
    syn.push(c);
    checks.push({
      name: `Synthetic ${L}× vs ${sym}`,
      pass: c.pass,
      blocking: true,
      detail: `synthetic downside vol ${(c.synthetic * 100).toFixed(2)}% vs measured ${(c.measured * 100).toFixed(2)}% — off by ${(c.err * 100).toFixed(2)}% (limit ${CONFIG.LEVERAGE_TOL * 100}%)`,
    });
  }

  // 3. Sanity bounds (informational: flagged rows are shown, not dropped)
  const flagged = [...input.scored.values()].filter((s) => s.verify.length > 0);
  checks.push({ name: "Sanity bounds", pass: true, blocking: false, detail: `${flagged.length} names flagged for verification (single day > ${CONFIG.VERIFY_MAX_DAY * 100}%, 12m > ${CONFIG.VERIFY_MAX_R12 * 100}%, or k > ${CONFIG.VERIFY_MAX_K})` });

  // 4. Row count guard
  if (input.prevTotal !== null && input.prevTotal > 0) {
    const drop = 1 - input.universeTotal / input.prevTotal;
    checks.push({ name: "Row count guard", pass: drop <= CONFIG.ROW_COUNT_GUARD, blocking: true, detail: `${input.universeTotal} names vs ${input.prevTotal} last run (${drop >= 0 ? "-" : "+"}${(Math.abs(drop) * 100).toFixed(1)}%, limit ${CONFIG.ROW_COUNT_GUARD * 100}%)` });
  } else {
    checks.push({ name: "Row count guard", pass: true, blocking: false, detail: `${input.universeTotal} names; no previous snapshot to compare` });
  }

  // 5. Minimum universe
  checks.push({ name: "Minimum universe", pass: input.universeTotal >= 500, blocking: true, detail: `${input.universeTotal} scored names (need at least 500)` });

  // 6. Freshness of the SPY bar
  const age = Math.round((Date.UTC(Math.floor(input.todayNY / 10000), Math.floor((input.todayNY % 10000) / 100) - 1, input.todayNY % 100) - Date.UTC(Math.floor(input.lastBar / 10000), Math.floor((input.lastBar % 10000) / 100) - 1, input.lastBar % 100)) / 86_400_000);
  checks.push({ name: "Bar freshness", pass: age <= 5, blocking: false, detail: `last SPY bar ${input.lastBar} is ${age} calendar day(s) old` });

  return { checks, synthetic: syn, pass: checks.every((c) => c.pass || !c.blocking) };
}

export function summarise(s: Snapshot): string {
  return `${s.asOfIso}: ${s.universe.total} names, ${s.totals.green} green, ${s.totals.listGreen} on the list`;
}
