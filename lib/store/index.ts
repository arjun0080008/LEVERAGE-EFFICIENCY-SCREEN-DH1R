import { promises as fs } from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

/** Minimal key/value blob store. Keys are slash-separated paths; values are strings (JSON). */
export interface Store {
  kind: string;
  get(key: string): Promise<string | null>;
  put(key: string, body: string): Promise<void>;
  getBytes(key: string): Promise<Uint8Array | null>;
  putBytes(key: string, body: Uint8Array, contentType: string): Promise<void>;
  del(key: string): Promise<void>;
}

class FsStore implements Store {
  kind = "fs";
  constructor(private root: string) {}
  private p(key: string) {
    return path.join(this.root, key);
  }
  async get(key: string) {
    const b = await this.getBytes(key);
    return b === null ? null : Buffer.from(b).toString("utf8");
  }
  async put(key: string, body: string) {
    await this.putBytes(key, Buffer.from(body), "application/json");
  }
  async getBytes(key: string) {
    try {
      return new Uint8Array(await fs.readFile(this.p(key)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async putBytes(key: string, body: Uint8Array, _contentType: string) {
    void _contentType;
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
    const b = await this.getBytes(key);
    return b === null ? null : Buffer.from(b).toString("utf8");
  }
  async put(key: string, body: string) {
    await this.putBytes(key, Buffer.from(body), "application/json");
  }
  async getBytes(key: string) {
    const { head, BlobNotFoundError } = await this.mod;
    try {
      const meta = await head(key);
      const res = await fetch(meta.url, { cache: "no-store" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`blob fetch ${key}: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (e instanceof BlobNotFoundError) return null;
      if (e instanceof Error && /not.?found|does not exist/i.test(e.name + " " + e.message)) return null;
      throw e;
    }
  }
  async putBytes(key: string, body: Uint8Array, contentType: string) {
    const { put } = await this.mod;
    await put(key, Buffer.from(body), { access: "public", addRandomSuffix: false, contentType, cacheControlMaxAge: 60 });
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

/** Gzipped JSON, for the bulky day files. */
export async function getGz<T>(key: string): Promise<T | null> {
  const b = await getStore().getBytes(key);
  return b === null ? null : (JSON.parse(gunzipSync(b).toString("utf8")) as T);
}

export async function putGz(key: string, value: unknown): Promise<void> {
  await getStore().putBytes(key, gzipSync(Buffer.from(JSON.stringify(value))), "application/gzip");
}

export const KEYS = {
  universe: "universe/current.json",
  days: "state/days.json",
  dayFile: (id: string) => `days/${id}.json.gz`,
  job: "state/job.json",
  status: "state/status.json",
  latest: "snapshots/latest.json",
  previous: "snapshots/previous.json",
  dated: (iso: string) => `snapshots/${iso}.json`,
};
