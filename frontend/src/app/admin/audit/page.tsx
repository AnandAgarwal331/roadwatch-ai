import type { Metadata } from "next";

import { AuditTrail } from "@/features/admin/audit-trail";

export const metadata: Metadata = {
  title: "Audit trail",
  description: "Who changed what, and when.",
};

export default function AdminAuditPage() {
  return <AuditTrail />;
}
