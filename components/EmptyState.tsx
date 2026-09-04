import type { Status } from "@/lib/snapshot";

export function EmptyState({ status }: { status: Status | null }) {
  return (
    <main className="wrap">
      <div className="empty">
        <p className="eyebrow">Leverage-efficiency screen<span>·</span>No snapshot yet</p>
        <h1>Nothing to show until the first refresh has run.</h1>
        <p className="deck">This page renders only from a verified data snapshot. No numbers are ever hardcoded, so until the daily job has fetched bars and passed its checks, there is nothing here.</p>
        {status && (
          <p className={`banner ${status.result === "failed" ? "bad" : ""}`}>
            <span>Last run ({status.lastRunAtNY}): {status.result} — {status.message}</span>
          </p>
        )}
        <ol>
          <li>Attach a Vercel Blob store to the project and set <code>CRON_SECRET</code>.</li>
          <li>Kick off the first backfill (it chains itself across invocations until done):</li>
        </ol>
        <pre>curl -H &quot;Authorization: Bearer $CRON_SECRET&quot; https://&lt;your-app&gt;.vercel.app/api/cron/refresh</pre>
        <ol start={3}>
          <li>Watch progress at <code>/api/health</code>. The page fills in the moment the snapshot passes verification.</li>
        </ol>
      </div>
    </main>
  );
}
