/** fetch with timeout, retry with exponential backoff on 429/5xx/network errors, and a small concurrency pool. */
export interface FetchOpts {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
}

export class HttpError extends Error {
  constructor(public status: number, public url: string, message?: string) {
    super(message ?? `HTTP ${status} for ${url}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const { timeoutMs = 15_000, retries = 3 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: opts.headers,
        body: opts.body,
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new HttpError(res.status, url);
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt + Math.random() * 300);
        continue;
      }
      if (!res.ok) throw new HttpError(res.status, url);
      return await res.text();
    } catch (e) {
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e;
      lastErr = e;
      await sleep(500 * 2 ** attempt + Math.random() * 300);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  return JSON.parse(await fetchText(url, opts)) as T;
}

/** Run `fn` over `items` with at most `limit` in flight. Never rejects; errors are returned per item. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<Array<{ ok: true; value: R } | { ok: false; error: string }>> {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { ok: true, value: await fn(items[i], i) };
      } catch (e) {
        out[i] = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
};
