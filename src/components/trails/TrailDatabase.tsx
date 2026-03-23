import { useState, useMemo } from 'react';
import { type Trail, TRAILS } from '@/lib/data';
import { Search, MapPin, Plus, X, Trash2 } from 'lucide-react';
import { useUserTrails } from '@/hooks/useUserTrails';

const DIFF_STYLES: Record<string, string> = {
  easy: 'bg-primary/20 text-moss-glow',
  moderate: 'bg-accent/20 text-amber',
  hard: 'bg-destructive/20 text-danger-glow',
  expert: 'bg-[hsla(270,30%,57%,0.2)] text-cat-clothing',
};

const DIFFICULTIES: Trail['difficulty'][] = ['easy', 'moderate', 'hard', 'expert'];

const emptyForm = { name: '', location: '', distance: '', elevation: '', days: '', difficulty: 'moderate' as Trail['difficulty'], season: '', tags: '' };

export function TrailDatabase() {
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const { trails: userTrails, addTrail, deleteTrail } = useUserTrails();

  const allTrails = useMemo(() => {
    const custom = userTrails.map(t => ({ ...t, isCustom: true as const }));
    const builtin = TRAILS.map(t => ({ ...t, id: t.name, isCustom: false as const }));
    return [...custom, ...builtin];
  }, [userTrails]);

  const filtered = useMemo(() =>
    allTrails.filter(t =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.location.toLowerCase().includes(search.toLowerCase()) ||
      t.tags.some(tag => tag.toLowerCase().includes(search.toLowerCase()))
    ), [search, allTrails]);

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    await addTrail({
      name: form.name.trim(),
      location: form.location.trim(),
      distance: Number(form.distance) || 0,
      elevation: Number(form.elevation) || 0,
      days: form.days.trim() || '1',
      difficulty: form.difficulty,
      season: form.season.trim(),
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
    });
    setForm(emptyForm);
    setShowModal(false);
  };

  const inputClass = "w-full bg-card/70 border border-border/40 text-snow font-body text-[0.85rem] py-2.5 px-3 rounded-lg outline-none transition-colors focus:border-primary/50 placeholder:text-granite/50";

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h2 className="text-[1.8rem] font-bold tracking-tight">Trail Database</h2>
          <p className="text-[0.8rem] text-granite mt-1">Popular backpacking routes</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-granite" />
            <input className={`${inputClass} pl-10`}
              placeholder="Search trails..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-primary/20 border border-primary/30 text-moss-glow text-[0.8rem] font-semibold hover:bg-primary/30 transition-colors">
            <Plus size={15} /> Add Trail
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(trail => (
          <div key={trail.id} className="bg-card/70 border border-border/40 rounded-2xl backdrop-blur-xl transition-all duration-300 hover:border-border/60 cursor-pointer overflow-hidden relative group">
            {trail.isCustom && (
              <button onClick={(e) => { e.stopPropagation(); deleteTrail(trail.id); }}
                className="absolute top-3 right-3 p-1.5 rounded-lg bg-destructive/20 text-danger opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/30 z-10">
                <Trash2 size={13} />
              </button>
            )}
            <div className="p-5 pb-2">
              <div className="flex items-center gap-2">
                <h4 className="font-display text-[1.1rem] font-bold mb-0.5">{trail.name}</h4>
                {trail.isCustom && <span className="text-[0.55rem] px-1.5 py-0.5 rounded bg-primary/20 text-moss-glow font-semibold">Custom</span>}
              </div>
              <div className="text-[0.75rem] text-granite flex items-center gap-1"><MapPin size={12} />{trail.location}</div>
              <span className={`inline-block mt-2 px-2 py-0.5 rounded-md text-[0.65rem] font-semibold ${DIFF_STYLES[trail.difficulty]}`}>
                {trail.difficulty.charAt(0).toUpperCase() + trail.difficulty.slice(1)}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 px-5 py-3">
              <div className="text-center">
                <div className="font-mono text-[0.9rem] font-medium">{trail.distance} mi</div>
                <div className="text-[0.6rem] text-granite uppercase tracking-[0.1em]">Distance</div>
              </div>
              <div className="text-center">
                <div className="font-mono text-[0.9rem] font-medium">{(trail.elevation / 1000).toFixed(1)}k ft</div>
                <div className="text-[0.6rem] text-granite uppercase tracking-[0.1em]">Elevation</div>
              </div>
              <div className="text-center">
                <div className="font-mono text-[0.9rem] font-medium">{trail.days}</div>
                <div className="text-[0.6rem] text-granite uppercase tracking-[0.1em]">Days</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 px-5 pb-4">
              <span className="text-[0.6rem] px-2 py-0.5 bg-foreground/5 border border-border/40 rounded text-granite">🗓 {trail.season}</span>
              {trail.tags.map(tag => (
                <span key={tag} className="text-[0.6rem] px-2 py-0.5 bg-foreground/5 border border-border/40 rounded text-granite">{tag}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Add Trail Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-lg" onClick={() => setShowModal(false)}>
          <div className="bg-[hsl(210,25%,15%)] border border-[hsl(210,20%,30%)] rounded-2xl p-6 w-full max-w-md shadow-[0_25px_60px_rgba(0,0,0,0.5)]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-display text-lg font-bold text-snow">Add Custom Trail</h3>
              <button onClick={() => setShowModal(false)} className="text-granite hover:text-snow transition-colors"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <input className={inputClass} placeholder="Trail name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <input className={inputClass} placeholder="Location (e.g. Wyoming, USA)" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <input className={inputClass} type="number" placeholder="Distance (mi)" value={form.distance} onChange={e => setForm(f => ({ ...f, distance: e.target.value }))} />
                <input className={inputClass} type="number" placeholder="Elevation (ft)" value={form.elevation} onChange={e => setForm(f => ({ ...f, elevation: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input className={inputClass} placeholder="Days (e.g. 3-5)" value={form.days} onChange={e => setForm(f => ({ ...f, days: e.target.value }))} />
                <select className={inputClass} value={form.difficulty} onChange={e => setForm(f => ({ ...f, difficulty: e.target.value as Trail['difficulty'] }))}>
                  {DIFFICULTIES.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                </select>
              </div>
              <input className={inputClass} placeholder="Season (e.g. Jul-Sep)" value={form.season} onChange={e => setForm(f => ({ ...f, season: e.target.value }))} />
              <input className={inputClass} placeholder="Tags (comma separated)" value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} />
            </div>
            <button onClick={handleSubmit} disabled={!form.name.trim()}
              className="mt-5 w-full py-2.5 rounded-lg bg-primary/20 border border-primary/30 text-moss-glow font-semibold text-[0.85rem] hover:bg-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              Add Trail
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
