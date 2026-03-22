import { useState, useMemo } from 'react';
import { type Trail, TRAILS } from '@/lib/data';
import { Search, MapPin } from 'lucide-react';

const DIFF_STYLES: Record<string, string> = {
  easy: 'bg-primary/20 text-moss-glow',
  moderate: 'bg-accent/20 text-amber',
  hard: 'bg-destructive/20 text-danger-glow',
  expert: 'bg-[hsla(270,30%,57%,0.2)] text-cat-clothing',
};

export function TrailDatabase() {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() =>
    TRAILS.filter(t =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.location.toLowerCase().includes(search.toLowerCase()) ||
      t.tags.some(tag => tag.toLowerCase().includes(search.toLowerCase()))
    ), [search]);

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h2 className="text-[1.8rem] font-bold tracking-tight">Trail Database</h2>
          <p className="text-[0.8rem] text-granite mt-1">Popular backpacking routes</p>
        </div>
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-granite" />
          <input className="w-full bg-card/70 border border-border/40 text-snow font-body text-[0.85rem] py-2.5 pl-10 pr-4 rounded-lg outline-none transition-colors focus:border-primary/50 placeholder:text-granite/50"
            placeholder="Search trails..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(trail => (
          <div key={trail.name} className="bg-card/70 border border-border/40 rounded-2xl backdrop-blur-xl transition-all duration-300 hover:border-border/60 cursor-pointer overflow-hidden">
            <div className="p-5 pb-2">
              <h4 className="font-display text-[1.1rem] font-bold mb-0.5">{trail.name}</h4>
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
    </div>
  );
}
