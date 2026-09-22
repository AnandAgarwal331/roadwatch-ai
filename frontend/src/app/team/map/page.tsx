import type { Metadata } from "next";

import { TeamMap } from "@/features/team/team-map";

export const metadata: Metadata = {
  title: "Map",
  description: "Every job assigned to your crew, on a map.",
};

export default function TeamMapPage() {
  return <TeamMap />;
}
