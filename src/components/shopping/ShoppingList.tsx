import { useState } from 'react';
import { type ShopItem } from '@/lib/data';
import { useAuth } from '@/contexts/AuthContext';
import { getTierLimits } from '@/lib/tierGating';
import { Check, Trash2, Sparkles, Lock } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  items: ShopItem[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: (item: Omit<ShopItem, 'id'>) => void;
}

const AI_TRIP_TEMPLATES: Record<string, Omit<ShopItem, 'id'>[]> = {
  'Weekend Backpacking': [
    { name: 'Freeze-dried meals (4 pack)', price: 36, store: 'REI', priority: 'High', purchased: false },
    { name: 'Water filter (Sawyer Squeeze)', price: 35, store: 'Amazon', priority: 'High', purchased: false },
    { name: 'Fire starter kit', price: 8, store: 'REI', priority: 'Medium', purchased: false },
    { name: 'Blister kit', price: 12, store: 'Amazon', priority: 'Medium', purchased: false },
    { name: 'Trail snacks variety pack', price: 18, store: 'Trader Joe\'s', priority: 'High', purchased: false },
    { name: 'Electrolyte packets (12ct)', price: 14, store: 'Amazon', priority: 'Low', purchased: false },
  ],
  'Thru-Hike Resupply': [
    { name: 'Ramen variety (12 pack)', price: 12, store: 'Walmart', priority: 'High', purchased: false },
    { name: 'Peanut butter (squeeze tube)', price: 6, store: 'Walmart', priority: 'High', purchased: false },
    { name: 'Tortillas (10 pack)', price: 4, store: 'Walmart', priority: 'High', purchased: false },
    { name: 'Olive oil (travel bottle)', price: 5, store: 'Amazon', priority: 'Medium', purchased: false },
    { name: 'Instant coffee packets (20ct)', price: 15, store: 'Amazon', priority: 'High', purchased: false },
    { name: 'Body Glide anti-chafe', price: 10, store: 'REI', priority: 'Medium', purchased: false },
    { name: 'Leukotape (foot care)', price: 12, store: 'Amazon', priority: 'High', purchased: false },
    { name: 'Replacement insoles', price: 25, store: 'REI', priority: 'Low', purchased: false },
  ],
  'Winter Camping': [
    { name: 'Hand warmers (10 pack)', price: 8, store: 'Amazon', priority: 'High', purchased: false },
    { name: 'Balaclava', price: 22, store: 'REI', priority: 'High', purchased: false },
    { name: 'Insulated water bottle', price: 35, store: 'REI', priority: 'High', purchased: false },
    { name: 'White gas fuel (1L)', price: 10, store: 'REI', priority: 'High', purchased: false },
    { name: 'Wool liner gloves', price: 18, store: 'Amazon', priority: 'Medium', purchased: false },
    { name: 'Thermos for hot drinks', price: 28, store: 'REI', priority: 'Medium', purchased: false },
  ],
  'Ultralight Day Hike': [
    { name: 'Energy gels (6 pack)', price: 12, store: 'REI', priority: 'High', purchased: false },
    { name: 'Collapsible water bottle', price: 14, store: 'Amazon', priority: 'Medium', purchased: false },
    { name: 'Lightweight rain poncho', price: 15, store: 'Amazon', priority: 'Medium', purchased: false },
    { name: 'Trail mix (bulk bag)', price: 8, store: 'Trader Joe\'s', priority: 'High', purchased: false },
    { name: 'Sunscreen stick SPF 50', price: 10, store: 'Amazon', priority: 'Low', purchased: false },
  ],
};

const AI_USAGE_KEY = 'trailpack_ai_shopping_usage';

function getAiUsageThisMonth(): number {
  const stored = localStorage.getItem(AI_USAGE_KEY);
  if (!stored) return 0;
  try {
    const { count, month } = JSON.parse(stored);
    const currentMonth = new Date().toISOString().slice(0, 7);
    return month === currentMonth ? count : 0;
  } catch { return 0; }
}

function incrementAiUsage() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const current = getAiUsageThisMonth();
  localStorage.setItem(AI_USAGE_KEY, JSON.stringify({ count: current + 1, month: currentMonth }));
}

