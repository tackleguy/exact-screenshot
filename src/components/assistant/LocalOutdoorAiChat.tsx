"use client";

import { useState, useRef, useEffect } from "react";

interface ChatMessage {
  id: string;
  sender: "user" | "ai";
  text: string;
  timestamp: string;
}

const PRESET_PROMPTS = [
  "How do I prepare for my first Colorado 14er?",
  "What is the gear checklist for an 8,000m peak or Everest Base Camp?",
  "What are the Seven Summits and their difficulty rankings?",
  "How should I plan resupply on the Colorado Trail or JMT?",
  "How do I prevent altitude sickness above 10,000 feet?",
  "How can I reduce my base pack weight under 15 lbs?",
];

function generateLocalOutdoorAiResponse(query: string): string {
  const q = query.toLowerCase();

  if (q.includes("14er") || q.includes("fourteener") || q.includes("elbert") || q.includes("massive") || q.includes("quandary")) {
    return `### Colorado & US 14er Summit Guide 🏔️

**1. The "Start Early, Summit Early" Rule:**
- **Lightning Hazard:** In the Rocky Mountains, dangerous summer thunderstorms routinely form between 12:00 PM and 1:00 PM. Plan to be **off the summit and below treeline (around 11,500 ft) by noon**.
- Standard alpine start: **4:00 AM – 5:30 AM** at the trailhead.

**2. Altitude & Acclimatization:**
- Spend at least 24–48 hours at 8,000–9,000 ft (e.g. Leadville, Silverthorne, Breckenridge) before attempting 14,000 ft.
- Drink 3–4 liters of water with electrolytes. Carry carbohydrates (chews, bars, dried fruit) — high altitude suppresses appetite while doubling caloric burn.

**3. Essential 14er Gear:**
- **Sturdy Boots / Trail Runners** with aggressive rock traction.
- **Layers:** Merino wool base layer, windproof fleece, ultralight down jacket, and hardshell rain/wind jacket. Temperatures at 14,000 ft can drop to freezing even in July.
- **Sun & Eye Protection:** UV radiation is 40% stronger at 14,000 ft. Polarized sunglasses (Cat 3 or 4) and zinc sunscreen.
- **Navigation:** Download offline GPS map & track, carry a charged headlamp with fresh batteries.

**4. Best Beginner 14ers:**
- *Quandary Peak* (East Ridge, Class 1, 6.75 mi, +3,450 ft)
- *Mount Bierstadt* (West Slopes, Class 2, 7 mi, +2,850 ft)
- *Mount Elbert* (Northeast Ridge, Class 1, 9.5 mi, +4,700 ft — Highest in Rocky Mtns!)`;
  }

  if (q.includes("8000") || q.includes("8,000") || q.includes("everest") || q.includes("k2") || q.includes("himalaya")) {
    return `### The 14 Eight-Thousanders & High Altitude Expeditions 🌏

Earth has exactly **fourteen independent peaks exceeding 8,000 meters (26,247 ft)** above sea level, located in the Himalayas and Karakoram ranges:

1. **Mount Everest** (8,849 m / 29,032 ft) – Nepal / Tibet
2. **K2** (8,611 m / 28,251 ft) – Pakistan / China (Savage Mountain)
3. **Kangchenjunga** (8,586 m / 28,169 ft) – Nepal / India
4. **Lhotse** (8,516 m / 27,940 ft) – Nepal / Tibet
5. **Makalu** (8,485 m / 27,838 ft) – Nepal / Tibet
6. **Cho Oyu** (8,188 m / 26,864 ft) – Nepal / Tibet (Most accessible 8000m)
7. **Dhaulagiri I** (8,167 m / 26,795 ft) – Nepal
8. **Manaslu** (8,163 m / 26,781 ft) – Nepal (Mountain of the Spirit)
9. **Nanga Parbat** (8,126 m / 26,660 ft) – Pakistan (4,500m Rupal Face)
10. **Annapurna I** (8,091 m / 26,545 ft) – Nepal (First 8000m summited, 1950)
11. **Gasherbrum I** (8,080 m / 26,509 ft) – Pakistan / China
12. **Broad Peak** (8,051 m / 26,414 ft) – Pakistan / China
13. **Gasherbrum II** (8,035 m / 26,362 ft) – Pakistan / China
14. **Shishapangma** (8,027 m / 26,335 ft) – Tibet (China)

**Key Expedition Principles:**
- **The Death Zone (>8,000 m):** Atmospheric pressure is 1/3 of sea level. Human physiology cannot adapt; tissue begins to deteriorate. Supplemental oxygen (bottled O2 with high-flow regulator) is standard.
- **Acclimatization Rotations:** Climbers hike up to Camp 1, sleep, ascend to Camp 2, and return to Base Camp to recuperate before a summit push.
- **Weather Windows:** Spring (April–May pre-monsoon) and Autumn (September–October post-monsoon) provide narrow high-pressure windows with low jet-stream wind speeds (<20 knots).`;
  }

  if (q.includes("seven summit") || q.includes("7 summit") || q.includes("aconcagua") || q.includes("denali") || q.includes("kilimanjaro") || q.includes("elbrus") || q.includes("vinson")) {
    return `### The Seven Summits (Highest Peak on Each Continent) 👑

Climbing the highest summit on each of the seven continents is mountaineering's ultimate global grand slam:

| Continent | Peak | Elevation | Country / Range | Standard Difficulty |
| :--- | :--- | :--- | :--- | :--- |
| **Asia** | **Mount Everest** | 29,032 ft (8,849 m) | Nepal / Tibet, Himalayas | Extreme Glaciated (Oxygen required) |
| **South America** | **Aconcagua** | 22,838 ft (6,961 m) | Argentina, Andes | High Altitude Trekking (Extreme wind) |
| **North America** | **Denali** | 20,310 ft (6,190 m) | Alaska, USA (Alaska Range) | Arctic Glaciated (Heavy sleds, crevasses) |
| **Africa** | **Kilimanjaro** | 19,341 ft (5,895 m) | Tanzania (Volcanic Uhuru Peak) | Non-technical High Altitude Hike |
| **Europe** | **Mount Elbrus** | 18,510 ft (5,642 m) | Russia (Caucasus Mountains) | Glaciated Snow & Ice Climb |
| **Antarctica** | **Mount Vinson** | 16,050 ft (4,892 m) | Sentinel Range, Ellsworth Land | Polar Glaciated (Sub-zero cold) |
| **Oceania** | **Carstensz Pyramid** | 16,024 ft (4,884 m) | Papua, Indonesia (Sudirman Range)| Technical Limestone Rock (Class 5) |
| *Australia (Bass)* | *Mount Kosciuszko* | *7,310 ft (2,228 m)* | *New South Wales, Australia* | *Scenic Alpine Day Hike (Class 1)* |

**Preparation Progression:**
Start with **Mount Kosciuszko** and **Kilimanjaro**, progress to **Elbrus** and **Aconcagua**, master technical glacier mountaineering on **Denali**, and culminate with **Everest** and **Carstensz Pyramid**.`;
  }

  if (q.includes("thru") || q.includes("resupply") || q.includes("colorado trail") || q.includes("jmt") || q.includes("pct") || q.includes("appalachian") || q.includes("section")) {
    return `### Thru-Hike & Section Resupply Strategy 🥾

**1. The All-Together vs. Section Hike Distinction:**
- **Thru-Hike (All Together):** Completing the entire continuous corridor end-to-end in a single season. Requires comprehensive 3–6 month logistical planning, town resupply boxes, and permit sequencing.
- **Section Hiking:** Breaking the trail down into manageable 3 to 14-day segments. Allows flexible scheduling, peak seasonal weather selection, and lower pack carry weights.

**2. Food & Caloric Planning:**
- Plan for **1.5 to 2.2 lbs (0.7–1.0 kg) of food per day** (approx. 3,500–4,500 kcal/day).
- Focus on caloric density: **≥125 calories per ounce** (nuts, olive oil, peanut butter, dehydrated meals, chocolate, tortillas).
- Keep maximum continuous food carries to **≤5–6 days** whenever possible to avoid excessive pack weight.

**3. Popular Resupply Gateways:**
- **Colorado Trail (486 mi):** Breckenridge (mi 104), Leadville (mi 143), Twin Lakes (mi 177), Buena Vista / Salida (mi 253), Creede (mi 343), Silverton (mi 411).
- **John Muir Trail (211 mi):** Tuolumne Meadows (mi 23), Red's Meadow (mi 60), Vermilion Valley Resort / Muir Trail Ranch (mi 108 — critical final resupply before 110-mile High Sierra stretch to Whitney!).
- **Tahoe Rim Trail (165 mi):** Tahoe City (mi 0), Kingsbury Grade (mi 85), Echo Summit (mi 115).`;
  }

  if (q.includes("altitude") || q.includes("sickness") || q.includes("ams") || q.includes("headache") || q.includes("acclimatize")) {
    return `### Altitude Sickness (AMS) Prevention & Safety 🩺

**1. Golden Rules of Altitude Safety:**
- **"Climb High, Sleep Low":** Ascend to higher elevation during the day for acclimatization hikes, then sleep at a lower elevation.
- **Rule of Thumb above 10,000 ft:** Limit net sleeping elevation gains to no more than **1,000 to 1,500 ft (300–500 m) per night**, with a rest day every 3–4 days.
- **Never Ascend with Symptoms:** If you experience headache, nausea, fatigue, or dizziness, stop ascending.

**2. Hydration & Fueling:**
- The respiratory rate doubles at altitude, causing rapid insensible water loss in dry alpine air. Drink **4 liters daily**.
- Avoid alcohol and sedatives, which suppress nocturnal breathing and exacerbate hypoxemia.

**3. Medication & Supplements:**
- **Acetazolamide (Diamox):** Carbonic anhydrase inhibitor that speeds up natural acclimatization by stimulating breathing. Consult a physician (standard dosage: 125mg twice daily, started 24h prior to ascent).
- **Ibuprofen (Advil):** Effective for altitude-induced headaches and mild brain swelling.

**4. When to Evacuate (HAPE & HACE):**
- **HAPE (High Altitude Pulmonary Edema):** Persistent cough, breathlessness at rest, pink sputum, gurgling in chest.
- **HACE (High Altitude Cerebral Edema):** Severe ataxia (inability to walk a straight line), confusion, hallucinations.
- **The Only Cure:** Immediate descent of at least 2,000–3,000 ft. Do not delay.`;
  }

  if (q.includes("weight") || q.includes("ultralight") || q.includes("pack") || q.includes("gear") || q.includes("cut")) {
    return `### Ultralight Backpacking: The "Big Three" Overhaul 🎒

To get your base pack weight (pack weight excluding food, water, and fuel) under 15 lbs, focus 80% of your attention on the **Big Three**:

**1. Shelter (Target: ≤ 2.0 lbs):**
- Swap traditional heavy double-wall tents (4–6 lbs) for trekking-pole supported shelters (e.g. DCF / silpoly tents like Zpacks Duplex, Durston X-Mid, or Gossamer Gear The One).
- Saves: **2.5 – 4.0 lbs instantly.**

**2. Sleep System (Target: ≤ 2.5 lbs):**
- **Quilt vs. Mummy Bag:** A down quilt (850–950 fill power, 20°F rating) weighs 18–22 oz because it eliminates the crushed bottom insulation and heavy zippers.
- **Sleeping Pad:** Use a lightweight insulated pad (Therm-a-Rest NeoAir XLite NXT, R-value 4.5, 12.5 oz).
- Saves: **1.5 – 3.0 lbs.**

**3. Backpack (Target: ≤ 2.0 lbs):**
- Transition from heavy 65L suspension packs (4.5–6.0 lbs) to a framed ultralight pack (e.g. Hyperlite Mountain Gear 2400, Gossamer Gear Mariposa, ULA Circuit at 28–34 oz).
- Saves: **2.0 – 3.5 lbs.**

**4. The 10 Essentials Weight Audit:**
- Use a micro-stove (BRS 3000T at 0.9 oz or MSR PocketRocket 2 at 2.6 oz) and 550ml titanium pot (2.8 oz).
- Water filter: Sawyer Squeeze (3 oz) instead of heavy pump filters (14 oz).
- Headlamp: Rechargeable Nitecore NU25 (1.5 oz).`;
  }

  return `### Hyked Outdoor AI Intelligence 🌲

I analyzed your query: **"${query}"**

**Expert Recommendation:**
- **Navigation:** Always download GPS tracks offline and carry a physical backup compass in remote alpine zones.
- **Terrain & Permits:** For through-hikes and prominent 14ers/summits, verify seasonal permits and bear canister requirements (compulsory across Sierra Nevada, Yosemite, and parts of the Rockies).
- **Weather Watch:** Check barometric pressure trends. A rapid drop of >3 hPa in 3 hours indicates an incoming mountain storm front.
- **Leave No Trace:** Pack out all trash, camp on durable surfaces ≥200 ft from lakes and streams, and respect wildlife.

Feel free to ask about specific **14ers**, **8,000m peaks**, **Seven Summits**, **thru-hikes**, resupply logistics, or pack weight optimization!`;
}

