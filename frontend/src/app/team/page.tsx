import type { Metadata } from "next";

import { TeamDashboard } from "@/features/team/team-dashboard";

export const metadata: Metadata = {
  title: "Today",
  description: "Your crew's jobs for today, worst first.",
};

export default function TeamHomePage() {
  return <TeamDashboard />;
}
