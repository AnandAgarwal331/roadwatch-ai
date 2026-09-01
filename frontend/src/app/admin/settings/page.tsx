import type { Metadata } from "next";

import { SettingsView } from "@/features/admin/settings-view";

export const metadata: Metadata = {
  title: "Scoring settings",
  description: "The weights, thresholds and providers the scoring engine is running with.",
};

export default function AdminSettingsPage() {
  return <SettingsView />;
}
