import type { Metadata } from "next";

import { DuplicatesReview } from "@/features/admin/duplicates-review";

export const metadata: Metadata = {
  title: "Duplicates",
  description: "Reports the system believes describe the same problem.",
};

export default function AdminDuplicatesPage() {
  return <DuplicatesReview />;
}
