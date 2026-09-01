import type { Metadata } from "next";

import { ReportsBrowser } from "@/features/reports/reports-browser";

export const metadata: Metadata = {
  title: "Explore road issues",
  description: "Browse road problems reported across the city, with AI-assisted priority scores.",
};

export default function ReportsPage() {
  return (
    <div className="container py-8 md:py-12">
      <header className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">Explore road issues</h1>
        <p className="mt-2 text-muted-foreground">
          Every report submitted by citizens across the city, with the AI-assisted priority score
          the works department uses to plan repairs.
        </p>
      </header>

      <ReportsBrowser />
    </div>
  );
}
