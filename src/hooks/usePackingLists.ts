import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface PackingList {
  id: string;
  name: string;
  created_at: string;
}

export interface PackingListItem {
  id: string;
  packing_list_id: string;
  gear_item_id: string;
  packed: boolean;
}

export function usePackingLists() {
  const { user } = useAuth();
  const [lists, setLists] = useState<PackingList[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLists = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const { data } = await (supabase as any).from('packing_lists').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    if (data) setLists(data);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchLists(); }, [fetchLists]);

  const createList = async (name: string): Promise<PackingList | null> => {
    if (!user) return null;
    const { data } = await (supabase as any).from('packing_lists').insert({ user_id: user.id, name }).select().single();
    if (data) { setLists(prev => [data, ...prev]); return data; }
    return null;
  };

  const deleteList = async (id: string) => {
    await (supabase as any).from('packing_lists').delete().eq('id', id);
    setLists(prev => prev.filter(l => l.id !== id));
  };

  const getListItems = async (listId: string): Promise<PackingListItem[]> => {
    const { data } = await (supabase as any).from('packing_list_items').select('*').eq('packing_list_id', listId);
    return data || [];
  };

  const addItemToList = async (listId: string, gearItemId: string) => {
    const { data } = await (supabase as any).from('packing_list_items').insert({ packing_list_id: listId, gear_item_id: gearItemId }).select().single();
    return data;
  };

  const removeItemFromList = async (itemId: string) => {
    await (supabase as any).from('packing_list_items').delete().eq('id', itemId);
  };

  const togglePacked = async (itemId: string, packed: boolean) => {
    await (supabase as any).from('packing_list_items').update({ packed }).eq('id', itemId);
  };

  const addAllGearToList = async (listId: string, gearItemIds: string[]) => {
    const items = gearItemIds.map(gearItemId => ({ packing_list_id: listId, gear_item_id: gearItemId }));
    await (supabase as any).from('packing_list_items').insert(items);
  };

  return { lists, loading, createList, deleteList, getListItems, addItemToList, removeItemFromList, togglePacked, addAllGearToList, refetch: fetchLists };
}
