import type { Metadata } from "next";

import { CityMap } from "@/features/map/city-map";

export const metadata: Metadata = {
  title: "City map",
  description: "Live map of reported road issues across the city, coloured by priority.",
};

export default function MapPage() {
  return (
    <div className="container py-8 md:py-12">
      <header className="mb-6 max-w-2xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">City map</h1>
        <p className="mt-2 text-muted-foreground">
          Every open road issue, coloured by priority. Click a marker for the assessment behind it.
        </p>
      </header>

      <CityMap />
    </div>
  );
}
