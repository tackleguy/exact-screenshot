import { useMemo } from 'react';
import { type GearItem, type WeightUnit, CATEGORY_COLORS, CATEGORY_ORDER, convertWeight, calcStats } from '@/lib/data';
import { StatCard } from '@/components/shared/StatCard';

interface Props {
  gear: GearItem[];
  unit: WeightUnit;
}

export function WeightAnalysis({ gear, unit }: Props) {
  const stats = useMemo(() => calcStats(gear), [gear]);

  const catWeights = useMemo(() => {
    const w: Record<string, number> = {};
    gear.forEach(g => { if (g.type === 'Base') w[g.category] = (w[g.category] || 0) + g.weight * g.qty; });
    return Object.entries(w).sort((a, b) => b[1] - a[1]);
  }, [gear]);

  const heaviest = useMemo(() =>
    [...gear].sort((a, b) => (b.weight * b.qty) - (a.weight * a.qty)).slice(0, 5),
    [gear]
  );

  const totalBase = stats.baseWeight || 1;
  const weightLabel = stats.baseWeight <= 160 ? '✅ Ultralight!' : stats.baseWeight <= 320 ? '🟡 Lightweight' : '🔴 Traditional';

  // SVG donut
  const r = 80, cx = 100, cy = 100;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const donutSegments = catWeights.map(([cat, w]) => {
    const pct = w / totalBase;
    const dashLen = circumference * pct;
    const seg = { cat, dashLen, gap: circumference - dashLen, offset: -offset, color: CATEGORY_COLORS[cat as keyof typeof CATEGORY_COLORS] || '#8b9daf' };
    offset += dashLen;
    return seg;
  });

  return (
    <div className="animate-fade-up">
      <div className="mb-6">
        <h2 className="text-[1.8rem] font-bold tracking-tight">Weight Analysis</h2>
        <p className="text-[0.8rem] text-granite mt-1">Visualize your pack weight distribution</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard value={convertWeight(stats.baseWeight, unit)} label="Base Weight" sub={weightLabel} colorClass="text-amber" />
        <StatCard value={convertWeight(stats.wornWeight, unit)} label="Worn Weight" sub={unit} colorClass="text-moss-glow" />
        <StatCard value={convertWeight(stats.consumableWeight, unit)} label="Consumables" sub={unit} colorClass="text-ice" />
        <StatCard value={convertWeight(stats.totalWeight, unit)} label="Total (Skin Out)" sub={unit} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 mb-8">
        <div className="bg-card/70 border border-border/40 rounded-2xl backdrop-blur-xl p-6">
          <h3 className="text-[1.1rem] mb-4">Weight Distribution by Category</h3>
          <div className="h-8 rounded-2xl overflow-hidden flex bg-background/60 border border-border/40 mb-4">
            {catWeights.map(([cat, w]) => (
              <div key={cat} className="h-full transition-all duration-700 first:rounded-l-2xl last:rounded-r-2xl"
                style={{ width: `${(w / totalBase * 100).toFixed(1)}%`, background: CATEGORY_COLORS[cat as keyof typeof CATEGORY_COLORS] || '#8b9daf' }}
                title={`${cat}: ${convertWeight(w, unit)} ${unit}`} />
            ))}
          </div>
          <div className="flex flex-wrap gap-4">
            {catWeights.map(([cat, w]) => (
              <div key={cat} className="flex items-center gap-2 text-[0.8rem] text-granite">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: CATEGORY_COLORS[cat as keyof typeof CATEGORY_COLORS] }} />
                {cat} — {convertWeight(w, unit)} {unit} ({(w / totalBase * 100).toFixed(1)}%)
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card/70 border border-border/40 rounded-2xl backdrop-blur-xl flex flex-col items-center justify-center p-4">
          <div className="relative w-44 h-44">
            <svg viewBox="0 0 200 200" className="-rotate-90">
              {donutSegments.map(seg => (
                <circle key={seg.cat} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color} strokeWidth={22}
                  strokeDasharray={`${seg.dashLen} ${seg.gap}`} strokeDashoffset={seg.offset} />
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <div className="font-mono text-[1.4rem] font-medium">{convertWeight(stats.baseWeight, unit)} {unit}</div>
              <div className="text-[0.65rem] text-granite uppercase tracking-[0.1em]">Base Weight</div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card/70 border border-border/40 rounded-2xl backdrop-blur-xl p-6">
        <h3 className="text-[1.1rem] mb-4">Top 5 Heaviest Items</h3>
        {heaviest.map((g, i) => {
          const pct = (g.weight * g.qty) / stats.totalWeight * 100;
          return (
            <div key={g.id} className="flex items-center gap-3 mb-2.5">
              <span className="font-mono text-[0.7rem] text-granite w-5">#{i + 1}</span>
              <span className="flex-1 text-[0.85rem]">{g.name}</span>
              <div className="w-48 h-2 bg-background/60 rounded overflow-hidden">
                <div className="h-full rounded" style={{ width: `${pct}%`, background: CATEGORY_COLORS[g.category] }} />
              </div>
              <span className="font-mono text-[0.8rem] w-20 text-right">{convertWeight(g.weight * g.qty, unit)} {unit}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
