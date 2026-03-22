import { useState } from 'react';
import { type GearItem, type WeightUnit, CATEGORY_ORDER, CATEGORY_COLORS, convertWeight } from '@/lib/data';
import { Check } from 'lucide-react';

interface Props {
  gear: GearItem[];
  unit: WeightUnit;
}

export function PackingList({ gear, unit }: Props) {
  const [packed, setPacked] = useState<Record<string, boolean>>({});

  const toggle = (id: string) => setPacked(prev => ({ ...prev, [id]: !prev[id] }));
  const uncheckAll = () => setPacked({});

  const grouped: Record<string, GearItem[]> = {};
  gear.forEach(g => { if (!grouped[g.category]) grouped[g.category] = []; grouped[g.category].push(g); });

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h2 className="text-[1.8rem] font-bold tracking-tight">Packing List</h2>
          <p className="text-[0.8rem] text-granite mt-1">Check off items as you pack</p>
        </div>
        <div className="flex gap-2">
          <button onClick={uncheckAll} className="px-3 py-2 rounded-lg border border-border/40 bg-card/70 text-snow text-[0.75rem] font-semibold transition-all hover:border-border/60 active:scale-[0.97]">Uncheck All</button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CATEGORY_ORDER.map(cat => {
          if (!grouped[cat]) return null;
          const items = grouped[cat];
          const packedCount = items.filter(g => packed[g.id]).length;
          return (
            <div key={cat} className="bg-card/70 border border-border/40 rounded-2xl backdrop-blur-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: CATEGORY_COLORS[cat] }} />
                <h4 className="font-display text-[0.95rem] font-bold flex-1">{cat}</h4>
                <span className="font-mono text-[0.7rem] text-granite">{packedCount}/{items.length}</span>
              </div>
              {items.map(g => (
                <div key={g.id} className="flex items-center gap-2 py-1.5 text-[0.8rem]">
                  <button
                    onClick={() => toggle(g.id)}
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${packed[g.id] ? 'bg-moss-glow border-moss-glow' : 'border-granite'}`}
                  >
                    {packed[g.id] && <Check size={10} className="text-primary-foreground" strokeWidth={3} />}
                  </button>
                  <span className={`flex-1 ${packed[g.id] ? 'line-through opacity-50' : ''}`}>
                    {g.name}{g.qty > 1 ? ` (×${g.qty})` : ''}
                  </span>
                  <span className="font-mono text-[0.7rem] text-granite">{convertWeight(g.weight * g.qty, unit)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
