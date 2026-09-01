import type { Metadata } from "next";

import { MyReports } from "@/features/reports/my-reports";

export const metadata: Metadata = {
  title: "My reports",
  description: "Track the road problems you have reported, from submission to repair.",
};

export default function MyReportsPage() {
  return (
    <div className="container py-8 md:py-12">
      <header className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">My reports</h1>
        <p className="mt-2 text-muted-foreground">
          Everything you have reported, and where each one has got to. You will also get a
          notification whenever one of them changes status.
        </p>
      </header>

      <MyReports />
    </div>
  );
}
