import type { Metadata } from "next";

import { PageHeading } from "@/components/dashboard/dashboard-shell";
import { CityMap } from "@/features/map/city-map";

export const metadata: Metadata = {
  title: "Map",
  description: "Every reported road issue across the city, coloured by priority.",
};

export default function AdminMapPage() {
  return (
    <>
      <PageHeading
        title="Map"
        description="Every report the system holds, including closed ones. Click a marker for the full report."
      />
      <CityMap admin />
    </>
  );
}
