import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MountainBackground } from '@/components/layout/MountainBackground';
import { AppHeader } from '@/components/layout/AppHeader';
import { useCommunity, type CommunityPost as PostType, type Comment } from '@/hooks/useCommunity';
import { useAuth } from '@/contexts/AuthContext';
import { convertWeight, calcStats, CATEGORY_ORDER, CATEGORY_COLORS, type GearItem } from '@/lib/data';
import { downloadCSV, downloadPDF } from '@/lib/downloads';
import { StatCard } from '@/components/shared/StatCard';
import { ArrowLeft, Copy, Download, FileText, MessageCircle, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const CommunityPostPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { getPost, clonePost, getComments, addComment, deleteComment } = useCommunity();

  const [post, setPost] = useState<PostType | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  useEffect(() => {
    if (!id) return;
    Promise.all([getPost(id), getComments(id)]).then(([p, c]) => {
      setPost(p);
      setComments(c);
      setLoading(false);
    });
  }, [id]);

  if (loading || !post) {
    return (
      <div className="min-h-screen">
        <MountainBackground />
        <div className="relative z-10">
          <AppHeader />
          <div className="flex justify-center py-24"><div className="w-6 h-6 border-2 border-moss border-t-transparent rounded-full animate-spin" /></div>
        </div>
      </div>
    );
  }

  const gear: GearItem[] = (post.gear_data || []).map((g: any, i: number) => ({
    id: String(i), name: g.name, category: g.category, type: g.type,
    qty: g.qty, weight: Number(g.weight), price: Number(g.price), link: g.link || '',
  }));
  const stats = calcStats(gear);
  const grouped: Record<string, GearItem[]> = {};
  gear.forEach(g => { if (!grouped[g.category]) grouped[g.category] = []; grouped[g.category].push(g); });

  const bw = stats.baseWeight;
  const badge = bw <= 160 ? 'UL' : bw <= 320 ? 'LW' : 'Traditional';

  const handleClone = async () => {
    if (!user) { toast.error('Sign in to clone'); return; }
    await clonePost(post);
    toast.success('Pack cloned to your gear locker!');
  };

  const handleComment = async () => {
    if (!commentText.trim()) return;
    const c = await addComment(post.id, commentText.trim());
    if (c) { setComments(prev => [...prev, c]); setCommentText(''); }
  };

  const handleReply = async (parentId: string) => {
    if (!replyText.trim()) return;
    const c = await addComment(post.id, replyText.trim(), parentId);
    if (c) { setComments(prev => [...prev, c]); setReplyText(''); setReplyTo(null); }
  };

  const handleDeleteComment = async (cId: string) => {
    await deleteComment(cId);
    setComments(prev => prev.filter(c => c.id !== cId));
  };

  const topLevel = comments.filter(c => !c.parent_comment_id);
  const replies = (parentId: string) => comments.filter(c => c.parent_comment_id === parentId);

  return (
    <div className="min-h-screen">
      <MountainBackground />
      <div className="relative z-10">
        <AppHeader />
        <main className="max-w-[900px] mx-auto px-6 lg:px-10 py-8 animate-fade-up">
          <button onClick={() => navigate('/community')} className="flex items-center gap-1.5 text-granite hover:text-snow text-[0.85rem] mb-6 transition-colors">
            <ArrowLeft size={16} /> Back to Community
          </button>

          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-snow font-semibold">
                {post.author_name?.[0]?.toUpperCase() || '?'}
              </div>
              <div>
                <span className="text-[0.9rem] font-semibold">{post.author_name || 'Anonymous'}</span>
                {post.author_tier === 'thru_hiker' && <span className="ml-2 px-2 py-0.5 rounded text-[0.6rem] font-semibold bg-amber/20 text-amber">Featured</span>}
                <div className="text-[0.7rem] text-granite">{new Date(post.created_at).toLocaleDateString()}</div>
              </div>
            </div>
            <h1 className="font-display text-[2rem] font-bold tracking-tight mb-2">{post.title}</h1>
            {post.trail_name && <p className="text-granite text-[0.9rem] mb-2">🥾 {post.trail_name}</p>}
            {post.description && <p className="text-snow/80 text-[0.9rem] leading-relaxed">{post.description}</p>}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-8">
            <StatCard value={convertWeight(stats.baseWeight, 'oz')} label="Base Weight" sub={`oz · ${badge}`} colorClass="text-amber" />
            <StatCard value={convertWeight(stats.wornWeight, 'oz')} label="Worn Weight" sub="oz" colorClass="text-moss-glow" />
            <StatCard value={convertWeight(stats.consumableWeight, 'oz')} label="Consumables" sub="oz" colorClass="text-ice" />
            <StatCard value={convertWeight(stats.totalWeight, 'oz')} label="Total Weight" sub="oz" />
            <StatCard value={String(stats.totalItems)} label="Total Items" sub="items" colorClass="text-ice" />
            <StatCard value={`$${stats.totalCost.toLocaleString()}`} label="Total Cost" sub="USD" />
          </div>

          {/* Weight bar */}
          <div className="bg-card/70 border border-border/40 rounded-2xl p-4 mb-8">
            <div className="h-6 rounded-xl overflow-hidden flex bg-background/60">
              {CATEGORY_ORDER.map(cat => {
                const catGear = gear.filter(g => g.type === 'Base' && g.category === cat);
                const catW = catGear.reduce((s, g) => s + g.weight * g.qty, 0);
                if (catW === 0) return null;
                return <div key={cat} className="h-full" style={{ width: `${(catW / (stats.baseWeight || 1) * 100)}%`, background: CATEGORY_COLORS[cat as keyof typeof CATEGORY_COLORS] }} title={`${cat}: ${convertWeight(catW, 'oz')} oz`} />;
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 mb-8 flex-wrap">
            <button onClick={handleClone} className="px-5 py-2.5 rounded-lg bg-gradient-to-br from-moss to-moss-glow text-primary-foreground text-[0.85rem] font-semibold shadow-[0_4px_15px_hsla(140,35%,38%,0.25)] hover:shadow-[0_6px_20px_hsla(140,35%,38%,0.4)] active:scale-[0.97]">
              <Copy size={14} className="inline mr-1.5" /> Clone This Pack
            </button>
            <button onClick={() => downloadCSV(gear, 'oz', post.title)} className="px-4 py-2.5 rounded-lg border border-border/40 bg-card/70 text-snow text-[0.85rem] font-semibold hover:border-border/60">
              <Download size={14} className="inline mr-1.5" /> CSV
            </button>
            <button onClick={() => downloadPDF(gear, 'oz', post.title, post.author_name, post.trail_name)} className="px-4 py-2.5 rounded-lg border border-border/40 bg-card/70 text-snow text-[0.85rem] font-semibold hover:border-border/60">
              <FileText size={14} className="inline mr-1.5" /> PDF
            </button>
          </div>

          {/* Gear table */}
          <div className="bg-card/70 border border-border/40 rounded-2xl backdrop-blur-xl p-4 mb-8">
            <h3 className="text-[1.1rem] font-bold mb-4">Gear List</h3>
            {CATEGORY_ORDER.map(cat => {
              if (!grouped[cat]) return null;
              const catW = grouped[cat].reduce((s, g) => s + g.weight * g.qty, 0);
              return (
                <div key={cat} className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: CATEGORY_COLORS[cat as keyof typeof CATEGORY_COLORS] }} />
                    <h4 className="font-display text-[0.9rem] font-bold flex-1">{cat}</h4>
                    <span className="font-mono text-[0.7rem] text-granite">{convertWeight(catW, 'oz')} oz</span>
                  </div>
                  {grouped[cat].map((g, i) => (
                    <div key={i} className="flex items-center py-1.5 px-2 text-[0.8rem] rounded hover:bg-secondary/20">
                      <span className="flex-1">{g.name}{g.qty > 1 ? ` (×${g.qty})` : ''}</span>
                      <span className="text-[0.65rem] text-granite px-2">{g.type}</span>
                      <span className="font-mono text-[0.75rem] w-16 text-right">{convertWeight(g.weight * g.qty, 'oz')} oz</span>
                      <span className="font-mono text-[0.75rem] text-granite w-16 text-right">${(g.price * g.qty).toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* Comments */}
          <div className="bg-card/70 border border-border/40 rounded-2xl backdrop-blur-xl p-6">
            <h3 className="text-[1.1rem] font-bold mb-4 flex items-center gap-2">
              <MessageCircle size={18} /> Comments ({comments.length})
            </h3>

            {user && (
              <div className="flex gap-2 mb-6">
                <input className="flex-1 bg-background/60 border border-border/40 text-snow text-[0.85rem] px-3 py-2.5 rounded-lg outline-none focus:border-primary/50"
                  placeholder="Add a comment..." value={commentText} onChange={e => setCommentText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleComment()} />
                <button onClick={handleComment} className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-[0.8rem]">
                  <Send size={14} />
                </button>
              </div>
            )}

            <div className="space-y-4">
              {topLevel.map(c => (
                <div key={c.id}>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-snow text-[0.75rem] font-semibold shrink-0">
                      {c.author_name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[0.85rem] font-semibold">{c.author_name}</span>
                        <span className="text-[0.65rem] text-granite">{new Date(c.created_at).toLocaleDateString()}</span>
                        {c.user_id === user?.id && (
                          <button onClick={() => handleDeleteComment(c.id)} className="text-granite/50 hover:text-danger"><Trash2 size={12} /></button>
                        )}
                      </div>
                      <p className="text-[0.85rem] text-snow/80 mt-0.5">{c.body}</p>
                      <button onClick={() => setReplyTo(replyTo === c.id ? null : c.id)} className="text-[0.75rem] text-granite hover:text-snow mt-1">Reply</button>

                      {replyTo === c.id && (
                        <div className="flex gap-2 mt-2">
                          <input className="flex-1 bg-background/60 border border-border/40 text-snow text-[0.8rem] px-3 py-2 rounded-lg outline-none focus:border-primary/50"
                            placeholder="Reply..." value={replyText} onChange={e => setReplyText(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleReply(c.id)} autoFocus />
                          <button onClick={() => handleReply(c.id)} className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-[0.75rem]"><Send size={12} /></button>
                        </div>
                      )}

                      {/* Replies */}
                      {replies(c.id).map(r => (
                        <div key={r.id} className="flex items-start gap-2 mt-3 ml-4 border-l-2 border-border/30 pl-3">
                          <div className="w-6 h-6 rounded-full bg-secondary/50 flex items-center justify-center text-snow text-[0.6rem] font-semibold shrink-0">
                            {r.author_name?.[0]?.toUpperCase() || '?'}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-[0.8rem] font-semibold">{r.author_name}</span>
                              <span className="text-[0.6rem] text-granite">{new Date(r.created_at).toLocaleDateString()}</span>
                              {r.user_id === user?.id && (
                                <button onClick={() => handleDeleteComment(r.id)} className="text-granite/50 hover:text-danger"><Trash2 size={11} /></button>
                              )}
                            </div>
                            <p className="text-[0.8rem] text-snow/80">{r.body}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
              {comments.length === 0 && <p className="text-granite text-sm text-center py-4">No comments yet. Be the first!</p>}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default CommunityPostPage;
