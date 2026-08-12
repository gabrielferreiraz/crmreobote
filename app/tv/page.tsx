import { requireSession } from "@/lib/require-session";
import { getTvMetrics } from "@/lib/tv-dashboard";
import { redirect } from "next/navigation";
import { TvView } from "./tv-view";

export const dynamic = "force-dynamic";

export default async function TvPage() {
  const { organizationId } = await requireSession();
  
  if (!organizationId) {
    // If not authenticated or no tenant, redirect to login
    redirect("/login");
  }

  const metrics = await getTvMetrics(organizationId);

  return <TvView initialMetrics={metrics} />;
}
