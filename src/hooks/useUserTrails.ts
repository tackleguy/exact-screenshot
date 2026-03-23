import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { Trail } from '@/lib/data';

export function useUserTrails() {
  const { user } = useAuth();
  const [trails, setTrails] = useState<(Trail & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setTrails([]); setLoading(false); return; }
    const load = async () => {
      const { data, error } = await supabase
        .from('user_trails')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) { console.error(error); toast.error('Failed to load custom trails'); }
      else setTrails((data ?? []).map(r => ({
        id: r.id,
        name: r.name,
        location: r.location,
        distance: Number(r.distance),
        elevation: Number(r.elevation),
        days: r.days,
        difficulty: r.difficulty as Trail['difficulty'],
        tags: r.tags ?? [],
        season: r.season,
      })));
      setLoading(false);
    };
    load();
  }, [user]);

  const addTrail = async (trail: Omit<Trail, 'tags'> & { tags: string[] }) => {
    if (!user) return;
    const { data, error } = await supabase.from('user_trails').insert({
      user_id: user.id,
      name: trail.name,
      location: trail.location,
      distance: trail.distance,
      elevation: trail.elevation,
      days: trail.days,
      difficulty: trail.difficulty,
      tags: trail.tags,
      season: trail.season,
    }).select().single();
    if (error) { toast.error('Failed to save trail'); return; }
    setTrails(prev => [{ ...trail, id: data.id } as Trail & { id: string }, ...prev]);
    toast.success('Trail added!');
  };

  const deleteTrail = async (id: string) => {
    const { error } = await supabase.from('user_trails').delete().eq('id', id);
    if (error) { toast.error('Failed to delete trail'); return; }
    setTrails(prev => prev.filter(t => t.id !== id));
    toast.success('Trail removed');
  };

  return { trails, loading, addTrail, deleteTrail };
}
