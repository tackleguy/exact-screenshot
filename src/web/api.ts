import { createClient } from "@/lib/supabase/client";
import { apiTarget } from "./api-target";
export const apiOrigin = (import.meta.env.VITE_HYKED_API_URL ?? "").replace(/\/+$/, "");
export function installApiBridge() {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const target = apiTarget(url, window.location.origin, apiOrigin);
    if (target === null) return original(input, init);
    if (!target) return Response.json({ error: "Live trail services are not connected yet." }, { status: 503 });
    const request = new Request(input instanceof Request ? input : new URL(url, window.location.origin), init);
    const headers = new Headers(request.headers);
    const client = createClient();
    if (client) {
      const { data } = await client.auth.getSession();
      if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
    }
    return original(new Request(target, request), { headers });
  };
  document.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor) return;
    const target = apiTarget(anchor.href, window.location.origin, apiOrigin);
    if (target) anchor.href = target;
    else if (target === "") { event.preventDefault(); window.alert("Live trail services are not connected yet."); }
  }, true);
}