export function ShoppingList({ items, onToggle, onDelete, onAdd }: Props) {
  const { profile } = useAuth();
  const limits = getTierLimits(profile?.tier);
  const [modalOpen, setModalOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [store, setStore] = useState('');
  const [priority, setPriority] = useState<'High' | 'Medium' | 'Low'>('Medium');
  const aiUsedThisMonth = getAiUsageThisMonth();
  const canUseAi = aiUsedThisMonth < limits.aiShoppingListsPerMonth;

  const remaining = items.filter(s => !s.purchased);
  const purchased = items.filter(s => s.purchased);
  const totalRemaining = remaining.reduce((s, i) => s + i.price, 0);
  const totalPurchased = purchased.reduce((s, i) => s + i.price, 0);

  const handleSave = () => {
    if (!name.trim()) return;
    onAdd({ name: name.trim(), price: parseFloat(price) || 0, store: store.trim() || 'TBD', priority, purchased: false });
    setName(''); setPrice(''); setStore(''); setPriority('Medium'); setModalOpen(false);
  };

  const inputClass = "w-full bg-background/60 border border-border/40 text-snow font-body text-[0.85rem] px-3 py-2.5 rounded-lg outline-none transition-colors focus:border-primary/50";
  const labelClass = "block text-[0.7rem] font-semibold text-granite uppercase tracking-[0.1em] mb-1";

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h2 className="text-[1.8rem] font-bold tracking-tight">Shopping List</h2>
          <p className="text-[0.8rem] text-granite mt-1">Gear you need to buy</p>
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => {
              if (limits.aiShoppingListsPerMonth === 0) { toast.error('AI Shopping Lists are a Summit feature. Upgrade to use them.'); return; }
              if (!canUseAi) { toast.error(`You've used all ${limits.aiShoppingListsPerMonth} AI shopping lists this month. Upgrade to Thru-Hiker for unlimited.`); return; }
              setAiModalOpen(true);
            }}
            className={`px-4 py-2 rounded-lg text-[0.8rem] font-semibold transition-all active:scale-[0.97] flex items-center gap-1.5 ${
              limits.aiShoppingListsPerMonth > 0 && canUseAi
                ? 'bg-gradient-to-br from-amber to-amber-glow text-peak shadow-[0_4px_15px_hsla(35,80%,50%,0.25)] hover:shadow-[0_6px_20px_hsla(35,80%,50%,0.4)] hover:-translate-y-px'
                : 'bg-secondary text-granite cursor-not-allowed'
            }`}
          >
            {limits.aiShoppingListsPerMonth > 0 ? <Sparkles size={14} /> : <Lock size={14} />}
            AI Shopping List
          </button>
          {limits.aiShoppingListsPerMonth > 0 && limits.aiShoppingListsPerMonth !== Infinity && (
            <span className="text-[0.7rem] text-granite">{aiUsedThisMonth}/{limits.aiShoppingListsPerMonth} this month</span>
          )}
          <button onClick={() => setModalOpen(true)} className="px-4 py-2 rounded-lg bg-gradient-to-br from-moss to-moss-glow text-primary-foreground text-[0.8rem] font-semibold shadow-[0_4px_15px_hsla(140,35%,38%,0.25)] transition-all hover:shadow-[0_6px_20px_hsla(140,35%,38%,0.4)] hover:-translate-y-px active:scale-[0.97]">
            + Add Item
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="bg-card/70 border border-border/40 rounded-2xl backdrop-blur-xl p-4">
          {items.length === 0 && <div className="py-8 text-center text-granite">No items in shopping list</div>}
          {items.map(item => (
            <div key={item.id} className={`flex items-center gap-3 px-4 py-3 rounded-lg mb-1 transition-all border border-transparent hover:border-border/40 ${item.purchased ? 'opacity-50' : ''}`} style={{ background: 'hsla(213,32%,15%,0.4)' }}>
              <button onClick={() => onToggle(item.id)}
                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${item.purchased ? 'bg-moss-glow border-moss-glow' : 'border-granite'}`}>
                {item.purchased && <Check size={12} className="text-primary-foreground" strokeWidth={3} />}
              </button>
              <span className={`flex-1 text-[0.85rem] ${item.purchased ? 'line-through' : ''}`}>{item.name}</span>
              <span className="text-[0.7rem] text-granite px-2 py-0.5 rounded bg-foreground/5 border border-border/40">{item.store}</span>
              <span className="font-mono text-[0.8rem] text-amber">${item.price.toFixed(2)}</span>
              <button onClick={() => onDelete(item.id)} className="p-1 text-granite/50 hover:text-danger-glow transition-colors"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        <div className="bg-card/70 border border-border/40 rounded-2xl backdrop-blur-xl p-6 sticky top-24 self-start">
          <h4 className="font-display mb-4">Summary</h4>
          <div className="flex justify-between py-2 text-[0.85rem] border-b border-border/40">
            <span>Remaining ({remaining.length})</span><span>${totalRemaining.toFixed(2)}</span>
          </div>
          <div className="flex justify-between py-2 text-[0.85rem] border-b border-border/40">
            <span>Purchased ({purchased.length})</span><span>${totalPurchased.toFixed(2)}</span>
          </div>
          <div className="flex justify-between pt-3 text-[1rem] font-bold">
            <span>Total Budget</span><span className="font-mono text-amber">${(totalRemaining + totalPurchased).toFixed(2)}</span>
          </div>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/85 backdrop-blur-lg" onClick={() => setModalOpen(false)}>
          <div className="bg-ridge border border-border/40 rounded-2xl p-8 w-[90%] max-w-[520px]" onClick={e => e.stopPropagation()}>
            <h3 className="text-[1.3rem] mb-6">Add Shopping Item</h3>
            <div className="mb-4"><label className={labelClass}>Item Name</label><input className={inputClass} value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Sawyer Squeeze Filter" /></div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div><label className={labelClass}>Price ($)</label><input className={inputClass} type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="34.99" /></div>
              <div><label className={labelClass}>Store / Source</label><input className={inputClass} value={store} onChange={e => setStore(e.target.value)} placeholder="REI, Amazon..." /></div>
            </div>
            <div className="mb-6">
              <label className={labelClass}>Priority</label>
              <select className={inputClass} value={priority} onChange={e => setPriority(e.target.value as 'High' | 'Medium' | 'Low')}>
                <option value="High">High — Essential</option>
                <option value="Medium">Medium — Nice to have</option>
                <option value="Low">Low — Upgrade</option>
              </select>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setModalOpen(false)} className="px-5 py-2.5 rounded-lg border border-border/40 bg-card/70 text-snow text-[0.8rem] font-semibold transition-all hover:border-border/60 active:scale-[0.97]">Cancel</button>
              <button onClick={handleSave} className="px-5 py-2.5 rounded-lg bg-gradient-to-br from-moss to-moss-glow text-primary-foreground text-[0.8rem] font-semibold shadow-[0_4px_15px_hsla(140,35%,38%,0.25)] transition-all hover:shadow-[0_6px_20px_hsla(140,35%,38%,0.4)] hover:-translate-y-px active:scale-[0.97]">Add Item</button>
            </div>
          </div>
        </div>
      )}

      {/* AI Shopping List Modal */}
      {aiModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/85 backdrop-blur-lg" onClick={() => setAiModalOpen(false)}>
          <div className="bg-ridge border border-border/40 rounded-2xl p-8 w-[90%] max-w-[560px]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={20} className="text-amber" />
              <h3 className="text-[1.3rem]">AI Shopping List</h3>
            </div>
            <p className="text-[0.8rem] text-granite mb-6">Select a trip type and we'll generate a curated shopping list for you.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries(AI_TRIP_TEMPLATES).map(([tripType, templateItems]) => (
                <button
                  key={tripType}
                  onClick={() => {
                    templateItems.forEach(item => onAdd(item));
                    incrementAiUsage();
                    setAiModalOpen(false);
                    toast.success(`Added ${templateItems.length} items for "${tripType}"`);
                  }}
                  className="text-left p-4 rounded-xl border border-border/40 bg-card/70 hover:border-amber/40 hover:bg-amber/5 transition-all group"
                >
                  <div className="font-display font-bold text-[0.9rem] mb-1 group-hover:text-amber transition-colors">{tripType}</div>
                  <div className="text-[0.7rem] text-granite">{templateItems.length} items · ${templateItems.reduce((s, i) => s + i.price, 0)} est.</div>
                </button>
              ))}
            </div>
            <div className="flex justify-end mt-6">
              <button onClick={() => setAiModalOpen(false)} className="px-5 py-2.5 rounded-lg border border-border/40 bg-card/70 text-snow text-[0.8rem] font-semibold transition-all hover:border-border/60 active:scale-[0.97]">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
