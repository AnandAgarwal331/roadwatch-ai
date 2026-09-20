import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

// Only the pages that are the same for everyone. Individual report pages are
// not listed: they change constantly and can be reached from /reports.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return ["", "/map", "/reports", "/register", "/privacy", "/terms"].map((path) => ({
    url: `${base}${path}`,
  }));
}
