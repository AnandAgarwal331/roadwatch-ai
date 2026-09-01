import { redirect } from "next/navigation";

import { AdminShell } from "@/features/admin/admin-shell";
import { getCurrentUser } from "@/lib/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fadmin");

  // The middleware routes on a cookie hint. This is the check that holds, and
  // the API enforces it again on every request behind these pages.
  if (user.role !== "ADMIN") redirect("/");

  return <AdminShell user={user}>{children}</AdminShell>;
}
