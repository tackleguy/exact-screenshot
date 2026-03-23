import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { GearItem, GearCategory, GearType } from '@/lib/data';

const mapGear = (g: any): GearItem => ({
  id: g.id, name: g.name, category: g.category as GearCategory,
  type: g.type as GearType, qty: g.qty, weight: Number(g.weight),
  price: Number(g.price), link: g.link || '',
});

export function useGear() {
  const { user } = useAuth();
  const [gear, setGear] = useState<GearItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGear = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const { data } = await (supabase as any).from('gear_items').select('*').eq('user_id', user.id).order('created_at');
    if (data) setGear(data.map(mapGear));
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchGear(); }, [fetchGear]);

  const addGear = async (item: Omit<GearItem, 'id'>) => {
    if (!user) return;
    const { data } = await (supabase as any).from('gear_items').insert({ user_id: user.id, ...item }).select().single();
    if (data) setGear(prev => [...prev, mapGear(data)]);
  };

  const editGear = async (id: string, item: Omit<GearItem, 'id'>) => {
    await (supabase as any).from('gear_items').update(item).eq('id', id);
    setGear(prev => prev.map(g => g.id === id ? { ...item, id } : g));
  };

  const deleteGear = async (id: string) => {
    await (supabase as any).from('gear_items').delete().eq('id', id);
    setGear(prev => prev.filter(g => g.id !== id));
  };

  return { gear, loading, addGear, editGear, deleteGear, refetch: fetchGear };
}
