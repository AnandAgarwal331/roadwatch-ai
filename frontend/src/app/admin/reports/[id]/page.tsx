import type { Metadata } from "next";

import { ReportDetail } from "@/features/admin/report-detail";

export const metadata: Metadata = {
  title: "Report detail",
};

export default async function AdminReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReportDetail complaintId={id} />;
}
