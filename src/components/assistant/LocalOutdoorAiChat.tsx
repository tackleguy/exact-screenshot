"use client";

import { useState, useRef, useEffect } from "react";
import { Markdown } from "./Markdown";

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

export function generateLocalOutdoorAiResponse(query: string): string {
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
- Plan for **3,500 – 4,500 calories per day** (1.5 to 2.2 lbs of dry food per day).
- Target caloric density: **>120 calories per ounce** (nuts, olive oil, nut butters, dehydrated meals, chocolate).

**3. Town Resupply Spacing:**
- **Colorado Trail (486 mi):** Resupply towns spaced every 45–80 miles (Frisco/Breckenridge, Leadville, Buena Vista, Salida, Creede, Silverton).
- **John Muir Trail (211 mi):** Resupply at Tuolumne Meadows (mi 23), Red's Meadow (mi 60), and Muir Trail Ranch / Vermilion Valley Resort (mi 108). After MTR, you must carry 8–10 days of food to Mount Whitney. Bear canisters are legally mandatory.`;
  }

  if (q.includes("altitude") || q.includes("ams") || q.includes("sickness") || q.includes("headache") || q.includes("acclimat")) {
    return `### High Altitude Sickness (AMS) Protocol ⚠️

Acute Mountain Sickness (AMS) can affect anyone above 8,000 feet, regardless of physical fitness.

**1. Prevention ("Climb High, Sleep Low"):**
- Do not increase sleeping elevation by more than 1,000–1,500 feet per day above 9,000 ft.
- Take a rest day every 3–4 days.
- Hydration: 4–5 liters daily. Avoid alcohol and sedatives.

**2. Symptoms to Monitor:**
- **Mild AMS:** Throbbing headache, nausea, dizziness, fatigue, sleeplessness.
- **HAPE (High Altitude Pulmonary Edema):** Persistent cough, breathlessness at rest, gurgling in chest, pink sputum. *Immediate descent required!*
- **HACE (High Altitude Cerebral Edema):** Loss of coordination (ataxia), confusion, slurred speech. *Medical emergency — descend immediately!*

**3. The Golden Rules of Altitude Safety:**
1. Any illness at altitude is altitude sickness until proven otherwise.
2. Never ascend with symptoms of AMS.
3. If symptoms worsen, **DESCEND IMMEDIATELY (at least 2,000–3,000 feet)**.`;
  }

  if (q.includes("pack") || q.includes("weight") || q.includes("ultralight") || q.includes("gear") || q.includes("base weight")) {
    return `### Ultralight Backpacking & Base Weight Guide ⚖️

**1. Base Weight Categories:**
- **Traditional:** 20–30+ lbs base weight
- **Lightweight:** 15–20 lbs base weight
- **Ultralight (UL):** Under 10 lbs base weight

**2. The "Big Three" Overhaul (Save 5–10 lbs instantly):**
- **Shelter:** Switch from a 5 lb freestanding tent to an ultralight trekking-pole shelter (18–28 oz, e.g. DCF or silpoly).
- **Sleep System:** Replace synthetic 3.5 lb bag with a high-loft 850–950 fill down quilt (16–22 oz).
- **Backpack:** Once gear is compact, move from a 5 lb rigid frame pack to a lightweight frameless or minimal-frame pack (18–32 oz).

**3. Weigh Everything with a Kitchen Scale:**
- Track gear in ounces or grams. If you carried an item on your last 3 trips and never used it (excluding first aid & emergency gear), leave it home.

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

export function LocalOutdoorAiChat({
  onApplyPrompt,
}: {
  onApplyPrompt?: (prompt: string) => void;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      sender: "ai",
      text: "👋 Welcome to **Hyked Eco AI**, an eco-friendly outdoor assistant that runs entirely on your device: no data-center servers, no cloud compute per answer, and your questions stay private. Ask about Colorado 14ers, 8,000m summits, through-hike resupplies, pack weight reduction, or high-altitude safety.",
      timestamp: "Ready",
    },
  ]);
  const [isThinking, setIsThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }, 400);
  };

  return (
    <div
      className="planner-local-ai-card"
      style={{
        marginTop: "1.75rem",
        marginBottom: "1.75rem",
        background: "var(--surface-elevated, #161c24)",
        border: "1px solid var(--plan-line, #28313e)",
        borderRadius: "12px",
        overflow: "hidden",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.25)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "1rem 1.25rem",
          background: "linear-gradient(135deg, rgba(2, 132, 199, 0.15) 0%, rgba(15, 118, 110, 0.15) 100%)",
          borderBottom: "1px solid var(--plan-line, #28313e)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.75rem",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1.25rem" }}>🧭</span>
            <strong style={{ fontSize: "1.05rem", color: "var(--cream, #f8fafc)" }}>
              Hyked Eco AI
            </strong>
          </div>
          <div style={{ fontSize: "0.78rem", color: "var(--plan-muted, #94a3b8)", marginTop: "0.2rem" }}>
            Eco-friendly on-device model · 14ers, 8,000m summits, through-hikes & pack weight
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              fontSize: "0.75rem",
              padding: "0.25rem 0.6rem",
              borderRadius: "9999px",
              background: "rgba(34, 197, 94, 0.12)",
              color: "#4ade80",
              border: "1px solid rgba(34, 197, 94, 0.25)",
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "#22c55e",
                display: "inline-block",
              }}
            />
            Local Engine Active
          </span>
          {messages.length > 2 && (
            <button
              type="button"
              onClick={() =>
                setMessages([
                  {
                    id: "welcome",
                    sender: "ai",
                    text: "Chat cleared. What outdoor topic or route would you like to explore?",
                    timestamp: "Ready",
                  },
                ])
              }
              className="planner-link"
              style={{ fontSize: "0.78rem", minHeight: "auto", cursor: "pointer" }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Preset Prompt Chips */}
      <div
        style={{
          padding: "0.75rem 1.25rem",
          display: "flex",
          gap: "0.5rem",
          overflowX: "auto",
          whiteSpace: "nowrap",
          borderBottom: "1px solid var(--plan-line, #28313e)",
          background: "rgba(0, 0, 0, 0.1)",
        }}
      >
        {PRESET_PROMPTS.map((prompt, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSend(prompt)}
            style={{
              fontSize: "0.75rem",
              padding: "0.35rem 0.75rem",
              borderRadius: "9999px",
              background: "rgba(56, 189, 248, 0.08)",
              color: "#38bdf8",
              border: "1px solid rgba(56, 189, 248, 0.2)",
              cursor: "pointer",
              flexShrink: 0,
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(56, 189, 248, 0.16)";
              e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.4)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(56, 189, 248, 0.08)";
              e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.2)";
            }}
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Message Thread */}
      <div
        style={{
          maxHeight: "360px",
          minHeight: "180px",
          padding: "1.25rem",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
              maxWidth: m.sender === "user" ? "80%" : "96%",
              padding: "0.85rem 1.15rem",
              borderRadius: m.sender === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
              background: m.sender === "user" ? "var(--accent, #0284c7)" : "rgba(30, 41, 59, 0.75)",
              color: m.sender === "user" ? "#ffffff" : "var(--cream, #f8fafc)",
              border: m.sender === "user" ? "none" : "1px solid rgba(255, 255, 255, 0.06)",
              fontSize: "0.88rem",
              lineHeight: 1.6,
            }}
          >
            <Markdown text={m.text} />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "0.5rem",
                gap: "1rem",
                fontSize: "0.72rem",
                color: m.sender === "user" ? "rgba(255,255,255,0.7)" : "var(--plan-muted, #94a3b8)",
              }}
            >
              <span>{m.timestamp}</span>
              {m.sender === "ai" && onApplyPrompt && (
                <button
                  type="button"
                  onClick={() => {
                    const firstLine = m.text.split("\n")[0].replace(/[#*]/g, "").trim();
                    onApplyPrompt(firstLine || "Alpine trip in Colorado");
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#38bdf8",
                    cursor: "pointer",
                    textDecoration: "underline",
                    fontSize: "0.72rem",
                    padding: 0,
                  }}
                >
                  Apply to Trip Plan ↑
                </button>
              )}
            </div>
          </div>
        ))}

        {isThinking && (
          <div
            style={{
              alignSelf: "flex-start",
              padding: "0.6rem 0.9rem",
              borderRadius: "12px 12px 12px 2px",
              background: "rgba(30, 41, 59, 0.75)",
              fontSize: "0.85rem",
              color: "#38bdf8",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <span>Analyzing elevation, route conditions & gear profiles...</span>
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
          padding: "0.85rem 1.25rem",
          borderTop: "1px solid var(--plan-line, #28313e)",
          display: "flex",
          gap: "0.75rem",
          background: "rgba(0, 0, 0, 0.15)",
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Eco AI about 14ers, 8,000m giants, thru-hikes, altitude, gear..."
          style={{
            flex: 1,
            background: "var(--surface, #0f172a)",
            border: "1px solid var(--plan-line, #334155)",
            borderRadius: "6px",
            padding: "0.65rem 0.9rem",
            color: "var(--cream, #f8fafc)",
            fontSize: "0.88rem",
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={!input.trim() || isThinking}
          className="planner-button"
          style={{
            minHeight: "38px",
            padding: "0 1.25rem",
            fontSize: "0.84rem",
            cursor: input.trim() && !isThinking ? "pointer" : "not-allowed",
            opacity: input.trim() && !isThinking ? 1 : 0.6,
          }}
        >
          Ask AI
        </button>
      </form>
    </div>
  );
}
