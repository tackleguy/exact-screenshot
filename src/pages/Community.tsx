import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MountainBackground } from '@/components/layout/MountainBackground';
import { AppHeader } from '@/components/layout/AppHeader';
import { useCommunity, type CommunityPost } from '@/hooks/useCommunity';
import { convertWeight } from '@/lib/data';
import { Search, Copy, MessageCircle, Scale } from 'lucide-react';

const TRIP_TYPES = ['all', 'Day Hike', 'Overnight', 'Thru-Hike', 'Winter', 'Ultralight Challenge'];
const SORT_OPTIONS = [
  { value: 'recent', label: 'Most Recent' },
  { value: 'lightest', label: 'Lightest Base Weight' },
  { value: 'cloned', label: 'Most Cloned' },
];

function weightBadge(oz: number) {
  if (oz <= 160) return { label: 'UL', cls: 'bg-primary/20 text-moss-glow' };
  if (oz <= 320) return { label: 'LW', cls: 'bg-accent/20 text-amber' };
  return { label: 'Traditional', cls: 'bg-secondary text-granite' };
}

const Community = () => {
  const navigate = useNavigate();
  const { posts, loading, fetchPosts } = useCommunity();
  const [tripType, setTripType] = useState('all');
  const [sort, setSort] = useState('recent');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchPosts({ trip_type: tripType === 'all' ? undefined : tripType, sort, search: search || undefined });
  }, [tripType, sort, search, fetchPosts]);

  const inputClass = "bg-card/70 border border-border/40 text-snow font-body text-[0.85rem] px-3 py-2.5 rounded-lg outline-none transition-colors focus:border-primary/50";

  return (
    <div className="min-h-screen">
      <MountainBackground />
      <div className="relative z-10">
        <AppHeader />
        <main className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">
          {/* Hero */}
          <div className="text-center mb-10 animate-fade-up">
            <h2 className="font-display text-[2.4rem] font-bold tracking-tight mb-2">Community Pack Lists</h2>
            <p className="text-granite text-[0.9rem]">See what other hikers are carrying</p>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-8 animate-fade-up">
            <select className={inputClass} value={tripType} onChange={e => setTripType(e.target.value)}>
              {TRIP_TYPES.map(t => <option key={t} value={t}>{t === 'all' ? 'All Trip Types' : t}</option>)}
            </select>
            <select className={inputClass} value={sort} onChange={e => setSort(e.target.value)}>
              {SORT_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-granite" />
              <input className={inputClass + ' w-full pl-10'} placeholder="Search packs..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          {/* Posts grid */}
          {loading ? (
            <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-moss border-t-transparent rounded-full animate-spin" /></div>
          ) : posts.length === 0 ? (
            <div className="text-center py-16 text-granite">
              <p className="text-lg mb-2">No community packs yet</p>
              <p className="text-sm">Be the first to share your pack list!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 animate-fade-up">
              {posts.map(post => {
                const badge = weightBadge(post.base_weight_oz);
                return (
                  <div key={post.id} onClick={() => navigate(`/community/${post.id}`)}
                    className="bg-card/70 border border-border/40 rounded-2xl backdrop-blur-xl p-6 cursor-pointer transition-all duration-300 hover:border-border/60 hover:-translate-y-px">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-snow font-semibold text-sm">
                          {post.author_name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <div className="text-[0.85rem] font-semibold">{post.author_name || 'Anonymous'}</div>
                          <div className="text-[0.65rem] text-granite">{new Date(post.created_at).toLocaleDateString()}</div>
                        </div>
                      </div>
                      {post.author_tier === 'thru_hiker' && (
                        <span className="px-2 py-0.5 rounded text-[0.6rem] font-semibold bg-amber/20 text-amber">Featured Packer</span>
                      )}
                    </div>

                    <h3 className="font-display text-[1.15rem] font-bold mb-1">{post.title}</h3>
                    {post.trail_name && <p className="text-[0.75rem] text-granite mb-3">🥾 {post.trail_name}</p>}

                    <div className="flex items-center gap-4 mb-3">
                      <div className="flex items-center gap-1.5">
                        <Scale size={14} className="text-amber" />
                        <span className="font-mono text-[1.1rem] font-medium">{convertWeight(post.base_weight_oz, 'oz')} oz</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[0.65rem] font-semibold ${badge.cls}`}>{badge.label}</span>
                    </div>

                    <div className="flex items-center gap-4 text-[0.75rem] text-granite">
                      <span>{post.item_count} items</span>
                      <span className="flex items-center gap-1"><Copy size={12} /> {post.clone_count}</span>
                      <span className="flex items-center gap-1"><MessageCircle size={12} /> 0</span>
                      <span className="px-2 py-0.5 rounded bg-foreground/5 border border-border/40">{post.trip_type}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default Community;
