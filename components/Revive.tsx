"use client";
import { useEffect } from "react";

/** Pings the health endpoint once per page view; a stalled refresh job is re-triggered by that call. */
export function Revive() {
  useEffect(() => {
    fetch("/api/health", { cache: "no-store" }).catch(() => undefined);
  }, []);
  return null;
}
