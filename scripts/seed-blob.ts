/**
 * Upload a local ./.data directory (from refresh-local) into Vercel Blob so the first cron run is incremental:
 *   BLOB_READ_WRITE_TOKEN=... npx tsx scripts/seed-blob.ts
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN not set");
  const root = path.join(process.cwd(), ".data");
  const files = await walk(root);
  for (const f of files) {
    const key = path.relative(root, f).split(path.sep).join("/");
    const body = await fs.readFile(f, "utf8");
    await put(key, body, { access: "public", addRandomSuffix: false, contentType: "application/json" });
    console.log("uploaded", key, `${(body.length / 1024).toFixed(0)} KB`);
  }
  console.log(`${files.length} files uploaded`);
}
main().catch((e) => { console.error(e); process.exit(1); });
