import type { NextRequest } from "next/server";

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Manual calls may use the same header or `?key=`. */
export function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization") ?? "";
  const key = req.nextUrl.searchParams.get("key") ?? "";
  return auth === `Bearer ${secret}` || key === secret;
}

export function selfUrl(req: NextRequest, path: string): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}${path}`;
}
