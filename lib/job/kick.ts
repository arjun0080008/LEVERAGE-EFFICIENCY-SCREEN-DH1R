import type { NextRequest } from "next/server";
import { selfUrl } from "@/lib/auth";

/**
 * Trigger the next hop. The request is awaited only until it has been accepted (a few seconds at most);
 * Vercel keeps running an accepted invocation after the caller disconnects, so the abort is harmless.
 * This runs inside the request, never after the response: kicks issued from the post-response phase
 * were observed to be dropped.
 */
export async function kickNextHop(req: NextRequest): Promise<boolean> {
  const next = selfUrl(req, "/api/cron/refresh?hop=1");
  const secret = process.env.CRON_SECRET ?? "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fetch(next, { headers: { authorization: `Bearer ${secret}` }, cache: "no-store", signal: AbortSignal.timeout(8000) });
      return true;
    } catch (e) {
      // an abort means the request was sent and the hop is still working: that is the normal case
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return true;
      console.error(`chain trigger attempt ${attempt + 1} failed`, e);
    }
  }
  return false;
}
