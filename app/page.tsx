import { Dashboard } from "@/components/Dashboard";
import { EmptyState } from "@/components/EmptyState";
import type { Snapshot, Status } from "@/lib/snapshot";
import { getJson, KEYS } from "@/lib/store";

/** Static page, regenerated on demand by the cron job (revalidatePath) and at most every 10 minutes otherwise. */
export const revalidate = 600;

async function load(): Promise<{ snapshot: Snapshot | null; status: Status | null }> {
  try {
    const [snapshot, status] = await Promise.all([getJson<Snapshot>(KEYS.latest), getJson<Status>(KEYS.status)]);
    return { snapshot, status };
  } catch {
    return { snapshot: null, status: null };
  }
}

export default async function Page() {
  const { snapshot, status } = await load();
  if (!snapshot) return <EmptyState status={status} />;
  return <Dashboard s={snapshot} status={status} />;
}
