/**
 * Run the whole refresh locally against ./.data (filesystem store), looping until done and waiting out rate limits:
 *   STORE=fs POLYGON_API_KEY=... npx tsx scripts/refresh-local.ts [--force]
 * Useful for the one-time backfill (then upload .data to Blob with scripts/seed-blob.ts) and for debugging.
 */
process.env.STORE = process.env.STORE ?? "fs";
import { runRefresh } from "../lib/job/refresh";

async function main() {
  const force = process.argv.includes("--force");
  const res = await runRefresh({ force, trigger: "local", untilDone: true, budgetMs: 1e9, log: (m) => console.log(m) });
  console.log(`\nphase: ${res.job.phase}${res.job.lastError ? `\nerror: ${res.job.lastError}` : ""}`);
  process.exit(res.job.phase === "done" || res.job.phase === "skipped" ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
