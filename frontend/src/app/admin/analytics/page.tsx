import type { Metadata } from "next";

import { AnalyticsView } from "@/features/admin/analytics-view";

export const metadata: Metadata = {
  title: "Analytics",
  description: "Reporting volume, damage mix, hotspots and crew performance.",
};

export default function AdminAnalyticsPage() {
  return <AnalyticsView />;
}
