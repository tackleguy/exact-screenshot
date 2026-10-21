export function apiTarget(input: string, appOrigin: string, apiOrigin: string): string | null {
  const url = new URL(input, appOrigin);
  if (url.origin !== appOrigin || !url.pathname.startsWith("/api/")) return null;
  if (!apiOrigin) return "";
  const backend = new URL(apiOrigin);
  if (backend.protocol !== "https:" && backend.hostname !== "localhost") throw new Error("The trail service address must use HTTPS.");
  return `${backend.origin}${url.pathname}${url.search}`;
}