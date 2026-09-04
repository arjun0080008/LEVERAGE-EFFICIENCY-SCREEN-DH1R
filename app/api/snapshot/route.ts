import { NextResponse, type NextRequest } from "next/server";
import { getGz, getStore, KEYS } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The live JSON snapshot the page renders from. `?which=previous` returns the prior publish; `?which=scored` the full scored table. */
export async function GET(req: NextRequest) {
  const which = req.nextUrl.searchParams.get("which") ?? "latest";
  if (which === "scored") {
    const scored = await getGz<unknown>("snapshots/scored-latest.json.gz");
    if (!scored) return NextResponse.json({ error: "no snapshot yet" }, { status: 404 });
    return NextResponse.json(scored, { headers: { "cache-control": "public, max-age=300" } });
  }
  const key = which === "previous" ? KEYS.previous : KEYS.latest;
  const body = await getStore().get(key);
  if (body === null) return NextResponse.json({ error: "no snapshot yet" }, { status: 404 });
  return new NextResponse(body, { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });
}
