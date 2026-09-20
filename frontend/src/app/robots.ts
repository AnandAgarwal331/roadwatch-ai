import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Signed-in consoles and APIs have nothing for a search engine.
      disallow: ["/admin", "/team", "/api", "/my-reports", "/profile", "/report"],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
