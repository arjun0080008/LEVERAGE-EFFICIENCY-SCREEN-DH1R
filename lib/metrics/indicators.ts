/**
 * Technical indicator primitives implemented to match Pine Script conventions:
 *   - ta.ema and ta.rma are SMA-seeded (na until `len-1`, then recursive)
 *   - ta.atr is Wilder RMA of true range, first true range = high - low
 *   - ta.stdev is population standard deviation (divide by n)
 * All functions return arrays the same length as the input, NaN where undefined.
 */

export const NaNArray = (n: number): number[] => new Array<number>(n).fill(NaN);

/** Simple moving average, NaN until `len` valid values are available. */
export function sma(src: number[], len: number): number[] {
  const out = NaNArray(src.length);
  let sum = 0;
  let count = 0;
  const q: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    if (Number.isNaN(x)) {
      continue;
    }
    q.push(x);
    sum += x;
    count++;
    if (q.length > len) {
      sum -= q.shift() as number;
      count--;
    }
    if (count === len) out[i] = sum / len;
  }
  return out;
}

/** Exponential moving average with alpha, SMA-seeded on the first `len` valid values (Pine ta.ema / ta.rma). */
function seededRecursive(src: number[], len: number, alpha: number): number[] {
  const out = NaNArray(src.length);
  let seedBuf: number[] = [];
  let prev = NaN;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    if (Number.isNaN(x)) continue;
    if (Number.isNaN(prev)) {
      seedBuf.push(x);
      if (seedBuf.length === len) {
        prev = seedBuf.reduce((a, b) => a + b, 0) / len;
        out[i] = prev;
        seedBuf = [];
      }
      continue;
    }
    prev = alpha * x + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

export function ema(src: number[], len: number): number[] {
  return seededRecursive(src, len, 2 / (len + 1));
}

/** Wilder's moving average. */
export function rma(src: number[], len: number): number[] {
  return seededRecursive(src, len, 1 / len);
}

export function trueRange(h: number[], l: number[], c: number[]): number[] {
  const out = NaNArray(h.length);
  for (let i = 0; i < h.length; i++) {
    if (i === 0) {
      out[i] = h[i] - l[i];
    } else {
      const pc = c[i - 1];
      out[i] = Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc));
    }
  }
  return out;
}

export function atr(h: number[], l: number[], c: number[], len: number): number[] {
  return rma(trueRange(h, l, c), len);
}

export function highest(src: number[], len: number): number[] {
  const out = NaNArray(src.length);
  for (let i = len - 1; i < src.length; i++) {
    let m = -Infinity;
    for (let j = i - len + 1; j <= i; j++) if (src[j] > m) m = src[j];
    out[i] = m;
  }
  return out;
}

export function lowest(src: number[], len: number): number[] {
  const out = NaNArray(src.length);
  for (let i = len - 1; i < src.length; i++) {
    let m = Infinity;
    for (let j = i - len + 1; j <= i; j++) if (src[j] < m) m = src[j];
    out[i] = m;
  }
  return out;
}

/** Population standard deviation over a rolling window (Pine ta.stdev). */
export function stdevPop(src: number[], len: number): number[] {
  const out = NaNArray(src.length);
  for (let i = len - 1; i < src.length; i++) {
    let s = 0;
    for (let j = i - len + 1; j <= i; j++) s += src[j];
    const mean = s / len;
    let ss = 0;
    for (let j = i - len + 1; j <= i; j++) {
      const d = src[j] - mean;
      ss += d * d;
    }
    out[i] = Math.sqrt(ss / len);
  }
  return out;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (n-1), used for t-statistics. */
export function stdevSample(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) * (x - m);
  return Math.sqrt(ss / (xs.length - 1));
}

/** Average ranks (ties share the mean rank). */
export function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => i).sort((a, b) => xs[a] - xs[b]);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[i]]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k]] = r;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation, ignoring pairs where either side is not finite. */
export function spearman(a: number[], b: number[]): number {
  const xa: number[] = [];
  const xb: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
      xa.push(a[i]);
      xb.push(b[i]);
    }
  }
  const n = xa.length;
  if (n < 3) return NaN;
  const ra = ranks(xa);
  const rb = ranks(xb);
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = ra[i] - ma;
    const y = rb[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return NaN;
  return num / Math.sqrt(da * db);
}
