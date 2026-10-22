import { PlannerStart } from "@/components/assistant/PlannerStart";
import { getPlannerContext } from "@/lib/assistant/context";
export const metadata = { title: "Plan a trip — Hyked", description: "Find a trail, prepare your gear, and build a pack with Hyked Eco AI, an eco-friendly model that runs on your device, and your own trip history." };
export const dynamic = "force-dynamic";
export default async function PlanPage({ searchParams }: { searchParams:Promise<{ region?:string; prompt?:string; personalTrail?:string; route?:string }> }) {
  const context = await getPlannerContext();
  const params = await searchParams;
  const region = typeof params.region === "string" ? params.region.slice(0,100) : "";
  const prompt = typeof params.prompt === "string" ? params.prompt.slice(0,1500) : "";
  const routeParam = typeof params.personalTrail === "string" ? params.personalTrail.slice(0, 64) : typeof params.route === "string" ? params.route.slice(0, 4000) : null;
  return <PlannerStart key={`${context.userId ?? "guest"}:${region}:${prompt}:${routeParam ?? ""}`} context={context} initialRegion={region} initialPrompt={prompt} routeParam={routeParam} />;
}
