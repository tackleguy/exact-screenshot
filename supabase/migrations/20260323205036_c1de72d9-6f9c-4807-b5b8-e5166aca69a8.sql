
CREATE TABLE public.gear_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  type text NOT NULL DEFAULT 'Base',
  qty integer NOT NULL DEFAULT 1,
  weight numeric NOT NULL DEFAULT 0,
  price numeric NOT NULL DEFAULT 0,
  link text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gear_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gear_own" ON public.gear_items FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.packing_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.packing_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pl_own" ON public.packing_lists FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.packing_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packing_list_id uuid NOT NULL REFERENCES public.packing_lists(id) ON DELETE CASCADE,
  gear_item_id uuid NOT NULL REFERENCES public.gear_items(id) ON DELETE CASCADE,
  packed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.packing_list_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pli_own" ON public.packing_list_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.packing_lists WHERE id = packing_list_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.packing_lists WHERE id = packing_list_id AND user_id = auth.uid()));

CREATE TABLE public.shopping_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  store text DEFAULT 'TBD',
  priority text NOT NULL DEFAULT 'Medium',
  purchased boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shopping_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shop_own" ON public.shopping_items FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  packing_list_id uuid,
  title text NOT NULL,
  description text DEFAULT '',
  trip_type text DEFAULT 'Overnight',
  trail_name text DEFAULT '',
  author_name text DEFAULT '',
  author_tier text DEFAULT 'base_camp',
  gear_data jsonb NOT NULL DEFAULT '[]',
  base_weight_oz numeric NOT NULL DEFAULT 0,
  total_weight_oz numeric NOT NULL DEFAULT 0,
  item_count integer NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  clone_count integer NOT NULL DEFAULT 0,
  is_featured boolean NOT NULL DEFAULT false
);
ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cp_read" ON public.community_posts FOR SELECT TO authenticated USING (true);
CREATE POLICY "cp_insert" ON public.community_posts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cp_update" ON public.community_posts FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "cp_delete" ON public.community_posts FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  parent_comment_id uuid REFERENCES public.comments(id) ON DELETE CASCADE,
  author_name text DEFAULT '',
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cmt_read" ON public.comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "cmt_insert" ON public.comments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cmt_delete" ON public.comments FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.trip_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  trail_name text DEFAULT '',
  trip_name text NOT NULL,
  start_date date,
  end_date date,
  companions text,
  distance_miles numeric,
  elevation_gain_ft numeric,
  elevation_loss_ft numeric,
  highest_point_ft numeric,
  hiking_time_hours numeric,
  difficulty_rating integer,
  trail_condition text,
  avg_day_temp_f numeric,
  avg_night_temp_f numeric,
  weather_conditions text[] DEFAULT '{}',
  water_sources text,
  bug_level text,
  snow_ice text,
  packing_list_id uuid,
  gear_notes text,
  trip_notes text,
  is_public boolean NOT NULL DEFAULT false,
  hero_photo_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trip_journal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tj_own" ON public.trip_journal FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tj_public_read" ON public.trip_journal FOR SELECT TO authenticated USING (is_public = true);

CREATE TABLE public.trip_journal_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id uuid NOT NULL REFERENCES public.trip_journal(id) ON DELETE CASCADE,
  day_number integer NOT NULL,
  miles numeric,
  camp_location text,
  notes text
);
ALTER TABLE public.trip_journal_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tjd_own" ON public.trip_journal_days FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.trip_journal WHERE id = journal_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.trip_journal WHERE id = journal_id AND user_id = auth.uid()));
CREATE POLICY "tjd_public" ON public.trip_journal_days FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.trip_journal WHERE id = journal_id AND is_public = true));

CREATE TABLE public.trip_journal_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id uuid NOT NULL REFERENCES public.trip_journal(id) ON DELETE CASCADE,
  photo_url text NOT NULL,
  caption text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trip_journal_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tjp_own" ON public.trip_journal_photos FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.trip_journal WHERE id = journal_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.trip_journal WHERE id = journal_id AND user_id = auth.uid()));
CREATE POLICY "tjp_public" ON public.trip_journal_photos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.trip_journal WHERE id = journal_id AND is_public = true));

INSERT INTO storage.buckets (id, name, public) VALUES ('journal-photos', 'journal-photos', true);
CREATE POLICY "jp_upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'journal-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "jp_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'journal-photos');
CREATE POLICY "jp_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'journal-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
