import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Signed-in consoles and APIs have nothing for a search engine. Not
      // "/report": robots rules match by prefix, so that would also hide the
      // public /reports feed.
      disallow: ["/admin", "/team", "/api", "/my-reports", "/profile"],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