export function LocalOutdoorAiChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      sender: "ai",
      text: "👋 Hi! I am your **Hyked Local Outdoor AI Assistant**. I can help you plan through-hikes, prepare for Colorado 14ers and 8,000m summits, analyze pack weights, and check safety protocols. Ask me anything!",
      timestamp: "Just now",
    },
  ]);
  const [isThinking, setIsThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  const handleSend = (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || isThinking) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: "user",
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInput("");
    setIsThinking(true);

    setTimeout(() => {
      const responseText = generateLocalOutdoorAiResponse(text);
      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: "ai",
        text: responseText,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, aiMsg]);
      setIsThinking(false);
    }, 600);
  };

  return (
    <>
      {/* Floating Action Button */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          position: "fixed",
          bottom: "1.75rem",
          right: "1.75rem",
          zIndex: 9999,
          background: "linear-gradient(135deg, #0284c7 0%, #0f766e 100%)",
          color: "#ffffff",
          border: "none",
          borderRadius: "9999px",
          padding: "0.85rem 1.25rem",
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3)",
          cursor: "pointer",
          fontWeight: 600,
          fontSize: "0.95rem",
          transition: "transform 0.2s ease, box-shadow 0.2s ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        aria-label="Toggle Outdoor AI Assistant"
      >
        <span style={{ fontSize: "1.2rem" }}>🧭</span>
        <span>Local Outdoor AI</span>
        <span
          style={{
            background: "#22c55e",
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            display: "inline-block",
          }}
        />
      </button>

      {/* Floating Chat Window Modal */}
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: "5rem",
            right: "1.75rem",
            width: "min(420px, calc(100vw - 2.5rem))",
            height: "min(580px, calc(100vh - 7rem))",
            zIndex: 9999,
            background: "var(--surface-elevated, #0f172a)",
            border: "1px solid var(--border, #334155)",
            borderRadius: "16px",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.6)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            color: "var(--cream, #f8fafc)",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "1rem 1.25rem",
              background: "linear-gradient(135deg, rgba(2, 132, 199, 0.2) 0%, rgba(15, 118, 110, 0.2) 100%)",
              borderBottom: "1px solid var(--border, #334155)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "1.25rem" }}>🧭</span>
                <strong style={{ fontSize: "1.05rem" }}>Hyked Outdoor AI</strong>
              </div>
              <div style={{ fontSize: "0.75rem", color: "#38bdf8", marginTop: "0.15rem" }}>
                Active on device · Offline capable · 14ers & Summits
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                fontSize: "1.25rem",
                cursor: "pointer",
                padding: "0.25rem 0.5rem",
                borderRadius: "6px",
              }}
              aria-label="Close Assistant"
            >
              ✕
            </button>
          </div>

          {/* Quick Prompts */}
          <div
            style={{
              padding: "0.6rem 0.75rem",
              display: "flex",
              gap: "0.5rem",
              overflowX: "auto",
              whiteSpace: "nowrap",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(0,0,0,0.15)",
            }}
          >
            {PRESET_PROMPTS.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSend(prompt)}
                style={{
                  fontSize: "0.75rem",
                  padding: "0.35rem 0.7rem",
                  borderRadius: "9999px",
                  background: "rgba(56, 189, 248, 0.12)",
                  color: "#38bdf8",
                  border: "1px solid rgba(56, 189, 248, 0.25)",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                {prompt}
              </button>
            ))}
          </div>

          {/* Messages Container */}
          <div
            style={{
              flex: 1,
              padding: "1rem",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "0.85rem",
            }}
          >
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
                  maxWidth: "92%",
                  padding: "0.75rem 1rem",
                  borderRadius: m.sender === "user" ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                  background: m.sender === "user" ? "#0284c7" : "rgba(30, 41, 59, 0.9)",
                  border: m.sender === "user" ? "none" : "1px solid rgba(255, 255, 255, 0.08)",
                  fontSize: "0.88rem",
                  lineHeight: 1.5,
                  wordBreak: "break-word",
                }}
              >
                <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
                <div
                  style={{
                    fontSize: "0.7rem",
                    color: m.sender === "user" ? "rgba(255,255,255,0.7)" : "#64748b",
                    marginTop: "0.35rem",
                    textAlign: "right",
                  }}
                >
                  {m.timestamp}
                </div>
              </div>
            ))}
            {isThinking && (
              <div
                style={{
                  alignSelf: "flex-start",
                  padding: "0.6rem 0.9rem",
                  borderRadius: "14px 14px 14px 2px",
                  background: "rgba(30, 41, 59, 0.9)",
                  fontSize: "0.85rem",
                  color: "#38bdf8",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <span>Evaluating terrain & elevation...</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            style={{
              padding: "0.75rem 1rem",
              borderTop: "1px solid var(--border, #334155)",
              display: "flex",
              gap: "0.5rem",
              background: "rgba(0, 0, 0, 0.2)",
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about 14ers, summits, through-hikes..."
              style={{
                flex: 1,
                background: "rgba(15, 23, 42, 0.8)",
                border: "1px solid var(--border, #334155)",
                borderRadius: "8px",
                padding: "0.6rem 0.85rem",
                color: "#f8fafc",
                fontSize: "0.88rem",
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={!input.trim() || isThinking}
              style={{
                background: "#0284c7",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                padding: "0.6rem 1rem",
                fontWeight: 600,
                fontSize: "0.88rem",
                cursor: input.trim() && !isThinking ? "pointer" : "not-allowed",
                opacity: input.trim() && !isThinking ? 1 : 0.6,
              }}
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
