"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** Adds class "on" when the element scrolls into view (once). */
export function useInView<T extends HTMLElement>(margin = "-8% 0px") {
  const ref = useRef<T | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setOn(true);
      return;
    }
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) { setOn(true); io.disconnect(); }
    }, { rootMargin: margin, threshold: 0.08 });
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return { ref, on };
}

export function Reveal({ children, className = "", as: Tag = "div", delay = 0 }: { children: ReactNode; className?: string; as?: "div" | "section" | "dl" | "p"; delay?: number }) {
  const { ref, on } = useInView<HTMLDivElement>();
  const T = Tag as "div";
  return (
    <T ref={ref} className={`rv ${on ? "on" : ""} ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </T>
  );
}

function prefersReduced() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Counts from 0 to `value` when visible. Formats with `fmt`. */
export function CountUp({ value, fmt, duration = 1400, className = "" }: { value: number; fmt: (v: number) => string; duration?: number; className?: string }) {
  const { ref, on } = useInView<HTMLSpanElement>();
  // Server-render the final value so the page is correct without JS; animate from 0 once the tile is in view.
  const [v, setV] = useState(value);
  useEffect(() => {
    if (!on) return;
    if (prefersReduced()) { setV(value); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - p, 4);
      setV(value * e);
      if (p < 1) raf = requestAnimationFrame(step);
      else setV(value);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [on, value, duration]);
  return <span ref={ref} className={`tnum ${className}`}>{fmt(v)}</span>;
}

/** Headline whose words rise in one after another. */
export function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(" ").map((w, i) => (
        <span key={i} className="w" style={{ animationDelay: `${80 + i * 45}ms` }}>
          {w}{i < text.split(" ").length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([k, lbl]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>{lbl}</button>
      ))}
    </div>
  );
}

export function ThemeToggle() {
  const [mode, setMode] = useState<"auto" | "light" | "dark">("auto");
  useEffect(() => {
    try {
      const m = localStorage.getItem("theme") as "light" | "dark" | null;
      if (m) { setMode(m); document.documentElement.dataset.theme = m; }
    } catch { /* ignore */ }
  }, []);
  const change = (m: "auto" | "light" | "dark") => {
    setMode(m);
    try {
      if (m === "auto") { localStorage.removeItem("theme"); delete document.documentElement.dataset.theme; }
      else { localStorage.setItem("theme", m); document.documentElement.dataset.theme = m; }
    } catch { /* ignore */ }
  };
  return <Seg value={mode} onChange={change} label="Theme" options={[["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]]} />;
}

const fmtDate = (ymd: number) => {
  const d = new Date(Date.UTC(Math.floor(ymd / 10000), Math.floor((ymd % 10000) / 100) - 1, ymd % 100));
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
const fmtMon = (ymd: number) => {
  const d = new Date(Date.UTC(Math.floor(ymd / 10000), Math.floor((ymd % 10000) / 100) - 1, ymd % 100));
  return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
};

/** 12-month cumulative return of SPY vs SSO vs UPRO, drawn from the real bars. */
export function BenchChart({ path }: { path: { t: number[]; spy: number[]; sso: number[]; upro: number[] } }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 900, H = 300, L = 44, R = 16, T = 18, B = 30;
  const series = useMemo(() => [
    { key: "spy", label: "SPY", color: "var(--ink)", vals: path.spy },
    { key: "sso", label: "SSO 2×", color: "var(--amb)", vals: path.sso },
    { key: "upro", label: "UPRO 3×", color: "var(--red)", vals: path.upro },
  ], [path]);
  const all = series.flatMap((s) => s.vals).filter((x) => Number.isFinite(x));
  if (!all.length) return null;
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const pad = (hi - lo) * 0.08 || 0.05;
  const y = (v: number) => T + (H - T - B) * (1 - (v - (lo - pad)) / (hi + pad - (lo - pad)));
  const x = (i: number) => L + ((W - L - R) * i) / Math.max(1, path.t.length - 1);
  const d = (vals: number[]) => vals.map((v, i) => (Number.isFinite(v) ? `${i === 0 || !Number.isFinite(vals[i - 1]) ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}` : "")).join(" ");
  const ticks = useMemo(() => {
    const span = hi + pad - (lo - pad);
    const step = span > 1.2 ? 0.25 : span > 0.6 ? 0.1 : 0.05;
    const out: number[] = [];
    for (let v = Math.ceil((lo - pad) / step) * step; v <= hi + pad; v += step) out.push(Number(v.toFixed(4)));
    return out;
  }, [lo, hi, pad]);
  const months = useMemo(() => {
    const out: number[] = [];
    let last = -1;
    path.t.forEach((t, i) => { const m = Math.floor((t % 10000) / 100); if (m !== last) { out.push(i); last = m; } });
    return out.slice(1);
  }, [path.t]);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * (path.t.length - 1));
    setHover(Math.max(0, Math.min(path.t.length - 1, i)));
  };
  const hi_ = hover;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Twelve-month cumulative return of SPY, SSO and UPRO">
        {ticks.map((v) => (
          <g key={v}>
            <line className="grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} style={v === 0 ? { stroke: "var(--muted)" } : undefined} />
            <text className="axis" x={L - 8} y={y(v) + 3} textAnchor="end">{(v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(0)}%</text>
          </g>
        ))}
        {months.map((i) => <text key={i} className="axis" x={x(i)} y={H - 8} textAnchor="middle">{fmtMon(path.t[i])}</text>)}
        {series.map((s, k) => <path key={s.key} className={`ln d${k + 1}`} d={d(s.vals)} style={{ stroke: s.color }} />)}
        {series.map((s) => {
          const li = s.vals.length - 1;
          return Number.isFinite(s.vals[li]) ? <text key={s.key} className="lbl" x={x(li) + 6} y={y(s.vals[li]) + 4} style={{ fill: s.color }}>{s.label}</text> : null;
        })}
        {hi_ !== null && (
          <g>
            <line className="cross" x1={x(hi_)} x2={x(hi_)} y1={T} y2={H - B} />
            {series.map((s) => Number.isFinite(s.vals[hi_]) ? <circle key={s.key} cx={x(hi_)} cy={y(s.vals[hi_])} r={4} style={{ fill: s.color }} /> : null)}
            <rect x={Math.min(x(hi_) + 10, W - 160)} y={T} width={150} height={20 + series.length * 16} rx={8} style={{ fill: "var(--panel)", stroke: "var(--rule)" }} />
            <text className="tip" x={Math.min(x(hi_) + 20, W - 150)} y={T + 15} style={{ fontWeight: 600 }}>{fmtDate(path.t[hi_])}</text>
            {series.map((s, k) => (
              <text key={s.key} className="tip" x={Math.min(x(hi_) + 20, W - 150)} y={T + 31 + k * 16} style={{ fill: s.color }}>
                {s.label.padEnd(8)} {(s.vals[hi_] >= 0 ? "+" : "−") + Math.abs(s.vals[hi_] * 100).toFixed(1)}%
              </text>
            ))}
          </g>
        )}
      </svg>
      <div className="legend-inline">
        {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
        <span className="push">Cumulative return over the trailing 252 bars</span>
      </div>
    </div>
  );
}

export interface ScatterPt { t: string; k: number; m: number; rrr: number; etf: boolean; ref?: boolean }

/** k (return multiple) against m (risk multiple). Everything above the diagonal earned more than SPY per unit of added downside. */
export function Scatter({ pts, ssoRRR }: { pts: ScatterPt[]; ssoRRR: number | null }) {
  const [hov, setHov] = useState<ScatterPt | null>(null);
  const W = 900, H = 420, L = 44, R = 20, T = 20, B = 36;
  const maxK = Math.max(4, ...pts.map((p) => p.k));
  const maxM = Math.max(4, ...pts.map((p) => p.m));
  const kx = (k: number) => L + ((W - L - R) * Math.log10(1 + k)) / Math.log10(1 + maxK);
  const my = (m: number) => T + (H - T - B) * (1 - Math.log10(1 + m) / Math.log10(1 + maxM));
  const tk = [0.5, 1, 2, 5, 10, 20, 50, 100, 200].filter((v) => v <= maxK);
  const tm = [0.5, 1, 2, 3, 5, 10, 20].filter((v) => v <= maxM);
  // diagonal k = m (RRR 1) and the SSO line k = ssoRRR * m
  const diag = (ratio: number) => {
    const pathPts: string[] = [];
    for (let i = 0; i <= 60; i++) {
      const m = (maxM * i) / 60;
      const k = ratio * m;
      if (k > maxK) break;
      pathPts.push(`${i === 0 ? "M" : "L"}${kx(k).toFixed(1)},${my(m).toFixed(1)}`);
    }
    return pathPts.join(" ");
  };
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Return multiple against risk multiple for every name on the green list" onMouseLeave={() => setHov(null)}>
        {tm.map((v) => <g key={"m" + v}><line className="grid" x1={L} x2={W - R} y1={my(v)} y2={my(v)} /><text className="axis" x={L - 8} y={my(v) + 3} textAnchor="end">{v}×</text></g>)}
        {tk.map((v) => <g key={"k" + v}><line className="grid" y1={T} y2={H - B} x1={kx(v)} x2={kx(v)} /><text className="axis" x={kx(v)} y={H - B + 14} textAnchor="middle">{v}×</text></g>)}
        <text className="axis" x={W - R} y={H - 4} textAnchor="end">k — return multiple vs SPY (log)</text>
        <text className="axis" x={L + 4} y={T - 6}>m — downside-risk multiple (log)</text>
        <path d={diag(1)} style={{ fill: "none", stroke: "var(--grn)", strokeWidth: 1.5, strokeDasharray: "6 4" }} />
        <text className="lbl" x={kx(Math.min(maxK, maxM)) - 6} y={my(Math.min(maxK, maxM)) - 8} textAnchor="end" style={{ fill: "var(--grn)" }}>k/m = 1 · SPY</text>
        {ssoRRR !== null && <path d={diag(ssoRRR)} style={{ fill: "none", stroke: "var(--red)", strokeWidth: 1, strokeDasharray: "3 4" }} />}
        {ssoRRR !== null && <text className="lbl" x={kx(Math.min(maxK, maxM * ssoRRR)) - 6} y={my(Math.min(maxK, maxM * ssoRRR) / ssoRRR) + 14} textAnchor="end" style={{ fill: "var(--red)" }}>k/m = {ssoRRR.toFixed(2)} · SSO</text>}
        {pts.map((p, i) => (
          <circle
            key={p.t}
            className="pt"
            cx={kx(p.k)}
            cy={my(p.m)}
            r={p.ref ? 6 : hov?.t === p.t ? 7 : 4.2}
            style={{ fill: p.ref ? "var(--ink)" : p.etf ? "var(--blue)" : "var(--grn)", opacity: p.ref ? 1 : 0.75, animationDelay: `${Math.min(i * 12, 900)}ms`, transformOrigin: `${kx(p.k)}px ${my(p.m)}px`, cursor: "pointer" }}
            onMouseEnter={() => setHov(p)}
          />
        ))}
        {pts.filter((p) => p.ref).map((p) => <text key={"l" + p.t} className="lbl" x={kx(p.k) + 9} y={my(p.m) + 4}>{p.t}</text>)}
        {hov && (
          <g>
            <rect x={Math.min(kx(hov.k) + 12, W - 190)} y={Math.max(T, my(hov.m) - 52)} width={178} height={44} rx={8} style={{ fill: "var(--panel)", stroke: "var(--rule)" }} />
            <text className="tip" x={Math.min(kx(hov.k) + 22, W - 180)} y={Math.max(T, my(hov.m) - 52) + 17} style={{ fontWeight: 600 }}>{hov.t}{hov.etf ? " · ETF" : ""}</text>
            <text className="tip" x={Math.min(kx(hov.k) + 22, W - 180)} y={Math.max(T, my(hov.m) - 52) + 34}>k {hov.k.toFixed(2)}  m {hov.m.toFixed(2)}  k/m {hov.rrr.toFixed(2)}</text>
          </g>
        )}
      </svg>
      <div className="legend-inline">
        <span><i style={{ background: "var(--grn)", height: 8, width: 8, borderRadius: 8 }} />Stocks</span>
        <span><i style={{ background: "var(--blue)", height: 8, width: 8, borderRadius: 8 }} />ETFs</span>
        <span><i style={{ background: "var(--ink)", height: 8, width: 8, borderRadius: 8 }} />Benchmarks</span>
        <span className="push">Every green name sits above the diagonal by construction; distance above it is efficiency.</span>
      </div>
    </div>
  );
}

/** Tiny sparkline for KPI tiles. */
export function Spark({ vals, color = "currentColor" }: { vals: number[]; color?: string }) {
  const v = vals.filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  const lo = Math.min(...v), hi = Math.max(...v);
  const d = v.map((x, i) => `${i === 0 ? "M" : "L"}${(i / (v.length - 1)) * 92},${44 - ((x - lo) / (hi - lo || 1)) * 40}`).join(" ");
  return <svg className="spark" viewBox="0 0 92 44" aria-hidden="true"><path d={d} fill="none" stroke={color} strokeWidth="2" /></svg>;
}
