import { redirect } from "next/navigation";

import { TeamShell } from "@/features/team/team-shell";
import { getCurrentUser } from "@/lib/session";

export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fteam");

  // Middleware routes on a cookie hint; this is the check that actually holds.
  // Admins are allowed in so they can see what a crew sees.
  if (user.role !== "REPAIR_TEAM" && user.role !== "ADMIN") redirect("/");

  return <TeamShell user={user}>{children}</TeamShell>;
}
