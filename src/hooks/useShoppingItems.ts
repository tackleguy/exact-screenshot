import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { ShopItem } from '@/lib/data';
import { INITIAL_SHOP } from '@/lib/data';

const mapShop = (s: any): ShopItem => ({
  id: s.id, name: s.name, price: Number(s.price),
  store: s.store, priority: s.priority, purchased: s.purchased,
});

export function useShoppingItems() {
  const { user } = useAuth();
  const [items, setItems] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const { data } = await (supabase as any).from('shopping_items').select('*').eq('user_id', user.id).order('created_at');
    if (data && data.length > 0) {
      setItems(data.map(mapShop));
    } else if (data && data.length === 0) {
      const seeds = INITIAL_SHOP.map(s => ({
        user_id: user.id, name: s.name, price: s.price,
        store: s.store, priority: s.priority, purchased: s.purchased,
      }));
      const { data: seeded } = await (supabase as any).from('shopping_items').insert(seeds).select();
      if (seeded) setItems(seeded.map(mapShop));
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const addItem = async (item: Omit<ShopItem, 'id'>) => {
    if (!user) return;
    const { data } = await (supabase as any).from('shopping_items').insert({ user_id: user.id, ...item }).select().single();
    if (data) setItems(prev => [...prev, mapShop(data)]);
  };

  const toggleItem = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    await (supabase as any).from('shopping_items').update({ purchased: !item.purchased }).eq('id', id);
    setItems(prev => prev.map(s => s.id === id ? { ...s, purchased: !s.purchased } : s));
  };

  const deleteItem = async (id: string) => {
    await (supabase as any).from('shopping_items').delete().eq('id', id);
    setItems(prev => prev.filter(s => s.id !== id));
  };

  return { items, loading, addItem, toggleItem, deleteItem };
}
