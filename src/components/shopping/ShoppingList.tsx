import { useState } from 'react';
import { type ShopItem } from '@/lib/data';
import { Check, Trash2 } from 'lucide-react';

interface Props {
  items: ShopItem[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: (item: Omit<ShopItem, 'id'>) => void;
}

export function ShoppingList({ items, onToggle, onDelete, onAdd }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [store, setStore] = useState('');
  const [priority, setPriority] = useState<'High' | 'Medium' | 'Low'>('Medium');

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
        <button onClick={() => setModalOpen(true)} className="px-4 py-2 rounded-lg bg-gradient-to-br from-moss to-moss-glow text-primary-foreground text-[0.8rem] font-semibold shadow-[0_4px_15px_hsla(140,35%,38%,0.25)] transition-all hover:shadow-[0_6px_20px_hsla(140,35%,38%,0.4)] hover:-translate-y-px active:scale-[0.97]">
          + Add to Shopping List
        </button>
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
    </div>
  );
}
