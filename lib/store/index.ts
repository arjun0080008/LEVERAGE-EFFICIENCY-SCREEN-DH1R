import { promises as fs } from "node:fs";
import path from "node:path";

/** Minimal key/value blob store. Keys are slash-separated paths; values are strings (JSON). */
export interface Store {
  kind: string;
  get(key: string): Promise<string | null>;
  put(key: string, body: string): Promise<void>;
  del(key: string): Promise<void>;
}

class FsStore implements Store {
  kind = "fs";
  constructor(private root: string) {}
  private p(key: string) {
    return path.join(this.root, key);
  }
  async get(key: string) {
    try {
      return await fs.readFile(this.p(key), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async put(key: string, body: string) {
    await fs.mkdir(path.dirname(this.p(key)), { recursive: true });
    const tmp = this.p(key) + ".tmp";
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, this.p(key));
  }
  async del(key: string) {
    await fs.rm(this.p(key), { force: true });
  }
}

class BlobStore implements Store {
  kind = "blob";
  private mod: Promise<typeof import("@vercel/blob")> = import("@vercel/blob");
  async get(key: string) {
    const { head, BlobNotFoundError } = await this.mod;
    try {
      const meta = await head(key);
      const res = await fetch(meta.url, { cache: "no-store" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`blob fetch ${key}: HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (e instanceof BlobNotFoundError) return null;
      if (e instanceof Error && /not.?found|does not exist/i.test(e.name + " " + e.message)) return null;
      throw e;
    }
  }
  async put(key: string, body: string) {
    const { put } = await this.mod;
    await put(key, body, { access: "public", addRandomSuffix: false, contentType: key.endsWith(".json") ? "application/json" : "text/plain", cacheControlMaxAge: 60 });
  }
  async del(key: string) {
    const { del, head } = await this.mod;
    try {
      const meta = await head(key);
      await del(meta.url);
    } catch {
      /* already gone */
    }
  }
}

let store: Store | null = null;
export function getStore(): Store {
  if (store) return store;
  const wantFs = process.env.STORE === "fs" || (!process.env.BLOB_READ_WRITE_TOKEN && process.env.VERCEL !== "1");
  store = wantFs ? new FsStore(path.join(process.cwd(), ".data")) : new BlobStore();
  return store;
}

export async function getJson<T>(key: string): Promise<T | null> {
  const s = await getStore().get(key);
  return s === null ? null : (JSON.parse(s) as T);
}

export async function putJson(key: string, value: unknown): Promise<void> {
  await getStore().put(key, JSON.stringify(value));
}

export const KEYS = {
  universe: "universe/current.json",
  shard: (i: number) => `bars/shard-${String(i).padStart(3, "0")}.json`,
  job: "state/job.json",
  status: "state/status.json",
  latest: "snapshots/latest.json",
  previous: "snapshots/previous.json",
  dated: (iso: string) => `snapshots/${iso}.json`,
};
