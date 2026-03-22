import { useState, useMemo } from 'react';
import { type GearItem, type WeightUnit, CATEGORY_ORDER, CATEGORY_COLORS, convertWeight, calcStats } from '@/lib/data';
import { StatCard } from '@/components/shared/StatCard';
import { GearModal } from './GearModal';
import { Search, Pencil, Trash2 } from 'lucide-react';

interface Props {
  gear: GearItem[];
  unit: WeightUnit;
  onUnitChange: (u: WeightUnit) => void;
  onAdd: (item: Omit<GearItem, 'id'>) => void;
  onEdit: (id: string, item: Omit<GearItem, 'id'>) => void;
  onDelete: (id: string) => void;
}

export function GearLocker({ gear, unit, onUnitChange, onAdd, onEdit, onDelete }: Props) {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<'category' | 'weight' | 'name'>('category');
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<GearItem | null>(null);

  const stats = useMemo(() => calcStats(gear), [gear]);

  const filtered = useMemo(() => {
    let items = gear.filter(g => g.name.toLowerCase().includes(search.toLowerCase()) || g.category.toLowerCase().includes(search.toLowerCase()));
    if (sortField === 'weight') items = [...items].sort((a, b) => (b.weight * b.qty) - (a.weight * a.qty));
    else if (sortField === 'name') items = [...items].sort((a, b) => a.name.localeCompare(b.name));
    return items;
  }, [gear, search, sortField]);

  const grouped = useMemo(() => {
    const groups: Record<string, GearItem[]> = {};
    filtered.forEach(g => {
      if (!groups[g.category]) groups[g.category] = [];
      groups[g.category].push(g);
    });
    return groups;
  }, [filtered]);

  const handleSave = (item: Omit<GearItem, 'id'>) => {
    if (editItem) { onEdit(editItem.id, item); setEditItem(null); }
    else onAdd(item);
  };

  const units: WeightUnit[] = ['oz', 'g', 'lb'];

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h2 className="text-[1.8rem] font-bold tracking-tight">Gear Locker</h2>
          <p className="text-[0.8rem] text-granite mt-1">Your complete gear inventory</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-card/70 border border-border/40 rounded-lg overflow-hidden">
            {units.map(u => (
              <button key={u} onClick={() => onUnitChange(u)}
                className={`px-2.5 py-1.5 font-mono text-[0.7rem] transition-all ${unit === u ? 'bg-primary/20 text-moss-glow' : 'text-granite hover:text-snow'}`}>
                {u}
              </button>
            ))}
          </div>
          <button className="px-4 py-2 rounded-lg border border-border/40 bg-card/70 text-snow text-[0.8rem] font-semibold transition-all hover:border-border/60 active:scale-[0.97]">
            ⬇ Export CSV
          </button>
          <button onClick={() => { setEditItem(null); setModalOpen(true); }}
            className="px-4 py-2 rounded-lg bg-gradient-to-br from-moss to-moss-glow text-primary-foreground text-[0.8rem] font-semibold shadow-[0_4px_15px_hsla(140,35%,38%,0.25)] transition-all hover:shadow-[0_6px_20px_hsla(140,35%,38%,0.4)] hover:-translate-y-px active:scale-[0.97]">
            + Add Gear
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard value={convertWeight(stats.baseWeight, unit)} label="Base Weight" sub={unit} colorClass="text-amber" />
        <StatCard value={String(stats.totalItems)} label="Total Items" sub="in locker" colorClass="text-ice" />
        <StatCard value={convertWeight(stats.totalWeight, unit)} label="Total Pack" sub={`${unit} (skin-out)`} colorClass="text-moss-glow" />
        <StatCard value={`$${stats.totalCost.toLocaleString()}`} label="Total Value" sub="gear investment" />
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-granite" />
          <input
            className="w-full bg-card/70 border border-border/40 text-snow font-body text-[0.85rem] py-2.5 pl-10 pr-4 rounded-lg outline-none transition-colors focus:border-primary/50 placeholder:text-granite/50"
            placeholder="Search gear..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button onClick={() => setSortField('weight')} className={`px-3 py-2 rounded-lg border text-[0.75rem] font-semibold transition-all active:scale-[0.97] ${sortField === 'weight' ? 'border-primary/30 bg-primary/15 text-snow' : 'border-border/40 bg-card/70 text-granite hover:text-snow'}`}>Sort: Weight</button>
        <button onClick={() => setSortField('name')} className={`px-3 py-2 rounded-lg border text-[0.75rem] font-semibold transition-all active:scale-[0.97] ${sortField === 'name' ? 'border-primary/30 bg-primary/15 text-snow' : 'border-border/40 bg-card/70 text-granite hover:text-snow'}`}>Sort: Name</button>
      </div>

      <div className="bg-card/70 border border-border/40 rounded-2xl backdrop-blur-xl p-2 overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: '0 4px' }}>
          <thead>
            <tr>
              {['Item', 'Category', 'Type', 'Qty', 'Weight', 'Price', ''].map((h, i) => (
                <th key={h || i} className={`text-[0.65rem] font-semibold text-granite uppercase tracking-[0.12em] px-4 py-2 border-b border-border/40 ${i >= 3 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORY_ORDER.map(cat => {
              if (!grouped[cat]) return null;
              const catWeight = grouped[cat].reduce((s, g) => s + g.weight * g.qty, 0);
              return [
                <tr key={`header-${cat}`}>
                  <td colSpan={7} className="px-4 pt-3 pb-1">
                    <div className="flex items-center gap-2.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: CATEGORY_COLORS[cat] }} />
                      <h4 className="font-display text-[0.95rem] font-bold">{cat}</h4>
                      <span className="ml-auto font-mono text-[0.7rem] text-granite">{convertWeight(catWeight, unit)} {unit}</span>
                    </div>
                  </td>
                </tr>,
                ...grouped[cat].map(g => (
                  <tr key={g.id} className="group">
                    <td className="px-4 py-2.5 text-[0.85rem] rounded-l-lg bg-ridge/40 group-hover:bg-ridge/70 border-y border-l border-transparent group-hover:border-border/40 transition-colors">
                      <strong>{g.name}</strong>
                    </td>
                    <td className="px-4 py-2.5 bg-ridge/40 group-hover:bg-ridge/70 border-y border-transparent group-hover:border-border/40 transition-colors">
                      <span className="inline-block px-2 py-0.5 rounded-md text-[0.7rem] font-semibold text-primary-foreground opacity-90" style={{ background: CATEGORY_COLORS[g.category] }}>{g.category}</span>
                    </td>
                    <td className="px-4 py-2.5 bg-ridge/40 group-hover:bg-ridge/70 border-y border-transparent group-hover:border-border/40 transition-colors">
                      {g.type === 'Worn' && <span className="inline-block px-1.5 py-0.5 rounded text-[0.65rem] font-semibold bg-primary/15 text-moss-glow border border-primary/30">Worn</span>}
                      {g.type === 'Consumable' && <span className="inline-block px-1.5 py-0.5 rounded text-[0.65rem] font-semibold bg-accent/15 text-amber border border-accent/30">Consumable</span>}
                      {g.type === 'Base' && <span className="text-granite text-[0.75rem]">Base</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center font-mono text-[0.8rem] bg-ridge/40 group-hover:bg-ridge/70 border-y border-transparent group-hover:border-border/40 transition-colors">{g.qty}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[0.8rem] bg-ridge/40 group-hover:bg-ridge/70 border-y border-transparent group-hover:border-border/40 transition-colors">{convertWeight(g.weight * g.qty, unit)} {unit}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[0.8rem] text-granite bg-ridge/40 group-hover:bg-ridge/70 border-y border-transparent group-hover:border-border/40 transition-colors">${(g.price * g.qty).toFixed(0)}</td>
                    <td className="px-4 py-2.5 text-right rounded-r-lg bg-ridge/40 group-hover:bg-ridge/70 border-y border-r border-transparent group-hover:border-border/40 transition-colors">
                      <button onClick={() => { setEditItem(g); setModalOpen(true); }} className="p-1 text-granite/50 hover:text-snow transition-colors"><Pencil size={14} /></button>
                      <button onClick={() => onDelete(g.id)} className="p-1 text-granite/50 hover:text-danger-glow transition-colors"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))
              ];
            })}
          </tbody>
        </table>
      </div>

      <GearModal open={modalOpen} onClose={() => { setModalOpen(false); setEditItem(null); }} onSave={handleSave} editItem={editItem} />
    </div>
  );
}
