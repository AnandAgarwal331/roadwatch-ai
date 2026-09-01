import type { Metadata } from "next";

import { ReportQueue } from "@/features/admin/report-queue";

export const metadata: Metadata = {
  title: "Reports",
  description: "Every report, including rejected and duplicate ones.",
};

export default function AdminReportsPage() {
  return <ReportQueue />;
}
