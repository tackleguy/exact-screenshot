import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface JournalEntry {
  id: string;
  user_id: string;
  trail_name: string;
  trip_name: string;
  start_date: string | null;
  end_date: string | null;
  companions: string | null;
  distance_miles: number | null;
  elevation_gain_ft: number | null;
  elevation_loss_ft: number | null;
  highest_point_ft: number | null;
  hiking_time_hours: number | null;
  difficulty_rating: number | null;
  trail_condition: string | null;
  avg_day_temp_f: number | null;
  avg_night_temp_f: number | null;
  weather_conditions: string[];
  water_sources: string | null;
  bug_level: string | null;
  snow_ice: string | null;
  packing_list_id: string | null;
  gear_notes: string | null;
  trip_notes: string | null;
  is_public: boolean;
  hero_photo_url: string | null;
  created_at: string;
}

export interface JournalDay {
  id?: string;
  journal_id?: string;
  day_number: number;
  miles: number | null;
  camp_location: string | null;
  notes: string | null;
}

export interface JournalPhoto {
  id: string;
  journal_id: string;
  photo_url: string;
  caption: string | null;
  sort_order: number;
}

export function useJournal() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEntries = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const { data } = await (supabase as any).from('trip_journal').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    if (data) setEntries(data);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const createEntry = async (entry: Partial<JournalEntry>) => {
    if (!user) return null;
    const { data } = await (supabase as any).from('trip_journal').insert({ ...entry, user_id: user.id }).select().single();
    if (data) setEntries(prev => [data, ...prev]);
    return data;
  };

  const updateEntry = async (id: string, entry: Partial<JournalEntry>) => {
    const { data } = await (supabase as any).from('trip_journal').update(entry).eq('id', id).select().single();
    if (data) setEntries(prev => prev.map(e => e.id === id ? data : e));
    return data;
  };

  const deleteEntry = async (id: string) => {
    await (supabase as any).from('trip_journal').delete().eq('id', id);
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const getEntry = async (id: string): Promise<JournalEntry | null> => {
    const { data } = await (supabase as any).from('trip_journal').select('*').eq('id', id).single();
    return data;
  };

  const getDays = async (journalId: string): Promise<JournalDay[]> => {
    const { data } = await (supabase as any).from('trip_journal_days').select('*').eq('journal_id', journalId).order('day_number');
    return data || [];
  };

  const saveDays = async (journalId: string, days: JournalDay[]) => {
    await (supabase as any).from('trip_journal_days').delete().eq('journal_id', journalId);
    if (days.length > 0) {
      await (supabase as any).from('trip_journal_days').insert(
        days.map(d => ({ journal_id: journalId, day_number: d.day_number, miles: d.miles, camp_location: d.camp_location, notes: d.notes }))
      );
    }
  };

  const getPhotos = async (journalId: string): Promise<JournalPhoto[]> => {
    const { data } = await (supabase as any).from('trip_journal_photos').select('*').eq('journal_id', journalId).order('sort_order');
    return data || [];
  };

  const uploadPhoto = async (journalId: string, file: File, caption: string, sortOrder: number): Promise<JournalPhoto | null> => {
    if (!user) return null;
    const path = `${user.id}/${journalId}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from('journal-photos').upload(path, file);
    if (error) { console.error(error); return null; }
    const { data: { publicUrl } } = supabase.storage.from('journal-photos').getPublicUrl(path);
    const { data } = await (supabase as any).from('trip_journal_photos').insert({
      journal_id: journalId, photo_url: publicUrl, caption, sort_order: sortOrder,
    }).select().single();
    return data;
  };

  const deletePhoto = async (photo: JournalPhoto) => {
    const url = new URL(photo.photo_url);
    const pathParts = url.pathname.split('/storage/v1/object/public/journal-photos/');
    if (pathParts[1]) await supabase.storage.from('journal-photos').remove([decodeURIComponent(pathParts[1])]);
    await (supabase as any).from('trip_journal_photos').delete().eq('id', photo.id);
  };

  return {
    entries, loading, fetchEntries, createEntry, updateEntry, deleteEntry,
    getEntry, getDays, saveDays, getPhotos, uploadPhoto, deletePhoto,
  };
}
