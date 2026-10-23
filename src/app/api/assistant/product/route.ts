import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabase } from "@supabase/supabase-js";
import { researchProduct } from "@/lib/assistant/product-recovery";
import { getAuthUser } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/env";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Signed-in check: cookie session, or a bearer token from the static client. */
async function isSignedIn(request: NextRequest): Promise<boolean> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const env = getSupabaseEnv();
  if (token && env) {
    const client = createSupabase(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await client.auth.getUser(token);
    if (data.user) return true;
  }
  const { user } = await getAuthUser();
  return !!user;
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  try {
    if (origin && new URL(origin).host !== request.headers.get("host")) return NextResponse.json({ error: "Use this tool from the app." }, { status: 403 });
    if (!(await isSignedIn(request))) return NextResponse.json({ error: "Sign in to look up product pages." }, { status: 401 });
    const body = await request.text();
    if (body.length > 4000) return NextResponse.json({ error: "Product URL is too long." }, { status: 400 });
    const { url, name } = JSON.parse(body);
    if (typeof url !== "string" || url.length > 2000) return NextResponse.json({ error: "Enter a product URL." }, { status: 400 });
    if (name !== undefined && (typeof name !== "string" || name.length > 240)) return NextResponse.json({ error: "Use a product name under 240 characters." }, { status: 400 });
    return NextResponse.json(await researchProduct(url, name), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read this page. Enter its specifications manually." }, { status: 422 }); }
}
