import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { name } = await req.json();
    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return new Response(JSON.stringify({ error: "Gear name is required (min 2 chars)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a backpacking and hiking gear expert. Given a gear item name, return accurate real-world data for that item. You must respond ONLY by calling the provided function tool. Use typical retail prices in USD and weights in ounces. For type, use "Base" for items carried in/on the pack, "Worn" for items worn on the body, and "Consumable" for food/fuel/water. For category use one of: Shelter, Sleep, Cook, Water, Pack, Clothing, Electronics, Hygiene, Navigation, Safety, Misc.`,
          },
          {
            role: "user",
            content: `Provide weight, price, type, and category for this hiking/backpacking gear item: "${name.trim()}"`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "gear_details",
              description: "Return gear item details with weight, price, type, and category",
              parameters: {
                type: "object",
                properties: {
                  weight_oz: { type: "number", description: "Weight in ounces" },
                  price_usd: { type: "number", description: "Typical retail price in USD" },
                  type: { type: "string", enum: ["Base", "Worn", "Consumable"] },
                  category: { type: "string", enum: ["Shelter", "Sleep", "Cook", "Water", "Pack", "Clothing", "Electronics", "Hygiene", "Navigation", "Safety", "Misc"] },
                },
                required: ["weight_oz", "price_usd", "type", "category"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "gear_details" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ error: "No AI response" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = JSON.parse(toolCall.function.arguments);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("gear-ai error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
