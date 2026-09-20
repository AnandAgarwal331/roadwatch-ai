/**
 * The public address of this deployment, for absolute links in metadata,
 * the sitemap and share images. Set NEXT_PUBLIC_SITE_URL once a custom domain
 * exists; until then Vercel's production URL is used.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

/** Who to contact about privacy or terms. Unset means the page says so plainly instead of inventing one. */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? null;
