import type { Metadata } from "next";

import { AdminDashboard } from "@/features/admin/admin-dashboard";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Priority queue, workload and the state of reporting across the city.",
};

export default function AdminHomePage() {
  return <AdminDashboard />;
}
