import { NextResponse, type NextRequest } from "next/server";
import { getStore, KEYS } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The live JSON snapshot the page renders from. `?which=previous` returns the prior publish; `?which=scored` the full scored table. */
export async function GET(req: NextRequest) {
  const which = req.nextUrl.searchParams.get("which") ?? "latest";
  const key = which === "previous" ? KEYS.previous : which === "scored" ? "snapshots/scored-latest.json" : KEYS.latest;
  const body = await getStore().get(key);
  if (body === null) return NextResponse.json({ error: "no snapshot yet" }, { status: 404 });
  return new NextResponse(body, { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });
}
