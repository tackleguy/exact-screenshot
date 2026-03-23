import { useState, useEffect, useRef } from 'react';
import { type GearItem, type GearCategory, type GearType, CATEGORY_ORDER } from '@/lib/data';
import { supabase } from '@/integrations/supabase/client';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (item: Omit<GearItem, 'id'>) => void;
  editItem?: GearItem | null;
}

export function GearModal({ open, onClose, onSave, editItem }: Props) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<GearCategory>('Shelter');
  const [qty, setQty] = useState(1);
  const [weight, setWeight] = useState('');
  const [price, setPrice] = useState('');
  const [type, setType] = useState<GearType>('Base');
  const [link, setLink] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editItem) {
      setName(editItem.name);
      setCategory(editItem.category);
      setQty(editItem.qty);
      setWeight(String(editItem.weight));
      setPrice(String(editItem.price));
      setType(editItem.type);
      setLink(editItem.link);
    } else {
      setName(''); setCategory('Shelter'); setQty(1); setWeight(''); setPrice(''); setType('Base'); setLink('');
    }
  }, [editItem, open]);

  if (!open) return null;

  const fetchAiSuggestion = async (gearName: string) => {
    if (gearName.trim().length < 3) return;
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('gear-ai', {
        body: { name: gearName.trim() },
      });
      if (error) throw error;
      if (data && !data.error) {
        if (data.weight_oz != null) setWeight(String(Math.round(data.weight_oz * 10) / 10));
        if (data.price_usd != null) setPrice(String(Math.round(data.price_usd * 100) / 100));
        if (data.type && ['Base', 'Worn', 'Consumable'].includes(data.type)) setType(data.type);
        if (data.category && CATEGORY_ORDER.includes(data.category)) setCategory(data.category as GearCategory);
        toast.success('AI filled in gear details');
      } else if (data?.error) {
        toast.error(data.error);
      }
    } catch (e: any) {
      console.error('AI suggestion error:', e);
      toast.error('Could not get AI suggestion');
    } finally {
      setAiLoading(false);
    }
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (editItem) return; // Don't auto-fill when editing
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length >= 3) {
      debounceRef.current = setTimeout(() => fetchAiSuggestion(value), 800);
    }
  };

  const handleSave = () => {
    if (!name.trim() || !weight) return;
    onSave({ name: name.trim(), category, qty, weight: parseFloat(weight), price: parseFloat(price) || 0, type, link: link.trim() });
    onClose();
  };

  const inputClass = "w-full bg-background/60 border border-border/40 text-snow font-body text-[0.85rem] px-3 py-2.5 rounded-lg outline-none transition-colors focus:border-primary/50";
  const labelClass = "block text-[0.7rem] font-semibold text-granite uppercase tracking-[0.1em] mb-1";

  return (
    <div className={`fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-lg transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose}>
      <div className="bg-[hsl(210,25%,15%)] border border-[hsl(210,20%,30%)] rounded-2xl p-8 w-[90%] max-w-[520px] max-h-[85vh] overflow-y-auto transform transition-transform duration-300 shadow-[0_25px_60px_rgba(0,0,0,0.5)]" onClick={e => e.stopPropagation()}>
        <h3 className="text-[1.3rem] mb-6">{editItem ? 'Edit Gear' : 'Add New Gear'}</h3>
        <div className="mb-4">
          <label className={labelClass}>Item Name</label>
          <div className="relative">
            <input className={inputClass} value={name} onChange={e => handleNameChange(e.target.value)} placeholder="e.g., Nemo Tensor Sleeping Pad" />
            {aiLoading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Loader2 size={16} className="text-moss-glow animate-spin" />
              </div>
            )}
          </div>
          {!editItem && (
            <div className="flex items-center gap-1.5 mt-1.5 text-[0.65rem] text-granite">
              <Sparkles size={10} className="text-moss-glow" />
              <span>AI auto-fills weight, price, type & category as you type</span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className={labelClass}>Category</label>
            <select className={inputClass} value={category} onChange={e => setCategory(e.target.value as GearCategory)}>
              {CATEGORY_ORDER.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Quantity</label>
            <input className={inputClass} type="number" min={1} value={qty} onChange={e => setQty(parseInt(e.target.value) || 1)} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div>
            <label className={labelClass}>Weight (oz)</label>
            <input className={inputClass} type="number" step="0.1" value={weight} onChange={e => setWeight(e.target.value)} placeholder="16.0" />
          </div>
          <div>
            <label className={labelClass}>Price ($)</label>
            <input className={inputClass} type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="299.99" />
          </div>
          <div>
            <label className={labelClass}>Type</label>
            <select className={inputClass} value={type} onChange={e => setType(e.target.value as GearType)}>
              <option value="Base">Base Weight</option>
              <option value="Worn">Worn</option>
              <option value="Consumable">Consumable</option>
            </select>
          </div>
        </div>
        <div className="mb-6">
          <label className={labelClass}>Link / Notes</label>
          <input className={inputClass} value={link} onChange={e => setLink(e.target.value)} placeholder="Optional URL or notes" />
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 rounded-lg border border-border/40 bg-card/70 text-snow text-[0.8rem] font-semibold transition-all hover:border-border/60 active:scale-[0.97]">Cancel</button>
          <button onClick={handleSave} className="px-5 py-2.5 rounded-lg bg-gradient-to-br from-moss to-moss-glow text-primary-foreground text-[0.8rem] font-semibold shadow-[0_4px_15px_hsla(140,35%,38%,0.25)] transition-all hover:shadow-[0_6px_20px_hsla(140,35%,38%,0.4)] hover:-translate-y-px active:scale-[0.97]">
            {editItem ? 'Save Changes' : 'Add Gear'}
          </button>
        </div>
      </div>
    </div>
  );
}
