"use client";
import { useMemo, useState } from "react";
import type { GreenRow, Snapshot, Status } from "@/lib/snapshot";
import { benchNote, deck, f, headline, lookbackVerdicts, metricVerdict, n0, ordinal, pct, pctPlain, staleNote, times, words } from "@/lib/prose";
import { formatLong } from "@/lib/data/dates";
import { BenchChart, CountUp, Reveal, Scatter, Spark, ThemeToggle, Words, type ScatterPt } from "./ui";

type ISort = "meanRRR" | "meanK" | "pct" | "n";
type GSort = "rrr" | "r12" | "momDays" | "mdd" | "adv" | "k";
type GF = "all" | "stock" | "etf";

const rrrCls = (v: number | null, sso: number | null) => (v === null ? "f" : v > 1 ? "g" : sso !== null && v > sso ? "a" : "r");
const cnt = (v: number) => n0(v);

function ageDays(asOf: number): number {
  const d = new Date(Date.UTC(Math.floor(asOf / 10000), Math.floor((asOf % 10000) / 100) - 1, asOf % 100));
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

export function Dashboard({ s, status }: { s: Snapshot; status: Status | null }) {
  const [isort, setIsort] = useState<ISort>("meanRRR");
  const [idir, setIdir] = useState(-1);
  const [gs, setGs] = useState<GSort>("rrr");
  const [gd, setGd] = useState(-1);
  const [gf, setGf] = useState<GF>("all");

  const age = ageDays(s.asOf);
  const failed = status?.result === "failed";
  const stale = age > 4 || failed;
  const spy = s.bench.find((b) => b.sym === "SPY");
  const sso = s.bench.find((b) => b.sym === "SSO");
  const upro = s.bench.find((b) => b.sym === "UPRO");

  const inds = useMemo(() => s.industries.slice().sort((a, b) => (a[isort] - b[isort]) * idir), [s.industries, isort, idir]);
  const maxPct = Math.max(1, ...s.industries.map((i) => i.pct));
  const greens = useMemo(() => {
    let v = s.green.slice();
    if (gf === "stock") v = v.filter((x) => !x.etf);
    if (gf === "etf") v = v.filter((x) => x.etf);
    v.sort((a, b) => {
      const A = a[gs] as number | null, B = b[gs] as number | null;
      if (A === null || A === undefined) return 1;
      if (B === null || B === undefined) return -1;
      return (A - B) * gd;
    });
    return v;
  }, [s.green, gs, gd, gf]);

  const scatter: ScatterPt[] = useMemo(() => {
    const pts: ScatterPt[] = s.green.map((g) => ({ t: g.t, k: g.k, m: g.m, rrr: g.rrr, etf: g.etf }));
    for (const b of s.bench) if (b.k !== null && b.m !== null && b.rrr !== null) pts.push({ t: b.sym, k: b.k, m: b.m, rrr: b.rrr, etf: true, ref: true });
    return pts;
  }, [s.green, s.bench]);

  const clickI = (k: ISort) => { if (isort === k) setIdir(-idir); else { setIsort(k); setIdir(-1); } };
  const clickG = (k: GSort) => { if (gs === k) setGd(-gd); else { setGs(k); setGd(k === "mdd" ? 1 : -1); } };

  const lb = s.lookback;
  const verdicts = lb ? lookbackVerdicts(lb.rows) : [];
  const sp = s.spotlight;
  const wr = s.wrappers;
  const upDay = Number.isFinite(wr.upShare) ? wr.upShare : 0;
  const wrapperTax = Number.isFinite(wr.avgD1Wrapper) && Number.isFinite(wr.avgD1Theme);
  const mc = s.metricCorr;
  const bestVsRRR = mc.length ? mc.reduce((a, b) => (b.vsRRR > a.vsRRR ? b : a)) : null;
  const bestVs3 = mc.length ? mc.reduce((a, b) => (b.vs3 > a.vs3 ? b : a)) : null;

  return (
    <>
      <header className="top">
        <div className="in">
          <div className="brand">
            <span className="mark" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12l4-5 3 3 5-7" /></svg></span>
            Return Per Unit of Downside
          </div>
          <div className="meta">
            <span><i className={`dot ${failed ? "bad" : stale ? "warn" : ""}`} />Data as of <b className="tnum">{formatLong(s.asOf)}</b></span>
            <span>Last updated <b className="tnum">{s.generatedAtNY}</b></span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="wrap">
        {stale && (
          <div className={`banner ${failed ? "bad" : ""}`} role="status">
            <span aria-hidden="true">⚠</span>
            <span>
              <b>{failed ? "The last refresh failed verification." : "This snapshot is stale."}</b> {staleNote(age)}
              {status?.message ? ` Last run (${status.lastRunAtNY}): ${status.message}` : ""}
            </span>
          </div>
        )}

        <section className="hero">
          <p className="eyebrow">Leverage-efficiency screen<span>·</span>{cnt(s.universe.total)} US stocks and ETFs<span>·</span>12 months to {formatLong(s.asOf)}<span>·</span>Recomputed nightly</p>
          <h1><Words text={headline(s)} /></h1>
          <p className="deck">{deck(s)}</p>
          <p className="meta-lines">
            Universe: {cnt(s.universe.stocks)} US stocks and {cnt(s.universe.etfs)} ETFs above ${n0(s.universe.minDollarVolume / 1e6)}M average daily turnover, from {cnt(s.universe.walked)} walked charts · {cnt(s.universe.lackedHistory)} lacked history · {cnt(s.universe.lowLiquidity)} too illiquid{s.universe.fetchFailed ? ` · ${cnt(s.universe.fetchFailed)} fetches failed` : ""}<br />
            {s.universe.verifiedClose ? <>{cnt(s.universe.verifiedClose)} charts verified to within 2.5% of their scanner close before scoring · {cnt(s.universe.mismatchRejected)} symbol mismatch{s.universe.mismatchRejected === 1 ? "" : "es"} rejected<br /></> : null}
            Benchmarks SPY, SSO (2×) and UPRO (3×) aligned to a common {cnt(s.universe.barsCalendar)}-bar calendar · leveraged and option-income wrappers excluded from the ranked list · bars from {s.provider}, classification from {s.universeSource}
          </p>

          <Reveal as="dl" className="kpi">
            <div><dt>Beat SPY on return</dt><dd><CountUp value={s.totals.beat} fmt={cnt} /></dd><p>of {cnt(s.universe.total)} — {pctPlain(s.totals.beatPct)} of the universe.</p><Spark vals={s.path.spy} color="var(--ink)" /></div>
            <div><dt>Beat it efficiently</dt><dd className="g"><CountUp value={s.totals.green} fmt={cnt} /></dd><p>Return per unit of downside above SPY's own.</p></div>
            <div><dt>Would rather own SSO</dt><dd className="r"><CountUp value={s.totals.red} fmt={cnt} /></dd><p>Beat SPY, but less efficiently than 2× leverage.</p></div>
            <div><dt>Green on 6m and 12m</dt><dd className="g"><CountUp value={s.totals.listGreen} fmt={cnt} /></dd><p>{cnt(s.totals.listGreenStocks)} stocks, {cnt(s.totals.listGreenEtfs)} ETFs.</p></div>
            <div><dt>SSO's own efficiency</dt><dd className={s.ssoRRR !== null && s.ssoRRR < 1 ? "r" : "g"}><CountUp value={s.ssoRRR ?? 0} fmt={(v) => f(v, 2)} /></dd><p>{s.ssoRRR !== null && s.ssoRRR < 1 ? "Below 1.00. Leverage destroys ratio." : "At or above 1.00 this window."}</p><Spark vals={s.path.sso} color="var(--amb)" /></div>
          </Reveal>
        </section>

        {/* ---------------- benchmark ---------------- */}
        <section className="sec">
          <div className="h2row"><h2>The benchmark that matters</h2><span>Return multiple vs risk multiple</span></div>
          <p className="lead">The question is whether a stock returning 2× SPY is more volatile than the 2× SPY ETF. That turns into two numbers per asset: <b>k</b>, its return as a multiple of SPY's, and <b>m</b>, its downside volatility as a multiple of SPY's. Their ratio <b>k/m</b> is return per unit of added downside. SPY scores exactly 1.00 by construction. Here is what the leveraged ETFs actually delivered.</p>
          <Reveal className="card bench scroll">
            <table>
              <thead><tr><th className="l">Asset</th><th>12m return</th><th>Downside vol</th><th>k — return multiple</th><th>m — risk multiple</th><th>k/m</th><th className="l">Reading</th></tr></thead>
              <tbody>
                {s.bench.map((b) => (
                  <tr key={b.sym}>
                    <td className="l"><b>{b.sym}</b>{b.leverage > 1 ? ` — ${b.leverage}× SPY` : ""}</td>
                    <td className="num">{pct(b.r12, 1)}</td>
                    <td className="num">{pctPlain(b.dv, 1)}</td>
                    <td className={`num ${b.leverage > 1 ? rrrCls(b.k, null) === "g" ? "" : "r" : ""}`}>{f(b.k, 3)}</td>
                    <td className="num">{f(b.m, 3)}</td>
                    <td className={`num ${b.leverage > 1 ? rrrCls(b.rrr, s.ssoRRR) : ""}`}><b>{f(b.rrr, 3)}</b></td>
                    <td className="l f">{b.leverage === 1 ? "The reference." : `Took the full ${b.leverage}× risk. Delivered ${times(b.k, 2)} the return.`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Reveal>
          <Reveal className="card"><BenchChart path={s.path} /></Reveal>
          <p className="notes"><b>The risk multiples are exact and the return multiples are not.</b> {benchNote(s)}</p>
        </section>

        {/* ---------------- traffic light ---------------- */}
        <section className="sec">
          <div className="h2row"><h2>The traffic light</h2><span>Applied to the {cnt(s.totals.beat)} that beat SPY</span></div>
          <Reveal className="tiers">
            <div className="g"><p className="lab">Green — take the stock</p><p className="big"><CountUp value={s.totals.green} fmt={cnt} /></p>
              <p className="rule">k &gt; 1 and k/m &gt; 1.00</p>
              <p>Beat SPY on return <i>and</i> earned more per unit of added downside than SPY itself. No amount of leverage on the index reproduces this — leverage can only move you down the ratio.</p></div>
            <div className="a"><p className="lab">Amber — better than SSO, worse than SPY</p><p className="big"><CountUp value={s.totals.amber} fmt={cnt} /></p>
              <p className="rule">{f(s.ssoRRR, 3)} &lt; k/m ≤ 1.00</p>
              <p>Beat SPY, and beat 2× leverage on efficiency, but still gave up ratio against holding the index outright. Defensible only if you specifically want the higher absolute return.</p></div>
            <div className="r"><p className="lab">Red — buy SSO instead</p><p className="big"><CountUp value={s.totals.red} fmt={cnt} /></p>
              <p className="rule">k/m ≤ {f(s.ssoRRR, 3)}</p>
              <p>Beat SPY on return while delivering less return per unit of downside than simply levering the index 2×. The outperformance was bought with risk, not earned.</p></div>
          </Reveal>
          <Reveal>
            <div className="stack" aria-hidden="true">
              <i className="g" style={{ width: `${(100 * s.totals.green) / Math.max(1, s.totals.beat)}%` }} />
              <i className="a" style={{ width: `${(100 * s.totals.amber) / Math.max(1, s.totals.beat)}%`, transitionDelay: ".3s" }} />
              <i className="r" style={{ width: `${(100 * s.totals.red) / Math.max(1, s.totals.beat)}%`, transitionDelay: ".6s" }} />
            </div>
            <div className="legend">
              <span><i style={{ background: "var(--grn)" }} />Green {pctPlain(s.totals.green / Math.max(1, s.totals.beat))}</span>
              <span><i style={{ background: "var(--amb)" }} />Amber {pctPlain(s.totals.amber / Math.max(1, s.totals.beat))}</span>
              <span><i style={{ background: "var(--red)" }} />Red {pctPlain(s.totals.red / Math.max(1, s.totals.beat))}</span>
              <span className="push">Share of the {cnt(s.totals.beat)} names that beat SPY over 12 months</span>
            </div>
          </Reveal>
          <p className="notes">Downside volatility here counts only days the asset fell — upside movement is never penalised. It is the annualised root-mean-square of negative daily returns over the window, so a name that rises violently and falls gently scores well, which is the behaviour the ordinary standard deviation punishes by mistake.</p>
        </section>

        {/* ---------------- lookback ---------------- */}
        <section className="sec">
          <div className="h2row"><h2>Which lookback</h2><span>{lb ? `${cnt(lb.members)} ${lb.memberLabel} · ${lb.months} non-overlapping months` : "Insufficient history"}</span></div>
          {lb ? (
            <>
              <p className="lead">Do 3 or 6 months beat SPMO's 12-month-skip-1? The {lb.memberLabel} were ranked at {words(lb.months)} monthly dates and each ranking measured against the <i>next</i> month's excess return over SPY. Rank IC, Spearman:</p>
              <Reveal className="card scroll">
                <table>
                  <thead><tr><th className="l">Lookback</th><th>Raw return</th><th>Vol-adjusted (SPMO)</th><th>Excess ÷ downside dev</th><th className="l">Verdict</th></tr></thead>
                  <tbody>
                    {lb.rows.map((r, i) => {
                      const best = Math.max(...lb.rows.map((x) => Math.max(x.raw, x.volAdj, x.downside)));
                      const worst = Math.min(...lb.rows.map((x) => Math.min(x.raw, x.volAdj, x.downside)));
                      const cls = (v: number) => (v === best ? "g" : v === worst ? "r" : "");
                      return (
                        <tr key={r.lookback}>
                          <td className="l"><b>{r.lookback}</b></td>
                          <td className={`num ${cls(r.raw)}`}>{f(r.raw, 3)}</td>
                          <td className={`num ${cls(r.volAdj)}`}>{f(r.volAdj, 3)}</td>
                          <td className={`num ${cls(r.downside)}`}>{r.downside === best ? <b>{f(r.downside, 3)}</b> : f(r.downside, 3)}</td>
                          <td className="l">{verdicts[i]}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Reveal>
              <p className="notes"><b>{lb.bestT < 2 ? "None of this is significant." : "Treat the significance with care."}</b> The best t-statistic in the table is {f(lb.bestT, 2)} and hit rates sit at {pctPlain(lb.hitLow)}–{pctPlain(lb.hitHigh)}. {words(lb.months).replace(/^./, (c) => c.toUpperCase())} observations cannot separate these five windows, and anyone claiming otherwise from a sample this size is reading noise. What the table does support, weakly: {(() => {
                const twelve = lb.rows.find((r) => r.lookback === "12 months");
                const skip = lb.rows.find((r) => r.lookback === "12m skip 1m");
                const skipHelps = twelve && skip && skip.downside > twelve.downside;
                const longRows = lb.rows.filter((r) => r.bars >= 126);
                const downBeats = longRows.every((r) => r.downside >= r.volAdj);
                return `${skipHelps ? "the skip-month is helping this run" : "the skip-month is not helping"}, and dividing by downside deviation ${downBeats ? "beats" : "does not consistently beat"} dividing by full volatility at the longer lookbacks.`;
              })()}</p>
            </>
          ) : (
            <p className="notes">The forward test needs at least three non-overlapping months after a full 12-month lookback. It appears automatically once the stored history is long enough.</p>
          )}
          <p className="notes"><b>One structural result is exact, not statistical.</b> Ranking on excess-return-over-SPY produces an <i>identical</i> ordering to ranking on raw return — subtracting the same index return from every name is a constant shift. Excess return only does work as a gate, never as a ranking. The Sortino form escapes this precisely because the denominator varies per name.</p>
        </section>

        {/* ---------------- metric correlations ---------------- */}
        <section className="sec">
          <div className="h2row"><h2>What each metric actually measures</h2><span>Rank correlation across {cnt(s.metricN)} names</span></div>
          <p className="lead">momValue was proposed for recent outperformance and GMMA, days-above-1 and z-scores for the long run. Here is what each one correlates with, today.</p>
          <Reveal className="card scroll">
            <table>
              <thead><tr><th className="l">Metric</th><th>vs 3-month excess</th><th>vs 6-month excess</th><th>vs 12-month excess</th><th>vs k/m ratio</th><th className="l">What it is actually good for</th></tr></thead>
              <tbody>
                {mc.map((r) => {
                  const rowMax = Math.max(r.vs3, r.vs6, r.vs12, r.vsRRR);
                  const c = (v: number) => (v === rowMax ? "g" : v < 0.25 ? "f" : "");
                  return (
                    <tr key={r.key}>
                      <td className="l"><b>{r.metric}</b></td>
                      <td className={`num ${c(r.vs3)}`}>{r.vs3 === rowMax ? <b>{f(r.vs3, 3)}</b> : f(r.vs3, 3)}</td>
                      <td className={`num ${c(r.vs6)}`}>{r.vs6 === rowMax ? <b>{f(r.vs6, 3)}</b> : f(r.vs6, 3)}</td>
                      <td className={`num ${c(r.vs12)}`}>{r.vs12 === rowMax ? <b>{f(r.vs12, 3)}</b> : f(r.vs12, 3)}</td>
                      <td className={`num ${c(r.vsRRR)}`}>{r.vsRRR === rowMax ? <b>{f(r.vsRRR, 3)}</b> : f(r.vsRRR, 3)}</td>
                      <td className="l">{metricVerdict(r, mc)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Reveal>
          {mc.length === 4 && bestVsRRR && bestVs3 && (
            <p className="notes">
              <b>momValue</b> reads {f(mc[0].vs3, 3)} against three-month excess return and {f(mc[0].vs12, 3)} at twelve — {mc[0].vs3 > mc[0].vs12 ? "a recent-performance measure" : "holding its relationship across horizons this run"}.
              {" "}<b>Days-with-momValue-above-1</b> is {bestVsRRR.key === "momDays" ? "the single best column here" : "not the strongest column this run"}: {f(mc[1].vs6, 3)} against six-month excess return and {f(mc[1].vsRRR, 3)} against the risk-adjusted ratio itself.
              {" "}<b>GMMA separation</b> reads {f(mc[2].vs3, 3)} against three-month excess and {f(mc[2].vs12, 3)} at twelve months — {bestVs3.key === "gSep" ? "the most precise short-horizon instrument in the set" : "a short-horizon instrument, though not the sharpest today"}.
            </p>
          )}
          <p className="notes">These are contemporaneous correlations — each metric measured now against the return that already happened. They establish what each metric <i>describes</i>, not what it forecasts. The forecasting test is the lookback table above.</p>
        </section>

        {/* ---------------- industries ---------------- */}
        <section className="sec">
          <div className="h2row"><h2>Where the efficient names cluster</h2><span>Stocks only · industries with {s.industryMinN} or more · 12m test</span></div>
          <p className="lead">{sp ? <>{sp.industry} has the highest share of green names among industries with more than {words(sp.minN)} members, and sits {ordinal(sp.rank)} of {words(sp.of)} industries on mean k/m.</> : <>Grouped by scanner industry. Green here is the 12-month test only — deliberately the looser count.</>}</p>
          <div className="ctrl"><span className="lab">Sort</span>
            {([["meanRRR", "k/m"], ["meanK", "Return multiple"], ["pct", "% green"], ["n", "Members"]] as Array<[ISort, string]>).map(([k, l]) => (
              <button key={k} className="chip" aria-pressed={isort === k} onClick={() => clickI(k)}>{l} {isort === k ? (idir < 0 ? "▾" : "▴") : ""}</button>
            ))}
            <span className="push">Share-green bar is scaled to the best industry ({maxPct}%), not to 100%</span>
          </div>
          <Reveal className="card scroll">
            <table>
              <thead><tr><th className="l">Industry</th><th>N</th><th>Mean k</th><th>Mean m</th><th>Mean k/m</th><th>Green</th><th className="l" style={{ width: 160 }}>Share green</th></tr></thead>
              <tbody key={`${isort}${idir}`}>
                {inds.map((x, i) => (
                  <tr key={x.industry} className={`rowin ${sp && x.industry === sp.industry ? "hl grn" : ""}`} style={{ animationDelay: `${Math.min(i * 18, 700)}ms` }}>
                    <td className="l" style={sp && x.industry === sp.industry ? { fontWeight: 600 } : undefined}>{x.industry}</td>
                    <td className="num f">{x.n}</td>
                    <td className="num">{f(x.meanK)}</td>
                    <td className="num f">{f(x.meanM)}</td>
                    <td className={`num ${rrrCls(x.meanRRR, s.ssoRRR)}`}><b>{f(x.meanRRR)}</b></td>
                    <td className="num f">{x.green}</td>
                    <td className="l"><span className="bar"><i style={{ width: `${((x.pct / maxPct) * 100).toFixed(0)}%`, transitionDelay: `${Math.min(i * 25, 800)}ms` }} /></span><span className="num f" style={{ marginLeft: 8, fontSize: 11 }}>{x.pct}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Reveal>

          {sp && (
            <Reveal className="block">
              <div className="rail"><p className="lab">{sp.industry}</p><p className="big g"><CountUp value={sp.meanRRR} fmt={(v) => f(v, 2)} /></p>
                <p className="s">Mean k/m across {sp.n} names. {sp.green} of them green.</p></div>
              <div className="body">
                <h3>{sp.rank === 1 ? "The most efficient industry on the screen, by share of green names and by mean ratio." : `${sp.pct}% green — the highest share of any industry with more than ${words(sp.minN)} members.`}</h3>
                <p>{words(sp.n).replace(/^./, (c) => c.toUpperCase())} {sp.industry.toLowerCase()} names, averaging <b>{times(sp.meanK)} SPY's return for {times(sp.meanM)} its downside volatility</b>. That is the shape the screen is looking for — performing very well, volatility not too bad — expressed as a number. <b>{sp.pct}% of the industry is green</b>{sp.rank > 1 ? `, and it ranks ${ordinal(sp.rank)} of ${words(sp.of)} industries on mean k/m` : ""}.</p>
                {sp.leaders.length > 0 && (
                  <p>The individual names carry it rather than one outlier: {sp.leaders.map((l, i) => <span key={l.t}>{i > 0 ? (i === sp.leaders.length - 1 ? " and " : ", ") : ""}<span className="tick">{l.t}</span> k/m {f(l.rrr)}</span>)}.
                    {sp.topOverall && <> And at the top of the whole screen sits <span className="tick">{sp.topOverall.t}</span>, {sp.topOverall.d}, up {pctPlain(sp.topOverall.r12)} over twelve months with a largest single day of {pct(sp.topOverall.maxDay, 1)} — {sp.topOverall.maxDay <= 0.5 ? "no day above 50%, a compounding move rather than a corporate action" : "a single session that needs verifying before it is read as a trend"}.</>}
                  </p>
                )}
                {sp.above.length > 0 && (
                  <p>{sp.above.length === 1 ? "One industry beats it" : `${words(sp.above.length).replace(/^./, (c) => c.toUpperCase())} industries beat it`} on mean k/m. {sp.above.slice(0, 2).map((a, i) => <span key={a.industry}>{i > 0 ? " " : ""}<b>{a.industry}</b> at {f(a.meanRRR)} — {a.leaders.join(", ")} — where k averages {f(a.meanK, 1)} and {a.green} of {a.n} are green.</span>)}</p>
                )}
              </div>
            </Reveal>
          )}
        </section>

        {/* ---------------- green list ---------------- */}
        <section className="sec">
          <div className="h2row"><h2>The green list</h2><span>Top {cnt(Math.min(s.green.length, s.greenTotal))} of {cnt(s.greenTotal)} · green on both 6m and 12m</span></div>
          <p className="lead">Every row below beat SPY over both six and twelve months while earning more return per unit of added downside than SPY itself. Sorted by twelve-month k/m. Leveraged, inverse and option-income wrappers are excluded.</p>
          <Reveal className="card"><Scatter pts={scatter} ssoRRR={s.ssoRRR} /></Reveal>
          <div className="ctrl"><span className="lab">Sort</span>
            {([["rrr", "k/m"], ["k", "k"], ["r12", "12m return"], ["momDays", "Days mom>1"], ["mdd", "Shallowest drawdown"], ["adv", "Liquidity"]] as Array<[GSort, string]>).map(([k, l]) => (
              <button key={k} className="chip" aria-pressed={gs === k} onClick={() => clickG(k)}>{l} {gs === k ? (gd < 0 ? "▾" : "▴") : ""}</button>
            ))}
            <span className="lab push">Show</span>
            {([["all", "All"], ["stock", "Stocks"], ["etf", "ETFs"]] as Array<[GF, string]>).map(([k, l]) => (
              <button key={k} className="chip" aria-pressed={gf === k} onClick={() => setGf(k)}>{l}</button>
            ))}
          </div>
          <Reveal className="card scroll">
            <table>
              <thead><tr><th className="l">Ticker</th><th className="l">Industry</th><th>12m</th><th>k</th><th>m</th><th>k/m</th><th>Down vol</th><th>Max DD</th><th>6m</th><th>k/m 6m</th><th>3m</th><th>mom</th><th>d&gt;1</th><th>GMMA</th><th>$M/d</th></tr></thead>
              <tbody key={`${gs}${gd}${gf}`}>
                {greens.map((x, i) => <GreenTr key={x.t} x={x} i={i} sso={s.ssoRRR} />)}
              </tbody>
            </table>
          </Reveal>
          <p className="notes">Rows flagged <span className="flag">verify</span> returned more than 20× SPY over the window, moved more than 50% in a single session, or returned more than 1,000% over twelve months; hover the flag for the reason. {s.flaggedExamples.length > 0 && <>{s.flaggedExamples.length === 1 ? "The largest flag today" : `The largest flags today`}: {s.flaggedExamples.map((e, i) => <span key={e.t}>{i > 0 ? "; " : ""}<b>{e.t}</b> ({e.reason})</span>)} — treat those as corporate actions or event risk until confirmed, not as trends.</> } <b>d&gt;1</b> counts sessions in the last 126 with momValue above 1. <b>GMMA</b> is ● when every short-group EMA sits above every long-group EMA.</p>
        </section>

        {/* ---------------- wrappers ---------------- */}
        <section className="sec">
          <div className="h2row"><h2>The structural wrappers</h2><span>Excluded from the ranking · {cnt(wr.count)} funds</span></div>
          <p className="lead">Leveraged, inverse, option-income, buffer, target-date and VIX products are tagged by name and kept out of the ranked list. They are scored anyway, so the cost of the wrapper is visible.</p>
          <Reveal className="wrapgrid">
            <div className="card">
              <dl className="mini">
                <div><dt>Wrappers</dt><dd><CountUp value={wr.count} fmt={cnt} /></dd><p>{cnt(wr.green12)} green on the 12m test</p></div>
                <div><dt>Theme funds</dt><dd><CountUp value={wr.themeCount} fmt={cnt} /></dd><p>Plain ETFs in the ranking</p></div>
                <div><dt>Mean k/m</dt><dd className={Number.isFinite(wr.meanRRR) && wr.meanRRR < wr.themeMeanRRR ? "r" : "g"}>{f(wr.meanRRR)}</dd><p>vs {f(wr.themeMeanRRR)} for theme funds</p></div>
              </dl>
              {wrapperTax && (
                <p className="notes" style={{ marginTop: 18 }}><b>The wrapper tax, today.</b> On the last session, {pctPlain(upDay)} of the universe closed up. The {cnt(wr.count)} wrappers averaged {pct(wr.avgD1Wrapper, 3)} against {pct(wr.avgD1Theme, 3)} for the {cnt(wr.themeCount)} theme funds{wr.avgD1Wrapper < wr.avgD1Theme ? " — the structure gave back part of the day." : " — the structure was paid for, this session."}</p>
              )}
            </div>
            <div className="card scroll" style={{ padding: 0 }}>
              <table>
                <thead><tr><th className="l">Category</th><th>N</th><th>Green 12m</th><th>Mean k/m</th></tr></thead>
                <tbody>
                  {wr.byCategory.map((c) => (
                    <tr key={c.category}><td className="l">{c.category}</td><td className="num f">{c.n}</td><td className="num">{c.green12}</td><td className={`num ${rrrCls(Number.isFinite(c.meanRRR) ? c.meanRRR : null, s.ssoRRR)}`}>{f(c.meanRRR)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </section>

        {/* ---------------- checks ---------------- */}
        <section className="sec">
          <div className="h2row"><h2>Verification</h2><span>Run before every publish · a blocking failure keeps the previous snapshot live</span></div>
          <Reveal className="checks">
            {s.checks.map((c) => (
              <div key={c.name}>
                <div className="nm"><span className={c.pass ? "ok" : "no"}>{c.pass ? "✓" : "✗"}</span>{c.name}{!c.blocking && <span className="flag etf">info</span>}</div>
                <div className="dt">{c.detail}</div>
              </div>
            ))}
          </Reveal>
        </section>

        <div className="foot">
          <p><b>Definitions.</b> k = asset return ÷ SPY return over the window. m = asset downside volatility ÷ SPY downside volatility, where downside volatility is the annualised root-mean-square of negative daily returns only. k/m is return per unit of added downside; SPY is 1.000 by construction, SSO {f(s.ssoRRR, 3)} and UPRO {f(s.uproRRR, 3)} over the trailing twelve months to {formatLong(s.asOf)}. Green requires k &gt; 1 and k/m &gt; 1 on both the six- and twelve-month windows; the industry table uses the twelve-month test only.</p>
          <p><b>momValue</b> is <code>ema((close − midAll) / atr(20), 3)</code> with <code>midAll = ((highest(high,20) + lowest(low,20))/2 + ema(close,20))/2</code>, the Adaptive Squeeze Momentum Pro default preset, with Wilder-RMA ATR. GMMA compares EMAs 3/5/8/10/12/15 against 30/35/40/45/50/60.</p>
          <p><b>What this is not.</b> Every figure describes the twelve months that already happened. The forward test above finds no lookback window with a statistically significant edge, so nothing here should be read as a forecast. The screen identifies which assets delivered their outperformance efficiently, which is a question about the past that can be answered exactly — not a claim that they will continue to. Analysis, not advice.</p>
          <p>Bars: {s.provider}. Universe and industry classification: {s.universeSource}. Snapshot generated {s.generatedAtNY} from {cnt(s.universe.barsCalendar)} daily bars per name. {spy && sso && upro ? `SPY ${pct(spy.r12, 1)}, SSO ${pct(sso.r12, 1)}, UPRO ${pct(upro.r12, 1)} over the window.` : ""}</p>
        </div>
      </main>
    </>
  );
}

function GreenTr({ x, i, sso }: { x: GreenRow; i: number; sso: number | null }) {
  return (
    <tr className="grn rowin" style={{ animationDelay: `${Math.min(i * 14, 900)}ms` }}>
      <td className="l"><span className="num" style={{ fontWeight: 600, fontSize: 13.5 }}>{x.t}</span>{x.etf ? <span className="flag etf">etf</span> : null}{x.vf.length ? <span className="flag" title={x.vf.join("; ")}>verify</span> : null}<span className="sub">{x.d}</span></td>
      <td className="l f" style={{ fontSize: 12 }}>{x.ind}</td>
      <td className="num">{pct(x.r12)}</td>
      <td className="num">{f(x.k)}</td>
      <td className="num f">{f(x.m)}</td>
      <td className="num g"><b>{f(x.rrr)}</b></td>
      <td className="num f">{pctPlain(x.dv)}</td>
      <td className="num f">{pct(x.mdd)}</td>
      <td className="num">{pct(x.r6)}</td>
      <td className={`num ${rrrCls(x.rrr6, sso)}`}>{f(x.rrr6)}</td>
      <td className="num f">{pct(x.r3)}</td>
      <td className={`num ${x.mom !== null && x.mom > 0 ? "g" : "f"}`}>{x.mom !== null ? f(x.mom) : "—"}</td>
      <td className="num f">{x.momDays ?? "—"}</td>
      <td className={`num ${x.gA ? "g" : "f"}`} title={x.gSep !== null ? `separation ${f(x.gSep, 1)}%` : undefined}>{x.gA === null ? "—" : x.gA ? "●" : "○"}</td>
      <td className="num f">{x.adv >= 1000 ? (x.adv / 1000).toFixed(1) + "b" : x.adv.toFixed(0) + "m"}</td>
    </tr>
  );
}
