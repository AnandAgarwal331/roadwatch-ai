import type { Metadata } from "next";

import { TeamsAdmin } from "@/features/admin/teams-admin";

export const metadata: Metadata = {
  title: "Repair teams",
  description: "Crews, their zones, capacity and current workload.",
};

export default function AdminTeamsPage() {
  return <TeamsAdmin />;
}
