import { catalogDownload } from "@/lib/trail-catalog/server";
export const runtime = "nodejs";
export async function GET() {
  try { return new Response(new Uint8Array(await catalogDownload()),{ headers:{ "Content-Type":"application/gzip", "Content-Disposition":"attachment; filename=hyked-trail-catalog.json.gz", "Cache-Control":"public, max-age=3600" } }); }
  catch { return Response.json({ error:"The catalog download is unavailable." },{ status:503 }); }
}
