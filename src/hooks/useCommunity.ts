import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface CommunityPost {
  id: string;
  user_id: string;
  title: string;
  description: string;
  trip_type: string;
  trail_name: string;
  author_name: string;
  author_tier: string;
  gear_data: any[];
  base_weight_oz: number;
  total_weight_oz: number;
  item_count: number;
  total_cost: number;
  created_at: string;
  clone_count: number;
  is_featured: boolean;
}

export interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  parent_comment_id: string | null;
  author_name: string;
  body: string;
  created_at: string;
}

export function useCommunity() {
  const { user, profile } = useAuth();
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPosts = useCallback(async (filters?: { trip_type?: string; sort?: string; search?: string }) => {
    setLoading(true);
    let query = (supabase as any).from('community_posts').select('*').order('created_at', { ascending: false });
    if (filters?.trip_type && filters.trip_type !== 'all') query = query.eq('trip_type', filters.trip_type);
    if (filters?.search) query = query.or(`title.ilike.%${filters.search}%,trail_name.ilike.%${filters.search}%`);
    const { data } = await query;
    if (data) {
      let sorted = [...data] as CommunityPost[];
      if (filters?.sort === 'lightest') sorted.sort((a, b) => a.base_weight_oz - b.base_weight_oz);
      else if (filters?.sort === 'cloned') sorted.sort((a, b) => b.clone_count - a.clone_count);
      setPosts(sorted);
    }
    setLoading(false);
  }, []);

  const getPost = async (id: string): Promise<CommunityPost | null> => {
    const { data } = await (supabase as any).from('community_posts').select('*').eq('id', id).single();
    return data;
  };

  const createPost = async (post: {
    packing_list_id?: string; title: string; description: string;
    trip_type: string; trail_name: string; gear_data: any[];
    base_weight_oz: number; total_weight_oz: number; item_count: number; total_cost: number;
  }) => {
    if (!user || !profile) return null;
    const { data } = await (supabase as any).from('community_posts').insert({
      ...post, user_id: user.id,
      author_name: profile.display_name || user.email?.split('@')[0] || '',
      author_tier: profile.tier,
    }).select().single();
    return data;
  };

  const clonePost = async (post: CommunityPost) => {
    if (!user) return;
    const gearItems = post.gear_data.map((g: any) => ({
      user_id: user.id, name: g.name, category: g.category,
      type: g.type, qty: g.qty, weight: g.weight, price: g.price, link: g.link || '',
    }));
    const { data: newGear } = await (supabase as any).from('gear_items').insert(gearItems).select();
    if (!newGear) return;
    const { data: list } = await (supabase as any).from('packing_lists').insert({
      user_id: user.id, name: `${post.title} (cloned)`,
    }).select().single();
    if (!list) return;
    const listItems = newGear.map((g: any) => ({ packing_list_id: list.id, gear_item_id: g.id }));
    await (supabase as any).from('packing_list_items').insert(listItems);
    await (supabase as any).from('community_posts').update({ clone_count: post.clone_count + 1 }).eq('id', post.id);
  };

  const getComments = async (postId: string): Promise<Comment[]> => {
    const { data } = await (supabase as any).from('comments').select('*').eq('post_id', postId).order('created_at');
    return data || [];
  };

  const addComment = async (postId: string, body: string, parentId?: string): Promise<Comment | null> => {
    if (!user || !profile) return null;
    const { data } = await (supabase as any).from('comments').insert({
      post_id: postId, user_id: user.id, body,
      author_name: profile.display_name || user.email?.split('@')[0] || '',
      parent_comment_id: parentId || null,
    }).select().single();
    return data;
  };

  const deleteComment = async (id: string) => {
    await (supabase as any).from('comments').delete().eq('id', id);
  };

  return { posts, loading, fetchPosts, getPost, createPost, clonePost, getComments, addComment, deleteComment };
}
