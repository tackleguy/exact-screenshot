/**
 * Absolute origin for canonical links, sitemaps and robots.txt. NEXT_PUBLIC_SITE_URL wins; on Vercel the
 * production domain is used when it isn't set, so deployed sitemaps never point at localhost.
 */
export function siteUrl() {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}
