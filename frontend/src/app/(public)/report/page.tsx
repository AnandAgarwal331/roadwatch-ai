import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ReportWizard } from "@/features/report/report-wizard";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Report a road problem",
  description:
    "Upload a photo and location. AI identifies the damage and the system calculates an explainable repair priority.",
};

export const dynamic = "force-dynamic";

export default async function ReportPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=%2Freport");
  }

  return (
    <div className="container max-w-4xl py-8 md:py-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Report a road problem
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          It takes about a minute. Your report is analysed, scored and passed to the works
          department with a full explanation of how it was prioritised.
        </p>
      </header>

      <ReportWizard />
    </div>
  );
}
