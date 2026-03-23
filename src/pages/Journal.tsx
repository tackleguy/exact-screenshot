import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MountainBackground } from '@/components/layout/MountainBackground';
import { AppHeader } from '@/components/layout/AppHeader';
import { useJournal, type JournalEntry } from '@/hooks/useJournal';
import { Plus, Search, MapPin, Mountain, Clock, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const DIFF_STYLES: Record<number, string> = {
  1: 'bg-primary/20 text-moss-glow',
  2: 'bg-primary/20 text-moss-glow',
  3: 'bg-accent/20 text-amber',
  4: 'bg-destructive/20 text-danger-glow',
  5: 'bg-[hsla(270,30%,57%,0.2)] text-cat-clothing',
};

const Journal = () => {
  const navigate = useNavigate();
  const { entries, loading, deleteEntry } = useJournal();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'recent' | 'longest' | 'elevation'>('recent');

  let filtered = entries.filter(e =>
    e.trip_name.toLowerCase().includes(search.toLowerCase()) ||
    e.trail_name.toLowerCase().includes(search.toLowerCase())
  );

  if (sort === 'longest') filtered = [...filtered].sort((a, b) => (b.distance_miles || 0) - (a.distance_miles || 0));
  else if (sort === 'elevation') filtered = [...filtered].sort((a, b) => (b.elevation_gain_ft || 0) - (a.elevation_gain_ft || 0));

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteEntry(id);
    toast.success('Trip deleted');
  };

  return (
    <div className="min-h-screen">
      <MountainBackground />
      <div className="relative z-10">
        <AppHeader />
        <main className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-4 animate-fade-up">
            <div>
              <h2 className="text-[1.8rem] font-bold tracking-tight">Trail Journal</h2>
              <p className="text-[0.8rem] text-granite mt-1">Log your trips with detailed stats, photos, and conditions</p>
            </div>
            <button onClick={() => navigate('/journal/new')}
              className="px-4 py-2 rounded-lg bg-gradient-to-br from-moss to-moss-glow text-primary-foreground text-[0.8rem] font-semibold shadow-[0_4px_15px_hsla(140,35%,38%,0.25)] transition-all hover:shadow-[0_6px_20px_hsla(140,35%,38%,0.4)] hover:-translate-y-px active:scale-[0.97]">
              <Plus size={14} className="inline mr-1" /> Log New Trip
            </button>
          </div>

          <div className="flex gap-3 mb-6 flex-wrap animate-fade-up">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-granite" />
              <input className="w-full bg-card/70 border border-border/40 text-snow font-body text-[0.85rem] py-2.5 pl-10 pr-4 rounded-lg outline-none focus:border-primary/50 placeholder:text-granite/50"
                placeholder="Search trips..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {(['recent', 'longest', 'elevation'] as const).map(s => (
              <button key={s} onClick={() => setSort(s)}
                className={`px-3 py-2 rounded-lg text-[0.75rem] font-semibold transition-all ${sort === s ? 'bg-primary/15 text-snow border border-primary/30' : 'bg-card/70 text-granite border border-border/40 hover:text-snow'}`}>
                {s === 'recent' ? 'Most Recent' : s === 'longest' ? 'Longest' : 'Most Elevation'}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-moss border-t-transparent rounded-full animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-granite animate-fade-up">
              <Mountain size={48} className="mx-auto mb-4 opacity-30" />
              <p className="text-lg mb-2">No trips logged yet</p>
              <p className="text-sm mb-6">Start documenting your adventures</p>
              <button onClick={() => navigate('/journal/new')} className="px-6 py-3 rounded-lg bg-primary text-primary-foreground font-semibold">
                Log Your First Trip
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 animate-fade-up">
              {filtered.map(entry => (
                <div key={entry.id} onClick={() => navigate(`/journal/${entry.id}`)}
                  className="bg-card/70 border border-border/40 rounded-2xl backdrop-blur-xl overflow-hidden cursor-pointer transition-all duration-300 hover:border-border/60 hover:-translate-y-px group">
                  {/* Hero photo or fallback */}
                  <div className="h-36 bg-gradient-to-br from-ridge to-peak relative overflow-hidden">
                    {entry.hero_photo_url ? (
                      <img src={entry.hero_photo_url} alt={entry.trip_name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex items-center justify-center h-full">
                        <Mountain size={40} className="text-granite/20" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-peak/80 to-transparent" />
                    <h3 className="absolute bottom-3 left-4 right-4 font-display text-[1.1rem] font-bold">{entry.trip_name}</h3>
                  </div>

                  <div className="p-4">
                    {entry.trail_name && (
                      <div className="flex items-center gap-1 text-[0.75rem] text-granite mb-2">
                        <MapPin size={12} /> {entry.trail_name}
                      </div>
                    )}
                    {entry.start_date && (
                      <div className="text-[0.7rem] text-granite mb-3">
                        {new Date(entry.start_date).toLocaleDateString()} {entry.end_date ? `— ${new Date(entry.end_date).toLocaleDateString()}` : ''}
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {entry.distance_miles && (
                        <div className="text-center">
                          <div className="font-mono text-[0.9rem] font-medium">{entry.distance_miles} mi</div>
                          <div className="text-[0.6rem] text-granite uppercase tracking-[0.1em]">Distance</div>
                        </div>
                      )}
                      {entry.elevation_gain_ft && (
                        <div className="text-center">
                          <div className="font-mono text-[0.9rem] font-medium">{(entry.elevation_gain_ft / 1000).toFixed(1)}k ft</div>
                          <div className="text-[0.6rem] text-granite uppercase tracking-[0.1em]">Elevation</div>
                        </div>
                      )}
                      {entry.hiking_time_hours && (
                        <div className="text-center">
                          <div className="font-mono text-[0.9rem] font-medium">{entry.hiking_time_hours}h</div>
                          <div className="text-[0.6rem] text-granite uppercase tracking-[0.1em]">Duration</div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {entry.difficulty_rating && (
                        <span className={`px-2 py-0.5 rounded text-[0.65rem] font-semibold ${DIFF_STYLES[entry.difficulty_rating] || ''}`}>
                          {'★'.repeat(entry.difficulty_rating)}{'☆'.repeat(5 - entry.difficulty_rating)}
                        </span>
                      )}
                      {entry.is_public && <span className="px-2 py-0.5 rounded text-[0.6rem] bg-primary/15 text-moss-glow">Public</span>}
                      <button onClick={(e) => handleDelete(entry.id, e)}
                        className="ml-auto opacity-0 group-hover:opacity-100 p-1 text-granite/50 hover:text-danger transition-all">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default Journal;
