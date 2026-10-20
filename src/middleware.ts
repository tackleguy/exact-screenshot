import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * The public API (/api/*) is read by other frontends (the Hyked Lovable app), so it answers
 * cross-origin requests. CORS_ORIGINS can list allowed origins (comma-separated); default is any.
 * Signed-in features use Supabase directly from the frontend, so no cookies cross origins here.
 */
function corsHeaders(request: NextRequest) {
  const allowed = (process.env.CORS_ORIGINS ?? "*").split(",").map((o) => o.trim()).filter(Boolean);
  const origin = request.headers.get("origin");
  const allow = allowed.includes("*") ? "*" : origin && allowed.includes(origin) ? origin : allowed[0] ?? "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    ...(allow === "*" ? {} : { Vary: "Origin" }),
  };
}

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
    const response = await updateSession(request);
    for (const [k, v] of Object.entries(corsHeaders(request))) response.headers.set(k, v);
    return response;
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
