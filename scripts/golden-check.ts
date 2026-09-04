/**
 * Golden-dataset check: rebuild the snapshot with all series truncated to a historical close and compare
 * against golden/green.txt and golden/ind.txt (the verified output for 2026-09-03).
 *
 *   STORE=fs npx tsx scripts/golden-check.ts [--asof 2026-09-03] [--tol 0.02]
 *   (or with BLOB_READ_WRITE_TOKEN set, reads the shards from Vercel Blob)
 *
 * Requires bars in the store that reach back at least 253 bars before the golden date.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { build } from "../lib/job/build";
import type { ShardDoc, UniverseDoc } from "../lib/job/refresh";
import { getJson, KEYS } from "../lib/store";
import type { Bars } from "../lib/types";
import { ymdFromIso } from "../lib/data/dates";
import { CONFIG } from "../lib/config";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};

interface GoldenGreen { tkr: string; etf: boolean; industry: string; r12: number; k: number; m: number; rrr: number; dv: number; mdd: number; r6: number; rrr6: number; r3: number; mom: number; momDays: number; gmma: number; gSep: number; adv: number; verify: number }

async function main() {
  const asOfIso = arg("--asof", "2026-09-03");
  const tol = Number(arg("--tol", "0.02"));
  const asOf = ymdFromIso(asOfIso);
  const gtxt = await fs.readFile(path.join(process.cwd(), "golden/green.txt"), "utf8");
  const itxt = await fs.readFile(path.join(process.cwd(), "golden/ind.txt"), "utf8");
  const golden: GoldenGreen[] = gtxt.trim().split("\n").map((l) => {
    const f = l.split("|");
    return { tkr: f[0], etf: f[1] === "ETF", industry: f[3], r12: +f[4], k: +f[5], m: +f[6], rrr: +f[7], dv: +f[8], mdd: +f[9], r6: +f[10], rrr6: +f[11], r3: +f[12], mom: +f[13], momDays: +f[14], gmma: +f[15], gSep: +f[16], adv: +f[17], verify: +f[18] };
  });
  const goldenInd = itxt.trim().split("\n").map((l) => { const f = l.split("|"); return { industry: f[0], n: +f[1], meanK: +f[2], meanM: +f[3], meanRRR: +f[4], green: +f[5], pct: +f[6] }; });

  const universe = await getJson<UniverseDoc>(KEYS.universe);
  if (!universe) throw new Error("no universe in the store; run the refresh first");
  const bars = new Map<string, Bars>();
  const shards = Math.ceil(universe.rows.length / CONFIG.SHARD_SIZE);
  for (let i = 0; i < shards; i++) {
    const s = await getJson<ShardDoc>(KEYS.shard(i));
    if (s) for (const [k, v] of Object.entries(s)) bars.set(k, v);
  }
  const spy = bars.get("SPY");
  if (!spy || !spy.t.includes(asOf)) throw new Error(`SPY has no bar on ${asOfIso}; stored range ${spy?.t[0]}–${spy?.t[spy.t.length - 1]}`);
  const { snapshot, scored } = build({ universe: universe.rows, universeSource: universe.source, scanned: universe.scanned, bars, fetchFailed: 0, provider: "store", prevTotal: null, todayNY: asOf, asOf });
  const by = new Map(scored.map((s) => [s.sym, s]));

  console.log(`rebuilt ${asOfIso}: ${snapshot.universe.total} names, ${snapshot.totals.green} green, ${snapshot.totals.listGreen} list-green (golden list has ${golden.length} rows shown of its total)`);
  const sso = snapshot.bench.find((b) => b.sym === "SSO");
  console.log(`SSO k/m ${sso?.rrr?.toFixed(3)} (golden 0.903)  UPRO k/m ${snapshot.uproRRR?.toFixed(3)} (golden 0.866)`);

  let ok = 0, miss = 0, bad = 0;
  const fields: Array<[string, (g: GoldenGreen) => number, (s: NonNullable<ReturnType<typeof by.get>>) => number | null, number]> = [
    ["r12%", (g) => g.r12, (s) => s.w12.r * 100, 1],
    ["k", (g) => g.k, (s) => s.w12.k, 0],
    ["m", (g) => g.m, (s) => s.w12.m, 0],
    ["k/m", (g) => g.rrr, (s) => s.w12.rrr, 0],
    ["dv%", (g) => g.dv, (s) => s.w12.dv * 100, 1],
    ["mdd%", (g) => g.mdd, (s) => s.w12.mdd * 100, 1],
    ["r6%", (g) => g.r6, (s) => s.w6.r * 100, 1],
    ["k/m6", (g) => g.rrr6, (s) => s.w6.rrr, 0],
    ["r3%", (g) => g.r3, (s) => s.w3.r * 100, 1],
    ["mom", (g) => g.mom, (s) => s.mom, 0],
    ["momDays", (g) => g.momDays, (s) => s.momDays, 0],
    ["gmma", (g) => g.gmma, (s) => (s.gAligned === null ? null : s.gAligned ? 1 : 0), 0],
    ["gSep", (g) => g.gSep, (s) => s.gSep, 0],
    ["$M/d", (g) => g.adv, (s) => s.dollarVol / 1e6, 5],
  ];
  const fieldBad = new Map<string, number>();
  for (const g of golden) {
    const s = by.get(g.tkr);
    if (!s) { miss++; console.log(`  ${g.tkr}: not scored (not in universe, too few bars, or filtered)`); continue; }
    const diffs: string[] = [];
    for (const [name, gv, sv, absTol] of fields) {
      const a = gv(g), b = sv(s);
      if (b === null || !Number.isFinite(b)) { diffs.push(`${name} null`); continue; }
      const t = Math.max(absTol, Math.abs(a) * tol, name === "$M/d" ? Math.abs(a) * 0.1 : 0.015);
      if (Math.abs(a - b) > t) { diffs.push(`${name} ${a} vs ${b.toFixed(2)}`); fieldBad.set(name, (fieldBad.get(name) ?? 0) + 1); }
    }
    if (diffs.length) { bad++; console.log(`  ${g.tkr}: ${diffs.join(", ")}`); } else ok++;
  }
  console.log(`\ngreen.txt: ${ok} match, ${bad} differ, ${miss} missing (tolerance ${tol * 100}% relative)`);
  if (fieldBad.size) console.log("  mismatches by field:", [...fieldBad.entries()].map(([k, v]) => `${k}=${v}`).join(", "));

  let iok = 0, ibad = 0, imiss = 0;
  for (const g of goldenInd) {
    if (g.n < CONFIG.INDUSTRY_MIN_N) continue;
    const s = snapshot.industries.find((i) => i.industry === g.industry);
    if (!s) { imiss++; console.log(`  ${g.industry}: missing`); continue; }
    const d: string[] = [];
    if (s.n !== g.n) d.push(`n ${g.n} vs ${s.n}`);
    if (Math.abs(s.meanK - g.meanK) > Math.max(0.02, g.meanK * tol)) d.push(`meanK ${g.meanK} vs ${s.meanK.toFixed(2)}`);
    if (Math.abs(s.meanM - g.meanM) > Math.max(0.02, g.meanM * tol)) d.push(`meanM ${g.meanM} vs ${s.meanM.toFixed(2)}`);
    if (Math.abs(s.meanRRR - g.meanRRR) > Math.max(0.02, Math.abs(g.meanRRR) * tol)) d.push(`meanRRR ${g.meanRRR} vs ${s.meanRRR.toFixed(2)}`);
    if (s.green !== g.green) d.push(`green ${g.green} vs ${s.green}`);
    if (d.length) { ibad++; console.log(`  ${g.industry}: ${d.join(", ")}`); } else iok++;
  }
  console.log(`ind.txt (rows with n >= ${CONFIG.INDUSTRY_MIN_N}): ${iok} match, ${ibad} differ, ${imiss} missing`);
  process.exit(bad + miss + ibad + imiss === 0 ? 0 : 2);
}
main().catch((e) => { console.error(e); process.exit(1); });
