import type { Metadata } from "next";

import { UsersAdmin } from "@/features/admin/users-admin";

export const metadata: Metadata = {
  title: "Users",
  description: "Roles and repair-crew membership.",
};

export default function AdminUsersPage() {
  return <UsersAdmin />;
}
